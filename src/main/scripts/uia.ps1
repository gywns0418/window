# 캡처 도구 UI Automation 연동 스크립트 (상주 워커 / 일회 실행 겸용)
#
# - 이 파일은 -File 로 실행하지 않는다. newCaptureCore.buildCommand 가 파라미터 줄을 앞에 붙여 -Command 로 전달한다.
#   (스크립트 파일 실행 정책을 바꾸지 않기 위함)
# - 큰따옴표를 쓰지 않는다. 명령줄 인자로 전달될 때 인용 문제가 생기지 않게 하기 위함이다.
# - 키 입력 주입, 마우스 이벤트 합성, 화면 캡처 API 호출, 프로세스 강제 종료는 하지 않는다.
# - 상주 모드에서도 정해진 명령(ping/running/invoke/close/minimize)만 처리한다. 임의 코드 실행 통로는 없다.
# - '새 캡처'는 찾으면 한 번만 누르고 끝낸다(누른 뒤 확인/다시 누르기 없음).
#   캡처 도구 창이 나타나지 않으면(차단 등) 누를 대상이 없어 누르지 않는다.
#
# 앞에 붙는 파라미터
#   $Mode          : server | running | invoke | close | minimize
#   $ProcessNames  : 캡처 도구 프로세스 이름(확장자 제외)
#   $WindowTitles  : ApplicationFrameHost 로 호스팅되는 앱(캡처 및 스케치)의 창 제목
#   $AutomationIds : '새 캡처' 버튼 AutomationId 후보
#   $ButtonNames   : '새 캡처' 버튼 이름 후보
#   $TimeoutMs     : invoke 의 창/버튼 대기 최대 시간(상주 모드에서는 명령 인자로 덮어씀)
#
# 출력
#   결과 줄: RESULT:<코드>:<설명>
#     running  : 0 <pid>-<pid> / 2 none
#     invoke   : 0 invoked / 2 window-not-found / 3 button-not-found / 4 invoke-failed / 4 no-invoke-pattern
#     close    : 0 closed / 2 window-not-found / 4 close-failed
#     minimize : 0 minimized / 2 window-not-found / 4 minimize-failed
#     공통     : 1 error / 5 uia-unavailable / 9 unknown-command
#   invoke 코드 3 일 때 진단용 BUTTONS:<이름:ID>|... 줄을 먼저 출력한다.
#     영숫자/공백 외 문자는 \uXXXX 로 이스케이프(콘솔 코드 페이지와 무관하게 전달)
#   상주 모드: 준비되면 READY 한 줄, 이후 요청 줄 <id> <명령> [인자] 마다 응답 줄 앞에 <id> 를 붙인다.
#
# 이름 정규화 규칙은 newCaptureCore.normalizeButtonName 과 같게 유지한다.

$ErrorActionPreference = 'Stop'

try {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
} catch {
  Write-Output 'RESULT:5:uia-unavailable'
  exit 5
}

$AE = [System.Windows.Automation.AutomationElement]
$TreeScope = [System.Windows.Automation.TreeScope]
$ButtonCond = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)

# 버튼 속성을 한 번에 받아오기 위한 캐시 요청(프로세스 간 왕복 횟수 감소)
$ButtonCache = New-Object System.Windows.Automation.CacheRequest
$ButtonCache.Add($AE::NameProperty)
$ButtonCache.Add($AE::AutomationIdProperty)
$ButtonCache.Add($AE::IsEnabledProperty)

function Get-NormalizedName([string]$s) {
  if (-not $s) { return '' }
  $t = $s -replace '&', ''
  # 끝에 붙은 단축키 표기 제거: (Ctrl+N), Ctrl+N, (컨트롤+Shift+N) 등
  $t = $t -replace '\s*\(?\s*(ctrl|control|컨트롤)(\s*\+\s*[A-Za-z0-9]+)+\s*\)?\s*$', ''
  # 끝의 니모닉 표기 제거: (N)
  $t = $t -replace '\s*\([A-Za-z]\)\s*$', ''
  $t = $t -replace '\s+', ' '
  return $t.Trim().ToLowerInvariant()
}

