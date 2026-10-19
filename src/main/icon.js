/**
 * 트레이/창 아이콘을 코드로 그린다(별도 바이너리 리소스 없이 동작하도록).
 * 파란 둥근 사각형 + 흰색 크롭 마크.
 */
'use strict';

const { nativeImage } = require('electron');

const COLOR = { r: 0x25, g: 0x63, b: 0xeb };

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function isCropMark(x, y, size) {
  const t = Math.max(1, Math.round(size / 12));
  const a = Math.round(size * 0.24);
  const b = size - a;
  const len = Math.round(size * 0.22);
  const inH = (x0, x1, y0) => y >= y0 && y < y0 + t && x >= x0 && x < x1;
  const inV = (x0, y0, y1) => x >= x0 && x < x0 + t && y >= y0 && y < y1;
  return (
    // 좌상
    inH(a, a + len, a) || inV(a, a, a + len) ||
    // 우상
    inH(b - len, b, a) || inV(b - t, a, a + len) ||
    // 좌하
    inH(a, a + len, b - t) || inV(a, b - len, b) ||
    // 우하
    inH(b - len, b, b - t) || inV(b - t, b - len, b)
  );
}

/** BGRA(premultiplied) 비트맵 버퍼 */
function drawBitmap(size) {
  const buf = Buffer.alloc(size * size * 4);
  const r = size * 0.22;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = x + 0.5;
      const cy = y + 0.5;
      const dx = Math.max(r - cx, cx - (size - r), 0);
      const dy = Math.max(r - cy, cy - (size - r), 0);
      const alpha = clamp01(r - Math.sqrt(dx * dx + dy * dy) + 0.5);
      const white = isCropMark(x, y, size);
      const cr = white ? 255 : COLOR.r;
      const cg = white ? 255 : COLOR.g;
      const cb = white ? 255 : COLOR.b;
      const i = (y * size + x) * 4;
      buf[i] = Math.round(cb * alpha);
      buf[i + 1] = Math.round(cg * alpha);
      buf[i + 2] = Math.round(cr * alpha);
      buf[i + 3] = Math.round(255 * alpha);
    }
  }
  return buf;
}

function fromSize(size, scaleFactor) {
  return nativeImage.createFromBitmap(drawBitmap(size), { width: size, height: size, scaleFactor });
}

let cached = null;

/** 16px 기준 + 고DPI(1.5x, 2x) 표현을 포함한 아이콘 */
function createAppIcon() {
  if (cached) return cached;
  const img = fromSize(16, 1);
  [
    [24, 1.5],
    [32, 2]
  ].forEach(([size, scaleFactor]) => {
    img.addRepresentation({ scaleFactor, width: size, height: size, buffer: fromSize(size, 1).toPNG() });
  });
  cached = img;
  return cached;
}

function createWindowIcon() {
  return fromSize(64, 1);
}

module.exports = { createAppIcon, createWindowIcon };
