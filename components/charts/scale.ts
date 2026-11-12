"use client";

// 차트 그리기 도우미 — 값을 화면 좌표로 옮기는 일만 한다. 사업 숫자는 계산하지 않는다(lib/calc · lib/market 결과만 받는다).

import { useCallback, useEffect, useState } from "react";

/** 축 눈금을 보기 좋은 간격(1 · 2 · 2.5 · 5 × 10^n)으로 만든다 */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const raw = (max - min) / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = start; v <= end + step / 2; v += step) out.push(Math.round(v / step) * step);
  return out;
}

/** 값 범위 [d0, d1]을 화면 범위 [r0, r1]로 옮기는 함수 */
export function linear(d0: number, d1: number, r0: number, r1: number) {
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  return (v: number) => r0 + (v - d0) * k;
}

/**
 * 감싸는 요소의 너비를 따라간다 — 모바일에서 글자가 작아지지 않게 픽셀로 그리기 위함.
 * 콜백 ref라서 요소가 늦게 나타나도(자료 없음 → 차트, 표 → 차트) 그때부터 잰다.
 */
export function useWidth<T extends HTMLElement>(initial = 640) {
  const [el, setEl] = useState<T | null>(null);
  const [width, setWidth] = useState(initial);
  const ref = useCallback((node: T | null) => setEl(node), []);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.floor(entries[0].contentRect.width);
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return { ref, width };
}

/** 천단위 콤마 — 음수는 유니코드 빼기(−)로 */
export function fmtNum(n: number, digits = 0): string {
  const s = Math.abs(n).toLocaleString("ko-KR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return n < 0 ? `−${s}` : s;
}

/** 부호를 붙인 값 — 증감 표시용 */
export function fmtSigned(n: number, digits = 0): string {
  return n > 0 ? `+${fmtNum(n, digits)}` : fmtNum(n, digits);
}

/** 긴 이름을 n글자로 줄인다 */
export function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