function ConvertTo-Escaped([string]$s) {
  if (-not $s) { return '' }
  $sb = New-Object System.Text.StringBuilder
  foreach ($ch in $s.ToCharArray()) {
    $c = [int]$ch
    if (($c -ge 48 -and $c -le 57) -or ($c -ge 65 -and $c -le 90) -or ($c -ge 97 -and $c -le 122) -or $c -eq 32) {
      [void]$sb.Append($ch)
    } else {
      [void]$sb.Append(('\u{0:x4}' -f $c))
    }
  }
  return $sb.ToString()
}

$NameSet = @{}
foreach ($n in $ButtonNames) {
  $key = Get-NormalizedName $n
  if ($key) { $NameSet[$key] = $true }
}
$IdSet = @{}
foreach ($i in $AutomationIds) { $IdSet[$i] = $true }

# AutomationId 로 바로 찾기 위한 조건(빠른 경로). 못 찾으면 모든 버튼을 훑어 이름으로 비교한다.
$IdConds = @($AutomationIds | ForEach-Object { New-Object System.Windows.Automation.PropertyCondition($AE::AutomationIdProperty, $_) })
$IdCond = $null
if ($IdConds.Count -eq 1) { $IdCond = $IdConds[0] }
elseif ($IdConds.Count -gt 1) { $IdCond = [System.Windows.Automation.OrCondition]::new([System.Windows.Automation.Condition[]]$IdConds) }

function Get-SnipPids {
  return @(Get-Process -Name $ProcessNames -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
}

# 캡처 도구 최상위 창 목록. $visibleOnly 이면 최소화 등으로 화면에 없는 창은 제외한다.
function Get-SnipWindows($pids, [bool]$visibleOnly) {
  $result = @()
  if ($pids.Count -eq 0) { return $result }
  $windows = $AE::RootElement.FindAll($TreeScope::Children, [System.Windows.Automation.Condition]::TrueCondition)
  foreach ($w in $windows) {
    try {
      if ($visibleOnly -and $w.Current.IsOffscreen) { continue }
      $isTarget = $pids -contains $w.Current.ProcessId
      if (-not $isTarget -and $w.Current.ClassName -eq 'ApplicationFrameWindow') {
        $isTarget = $WindowTitles -contains $w.Current.Name
      }
      if ($isTarget) { $result += $w }
    } catch {
      # 조회 도중 창이 사라진 경우 무시
    }
  }
  return $result
}

# '새 캡처' 버튼을 한 번 누른다. 누른 뒤 확인하거나 다시 누르지 않는다.
function Invoke-ButtonOnce($b) {
  $pattern = $null
  if (-not $b.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
    return @('RESULT:4:no-invoke-pattern')
  }
  try {
    $pattern.Invoke()
    return @('RESULT:0:invoked')
  } catch {
    return @('RESULT:4:invoke-failed')
  }
}

function Invoke-Running {
  $pids = Get-SnipPids
  if ($pids.Count -eq 0) { return @('RESULT:2:none') }
  return @('RESULT:0:' + ($pids -join '-'))
}

# '새 캡처' 버튼을 찾아 누른다. 창이 뜰 때까지 기다리는 동안만 반복 조회한다.
# 찾으면 한 번만 누르고 끝낸다(Invoke-ButtonOnce).
function Invoke-NewCapture([int]$timeoutMs) {
  $deadline = (Get-Date).AddMilliseconds($timeoutMs)
  $foundWindow = $false
  $seen = New-Object System.Collections.Generic.List[string]

  while ((Get-Date) -lt $deadline) {
    $seen.Clear()
    $windows = Get-SnipWindows (Get-SnipPids) $false
    foreach ($w in $windows) {
      try {
        $foundWindow = $true

        # 빠른 경로: AutomationId 로 바로 찾기
        if ($IdCond) {
          $fast = $w.FindFirst($TreeScope::Descendants, $IdCond)
          if ($fast -and $fast.Current.IsEnabled) {
            # 버튼을 누른 뒤에는 바깥 조회 루프로 돌아가 다시 누르는 일이 없도록 여기서 끝낸다.
            try {
              return Invoke-ButtonOnce $fast
            } catch {
              return @('RESULT:4:invoke-failed')
            }
          }
        }

        $handle = $ButtonCache.Activate()
        try {
          $buttons = $w.FindAll($TreeScope::Descendants, $ButtonCond)
        } finally {
          $handle.Dispose()
        }
        foreach ($b in $buttons) {
          $rawName = $b.Cached.Name
          $id = $b.Cached.AutomationId
          if (($rawName -or $id) -and $seen.Count -lt 15) {
            $seen.Add((ConvertTo-Escaped $rawName) + ':' + (ConvertTo-Escaped $id))
          }
          $nm = Get-NormalizedName $rawName
          $matched = ($id -and $IdSet.ContainsKey($id)) -or ($nm -and $NameSet.ContainsKey($nm))
          if (-not $matched) { continue }
          # 창이 아직 준비되지 않아 비활성 상태면 다음 조회까지 기다린다.
          if (-not $b.Cached.IsEnabled) { continue }

          # 버튼을 누른 뒤에는 바깥 조회 루프로 돌아가 다시 누르는 일이 없도록 여기서 끝낸다.
          try {
            return Invoke-ButtonOnce $b
          } catch {
            return @('RESULT:4:invoke-failed')
          }
        }
      } catch {
        # 조회 도중 창이 닫히는 등 일시적인 UIA 오류는 무시하고 다음 조회에서 다시 확인한다.
      }
    }
    Start-Sleep -Milliseconds 100
  }

  if ($foundWindow) {
    return @(('BUTTONS:' + ($seen -join '|')), 'RESULT:3:button-not-found')
  }
  return @('RESULT:2:window-not-found')
}

# 화면에 보이는 캡처 도구 창을 한 번 닫거나 최소화한다(X/최소화 버튼과 같은 창 동작).
function Set-SnipWindowState([string]$action) {
  $windows = Get-SnipWindows (Get-SnipPids) $true
  if ($windows.Count -eq 0) { return @('RESULT:2:window-not-found') }
  $done = 0
  foreach ($w in $windows) {
    try {
      $pattern = $null
      if ($w.TryGetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern, [ref]$pattern)) {
        if ($action -eq 'close') {
          $pattern.Close()
          $done++
        } elseif ($pattern.Current.CanMinimize) {
          $pattern.SetWindowVisualState([System.Windows.Automation.WindowVisualState]::Minimized)
          $done++
        }
      }
    } catch {
      # 처리 도중 창이 사라지는 등 일시적인 오류는 무시한다(재시도하지 않음).
    }
  }
  if ($done -eq 0) {
    if ($action -eq 'close') { return @('RESULT:4:close-failed') }
    return @('RESULT:4:minimize-failed')
  }
  if ($action -eq 'close') { return @('RESULT:0:closed') }
  return @('RESULT:0:minimized')
}

