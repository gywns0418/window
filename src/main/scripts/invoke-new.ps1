# 캡처 도구 창의 '새 캡처' 버튼을 UI Automation InvokePattern 으로 한 번 누른다.
#
# - 이 파일은 -File 로 실행하지 않는다. newCapture.js 가 파라미터 줄을 앞에 붙여 -Command 로 전달한다.
#   (스크립트 파일 실행 정책을 바꾸지 않기 위함)
# - 큰따옴표를 쓰지 않는다. 명령줄 인자로 전달될 때 인용 문제가 생기지 않게 하기 위함이다.
# - 키 입력 주입, 마우스 이벤트 합성, 화면 캡처 API 호출은 하지 않는다.
# - 버튼은 최대 한 번만 누른다. 창이 뜰 때까지 기다리는 동안만 반복 조회한다.
#
# 앞에 붙는 파라미터
#   $ProcessNames  : 캡처 도구 프로세스 이름(확장자 제외)
#   $WindowTitles  : ApplicationFrameHost 로 호스팅되는 앱(캡처 및 스케치)의 창 제목
#   $AutomationIds : '새 캡처' 버튼 AutomationId 후보
#   $ButtonNames   : '새 캡처' 버튼 이름 후보
#   $TimeoutMs     : 창/버튼 대기 최대 시간
#
# 출력
#   RESULT:<코드>:<설명> 한 줄
#     0 invoked / 2 window-not-found / 3 button-not-found / 4 invoke-failed / 5 uia-unavailable
#   코드 3 일 때 진단용으로 BUTTONS:<항목>|<항목>... 한 줄을 먼저 출력한다.
#     항목 = 이름:AutomationId, 영숫자/공백 외 문자는 \uXXXX 로 이스케이프(콘솔 코드 페이지와 무관하게 전달)
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

$nameSet = @{}
foreach ($n in $ButtonNames) {
  $key = Get-NormalizedName $n
  if ($key) { $nameSet[$key] = $true }
}
$idSet = @{}
foreach ($i in $AutomationIds) { $idSet[$i] = $true }

$AE = [System.Windows.Automation.AutomationElement]
$root = $AE::RootElement
$buttonCond = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
$deadline = (Get-Date).AddMilliseconds($TimeoutMs)
$foundWindow = $false
$seen = New-Object System.Collections.Generic.List[string]

while ((Get-Date) -lt $deadline) {
  $seen.Clear()
  $pids = @(Get-Process -Name $ProcessNames -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
  if ($pids.Count -gt 0) {
    $windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($w in $windows) {
      try {
        $isTarget = $pids -contains $w.Current.ProcessId
        if (-not $isTarget -and $w.Current.ClassName -eq 'ApplicationFrameWindow') {
          $isTarget = $WindowTitles -contains $w.Current.Name
        }
        if (-not $isTarget) { continue }
        $foundWindow = $true

        $buttons = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, $buttonCond)
        foreach ($b in $buttons) {
          $rawName = $b.Current.Name
          $id = $b.Current.AutomationId
          if (($rawName -or $id) -and $seen.Count -lt 15) {
            $seen.Add((ConvertTo-Escaped $rawName) + ':' + (ConvertTo-Escaped $id))
          }
          $nm = Get-NormalizedName $rawName
          $matched = ($id -and $idSet.ContainsKey($id)) -or ($nm -and $nameSet.ContainsKey($nm))
          if (-not $matched) { continue }
          # 창이 아직 준비되지 않아 비활성 상태면 다음 조회까지 기다린다.
          if (-not $b.Current.IsEnabled) { continue }

          $pattern = $null
          if (-not $b.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
            Write-Output 'RESULT:4:no-invoke-pattern'
            exit 4
          }
          try {
            $pattern.Invoke()
            Write-Output 'RESULT:0:invoked'
            exit 0
          } catch {
            Write-Output 'RESULT:4:invoke-failed'
            exit 4
          }
        }
      } catch {
        # 조회 도중 창이 닫히는 등 일시적인 UIA 오류는 무시하고 다음 조회에서 다시 확인한다.
      }
    }
  }
  Start-Sleep -Milliseconds 200
}

if ($foundWindow) {
  Write-Output ('BUTTONS:' + ($seen -join '|'))
  Write-Output 'RESULT:3:button-not-found'
  exit 3
}
Write-Output 'RESULT:2:window-not-found'
exit 2
