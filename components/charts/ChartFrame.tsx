"use client";

// 차트 공통 틀 — 차트 · [표로 보기] 토글 · 자료 없음 · 아래 캡션(제목 · 단위 · 건수 · 조회일 · 출처)

import { useState, type ReactNode } from "react";

export interface Caption {
  title: string;
  unit: string;
  count: string;
  fetchedAt: string;
  source: string;
}

/** 차트 한 개를 감싼다. empty면 축 대신 "자료 없음"만 보인다. */
export default function ChartFrame({
  caption,
  empty,
  emptyText = "자료 없음",
  chart,
  table,
}: {
  caption: Caption;
  empty: boolean;
  emptyText?: string;
  chart: ReactNode;
  table: ReactNode;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <figure className="chart">
      {!empty && (
        <div className="chart-tools no-print">
          <button type="button" className="ghost small" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)}>
            {asTable ? "차트로 보기" : "표로 보기"}
          </button>
        </div>
      )}
      {empty ? <div className="chart-empty">{emptyText}</div> : asTable ? <div className="table-wrap">{table}</div> : chart}
      <figcaption>
        <strong>{caption.title}</strong> · 단위 {caption.unit} · 건수 {caption.count} · 조회일 {caption.fetchedAt || "-"} · 출처 {caption.source}
      </figcaption>
    </figure>
  );
}