function Invoke-UiaCommand([string]$cmd, [string]$arg) {
  try {
    switch ($cmd) {
      'ping' { return @('RESULT:0:pong') }
      'running' { return Invoke-Running }
      'invoke' {
        $t = $TimeoutMs
        if ($arg -match '^\d{1,5}$') { $t = [int]$arg }
        return Invoke-NewCapture $t
      }
      'close' { return Set-SnipWindowState 'close' }
      'minimize' { return Set-SnipWindowState 'minimize' }
      default { return @('RESULT:9:unknown-command') }
    }
  } catch {
    return @('RESULT:1:error')
  }
}

if ($Mode -ne 'server') {
  $code = 1
  foreach ($l in (Invoke-UiaCommand $Mode '')) {
    Write-Output $l
    if ($l -match '^RESULT:(\d+):') { $code = [int]$Matches[1] }
  }
  exit $code
}

# 상주 모드: 표준 입력으로 한 줄씩 요청을 받아 처리한다. 입력이 닫히면 종료한다.
[Console]::Out.WriteLine('READY')
[Console]::Out.Flush()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $parts = $line.Trim().Split(' ')
  if ($parts.Count -lt 2) { continue }
  $reqId = $parts[0]
  if ($reqId -notmatch '^\d{1,9}$') { continue }
  $reqArg = ''
  if ($parts.Count -gt 2) { $reqArg = $parts[2] }
  foreach ($l in (Invoke-UiaCommand $parts[1] $reqArg)) {
    [Console]::Out.WriteLine($reqId + ' ' + $l)
  }
  [Console]::Out.Flush()
}
exit 0
