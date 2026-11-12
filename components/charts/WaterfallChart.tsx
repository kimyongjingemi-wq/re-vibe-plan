"use client";

// 사업수지 폭포 — 분양수입 → 변동비 → 고정비 → 기타유입 → 기말현금.
// 숫자는 lib/calc waterfallSteps 결과만 쓴다. 상환 한계선(−후순위)과 상환 가능 여부도 lib/calc 값을 받는다.

import { useState } from "react";
import type { WaterfallStep } from "@/lib/calc";
import ChartFrame from "./ChartFrame";
import { fmtNum, fmtSigned, linear, niceTicks, useWidth } from "./scale";

interface Props {
  steps: WaterfallStep[];
  subordinated: number; // 후순위(억원) — −후순위 선
  repayable: boolean; // 기말현금 ≥ −후순위 (lib/calc canRepayPf)
  basis: string; // 계산 기준 설명 — 분양률 · 평당가
}

const BOTTOM = 40;
const H = 300;

export default function WaterfallChart({ steps, subordinated, repayable, basis }: Props) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const empty = steps.length === 0;

  const edges = steps.flatMap((s) => [s.start, s.end]);
  const ticks = niceTicks(Math.min(0, -subordinated, ...edges), Math.max(0, ...edges), 5);
  const narrow = width < 480; // 모바일: 글자를 줄이고 값 이름표를 두 높이로 엇갈려 놓는다
  const left = narrow ? 46 : 56;
  const right = 12;
  const TOP = narrow ? 40 : 24;
  const y = linear(ticks[0], ticks[ticks.length - 1], H - BOTTOM, TOP);
  const band = (width - left - right) / Math.max(1, steps.length);
  const barW = Math.min(64, band * 0.56);
  const cx = (i: number) => left + band * i + band / 2;

  /** 단계 종류별 막대 색 — 유입 강조색, 유출 회색, 기말현금은 상환 가능 초록 / 불가 빨강 */
  const cls = (s: WaterfallStep) => (s.kind === "inflow" ? "bar-plan" : s.kind === "outflow" ? "bar-market" : repayable ? "bar-ok" : "bar-bad");

  const chart = (
    <div className="chart-plot" ref={ref} onMouseLeave={() => setHover(null)}>
      <svg width={width} height={H} role="img" aria-label="사업수지 폭포 차트">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={width - right} y1={y(t)} y2={y(t)} className={t === 0 ? "zero" : "grid"} />
            <text x={left - 6} y={y(t) + 4} textAnchor="end" className="tick">
              {fmtNum(t)}
            </text>
          </g>
        ))}
        {/* 상환 한계선 = −후순위 */}
        <line x1={left} x2={width - right} y1={y(-subordinated)} y2={y(-subordinated)} className="line-bad" />
        <text x={left + 4} y={y(-subordinated) + 14} textAnchor="start" className={`line-label${narrow ? " small" : ""}`}>
          상환 한계 −후순위 {fmtNum(-subordinated, 1)}
        </text>
        {steps.map((s, i) => {
          const top = y(Math.max(s.start, s.end));
          const bottom = y(Math.min(s.start, s.end));
          const hgt = Math.max(2, bottom - top);
          const next = steps[i + 1];
          return (
            <g key={s.label} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0}>
              {/* 막대 위로 넓은 감지 영역 */}
              <rect x={cx(i) - band / 2} y={TOP} width={band} height={H - TOP - BOTTOM} className="hit" />
              <rect x={cx(i) - barW / 2} y={top} width={barW} height={hgt} rx={3} className={`${cls(s)}${hover === i ? " is-hover" : ""}`} />
              {next && next.kind !== "total" && (
                <line x1={cx(i) + barW / 2} x2={cx(i + 1) - barW / 2} y1={y(s.end)} y2={y(s.end)} className="connector" />
              )}
              <text x={cx(i)} y={top - 6 - (narrow && i % 2 === 1 ? 14 : 0)} textAnchor="middle" className={`value-label${narrow ? " small" : ""}`}>
                {s.kind === "total" ? fmtNum(s.value, 1) : fmtSigned(s.value, 1)}
              </text>
              <text x={cx(i)} y={H - BOTTOM + 18} textAnchor="middle" className={`tick${narrow ? " small" : ""}`}>
                {s.label}
              </text>
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div className="chart-tip" style={{ left: Math.min(Math.max(0, cx(hover) - 100), width - 220), top: 8 }}>
          <strong>{steps[hover].label}</strong> {steps[hover].kind === "total" ? fmtNum(steps[hover].value, 1) : fmtSigned(steps[hover].value, 1)}억원 · 누적 {fmtNum(steps[hover].end, 1)}억원
          <br />
          {steps[hover].formula}
        </div>
      )}
    </div>
  );

  const table = (
    <table>
      <thead>
        <tr>
          <th>단계</th>
          <th className="r">증감(억원)</th>
          <th className="r">누적(억원)</th>
          <th>계산</th>
        </tr>
      </thead>
      <tbody>
        {steps.map((s) => (
          <tr key={s.label}>
            <td>{s.label}</td>
            <td className={`r ${s.value < 0 ? "text-bad" : ""}`}>{s.kind === "total" ? fmtNum(s.value, 1) : fmtSigned(s.value, 1)}</td>
            <td className={`r ${s.end < 0 ? "text-bad" : ""}`}>{fmtNum(s.end, 1)}</td>
            <td className="formula-cell">{s.formula}</td>
          </tr>
        ))}
        <tr>
          <td>상환 한계</td>
          <td className="r">−후순위</td>
          <td className="r text-bad">{fmtNum(-subordinated, 1)}</td>
          <td className="formula-cell">기말현금이 이 값 이상이면 본PF 상환 가능 — {repayable ? "상환 가능" : "상환 불가"}</td>
        </tr>
      </tbody>
    </table>
  );

  return (
    <ChartFrame
      empty={empty}
      chart={chart}
      table={table}
      caption={{
        title: "그림 3-1. 사업수지 폭포 — 분양수입에서 기말현금까지",
        unit: "억원",
        count: `${steps.length}단계 · ${basis}`,
        fetchedAt: "해당 없음(입력값)",
        source: "입력값으로 계산한 사업수지",
      }}
    />
  );
}
