"use client";

// 시장 대비 여유 — 인근 신규 84㎡ 주택형의 공급평당가 점 분포 + 계획가 선 + 상환 한계 평당가 선 + 인근 평균 선.
// 숫자는 받은 값만 쓴다: 점 = lib/market supplyPriceTable 행, 평균 = 같은 표의 avg, 상환 한계 = lib/calc limitLines, 여유 = lib/market marketMargin.

import { useState } from "react";
import type { SupplyPriceRow } from "@/lib/market";
import ChartFrame from "./ChartFrame";
import { clip, fmtNum, linear, niceTicks, useWidth } from "./scale";

interface Props {
  rows: SupplyPriceRow[];
  complexes: number;
  nearbyAvg: number | null;
  planPrice: number | null;
  pfLimitPrice: number | null;
  margin: number | null;
  area: string;
  fetchedAt: string;
}

const ROW_H = 28;
const TIER_H = 16; // 선 이름표 한 줄 높이
const BOTTOM = 56; // 축 + 여유 표시

export default function MarketMarginChart(p: Props) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);

  // 단지별로 묶어 한 줄씩 — 표 순서(최근 공고 먼저)를 따른다
  const groups: { name: string; rows: SupplyPriceRow[] }[] = [];
  for (const r of p.rows) {
    const g = groups.find((x) => x.name === r.name);
    if (g) g.rows.push(r);
    else groups.push({ name: r.name, rows: [r] });
  }

  const empty = p.rows.length === 0;
  const lines = [
    { key: "plan", label: "계획가", value: p.planPrice, cls: "line-plan" },
    { key: "limit", label: "상환 한계", value: p.pfLimitPrice, cls: "line-bad" },
    { key: "avg", label: "인근 평균", value: p.nearbyAvg, cls: "line-market" },
  ].filter((l): l is { key: string; label: string; value: number; cls: string } => l.value !== null);

  const values = [...p.rows.map((r) => r.pricePerPyeong), ...lines.map((l) => l.value)];
  const ticks = niceTicks(Math.min(...values), Math.max(...values), width < 480 ? 4 : 6);
  const labelW = Math.min(150, Math.round(width * 0.32));
  const left = labelW + 8;
  const right = 16;
  const x = linear(ticks[0], ticks[ticks.length - 1], left, width - right);

  // 선 이름표 자리 — 왼쪽부터 놓으며, 같은 줄에서 글자 폭만큼 겹치면 다음 줄로 내린다
  const labelText = (l: { label: string; value: number }) => `${l.label} ${fmtNum(l.value)}`;
  const textW = (s: string) => s.length * 7 + 12; // 11.5px 글꼴 기준 대략 폭
  const tiers: { lo: number; hi: number }[][] = [];
  const tierOf = new Map<string, number>();
  for (const l of [...lines].sort((a, b) => x(a.value) - x(b.value))) {
    const w = textW(labelText(l));
    const lo = x(l.value) - w / 2;
    const hi = x(l.value) + w / 2;
    let t = 0;
    while (tiers[t]?.some((s) => lo < s.hi && hi > s.lo)) t++;
    (tiers[t] ??= []).push({ lo, hi });
    tierOf.set(l.key, t);
  }
  const TOP = 12 + Math.max(1, tiers.length) * TIER_H;
  const h = TOP + groups.length * ROW_H + BOTTOM;
  const plotBottom = TOP + groups.length * ROW_H;

  const chart = (
    <div className="chart-plot" ref={ref} onMouseLeave={() => setHover(null)}>
      <svg width={width} height={h} role="img" aria-label="인근 신규 84㎡ 공급평당가 분포와 계획가 · 상환 한계 평당가">
        {/* 눈금 · 격자 */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={TOP} y2={plotBottom} className="grid" />
            <text x={x(t)} y={plotBottom + 16} textAnchor="middle" className="tick">
              {fmtNum(t)}
            </text>
          </g>
        ))}
        {/* 단지 줄 */}
        {groups.map((g, i) => {
          const cy = TOP + i * ROW_H + ROW_H / 2;
          return (
            <g key={g.name}>
              <text x={labelW} y={cy + 4} textAnchor="end" className="row-label">
                <title>{g.name}</title>
                {clip(g.name, width < 480 ? 7 : 11)}
              </text>
              {g.rows.map((r, j) => (
                <circle
                  key={j}
                  cx={x(r.pricePerPyeong)}
                  cy={cy}
                  r={5}
                  className="dot-market"
                  tabIndex={0}
                  onMouseEnter={() => setHover({ x: x(r.pricePerPyeong), y: cy, text: `${r.name} ${r.houseTy} · ${fmtNum(r.pricePerPyeong)}만원/평 · 분양최고금액 ${fmtNum(r.topAmount)}만원` })}
                  onFocus={() => setHover({ x: x(r.pricePerPyeong), y: cy, text: `${r.name} ${r.houseTy} · ${fmtNum(r.pricePerPyeong)}만원/평` })}
                  onBlur={() => setHover(null)}
                />
              ))}
            </g>
          );
        })}
        {/* 기준선 3개 — 선 모양으로도 구분(실선 · 굵은 점선 · 가는 점선) */}
        {lines.map((l) => {
          const xv = x(l.value);
          const ty = 14 + (tierOf.get(l.key) ?? 0) * TIER_H;
          const half = textW(labelText(l)) / 2;
          const anchor = xv + half > width ? "end" : xv - half < 0 ? "start" : "middle";
          return (
            <g key={l.key}>
              <line x1={xv} x2={xv} y1={TOP - 4} y2={plotBottom} className={l.cls} />
              <text x={xv} y={ty} textAnchor={anchor} className="line-label">
                {labelText(l)}
              </text>
            </g>
          );
        })}
        {/* 시장 대비 여유: 상환 한계 ↔ 인근 평균 */}
        {p.margin !== null && p.pfLimitPrice !== null && p.nearbyAvg !== null && (
          <g>
            <line x1={x(p.pfLimitPrice)} x2={x(p.nearbyAvg)} y1={plotBottom + 34} y2={plotBottom + 34} className="margin-span" />
            <line x1={x(p.pfLimitPrice)} x2={x(p.pfLimitPrice)} y1={plotBottom + 28} y2={plotBottom + 40} className="margin-span" />
            <line x1={x(p.nearbyAvg)} x2={x(p.nearbyAvg)} y1={plotBottom + 28} y2={plotBottom + 40} className="margin-span" />
            <text x={(x(p.pfLimitPrice) + x(p.nearbyAvg)) / 2} y={plotBottom + 52} textAnchor="middle" className="margin-text">
              시장 대비 여유 {fmtNum(p.margin, 1)}%
            </text>
          </g>
        )}
      </svg>
      {hover && (
        <div className="chart-tip" style={{ left: Math.min(hover.x, width - 220), top: hover.y + 12 }}>
          {hover.text}
        </div>
      )}
    </div>
  );

  const table = (
    <table>
      <thead>
        <tr>
          <th>구분</th>
          <th>주택형</th>
          <th className="r">공급평당(만원/평)</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => (
          <tr key={l.key}>
            <td>
              <strong>{l.label}</strong>
            </td>
            <td>기준선</td>
            <td className="r">{fmtNum(l.value)}</td>
          </tr>
        ))}
        {p.margin !== null && (
          <tr>
            <td>
              <strong>시장 대비 여유</strong>
            </td>
            <td>1 − 상환 한계 ÷ 인근 평균</td>
            <td className="r">{fmtNum(p.margin, 1)}%</td>
          </tr>
        )}
        {p.rows.map((r, i) => (
          <tr key={i}>
            <td>{r.name}</td>
            <td>{r.houseTy}</td>
            <td className="r">{fmtNum(r.pricePerPyeong)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <ChartFrame
      empty={empty}
      emptyText="자료 없음 — 인근 신규 84㎡ 분양 공고가 없거나 아직 받지 못함"
      chart={chart}
      table={table}
      caption={{
        title: "그림 2-1. 시장 대비 여유 — 인근 신규 84㎡ 공급평당가 분포",
        unit: "만원/평(공급면적 기준)",
        count: `주택형 ${fmtNum(p.rows.length)}개 · ${fmtNum(p.complexes)}개 단지 (${p.area})`,
        fetchedAt: p.fetchedAt,
        source: "한국부동산원 청약홈 분양정보(분양최고금액) · 상환 한계는 사업수지 계산",
      }}
    />
  );
}
