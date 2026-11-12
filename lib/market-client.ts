// 시장 분석 데이터 받기 — 브라우저에서 우리 서버 라우트(/api/…)만 부른다. 인증키는 여기 없다.
// 브라우저는 지역 이름만 보내고, 법정동코드 확인은 서버가 한다.

import { lastMonths, previousMonth, type CompetitionRow, type ModelRow, type PresaleDeal, type RegionCandidate, type RentDeal, type SubscriptionItem } from "./market";

/** 한 번에 부르는 최대 요청 수 */
export const CONCURRENCY = 4;

/** 받아 온 시장 데이터 — 표는 이 값으로 lib/market.ts가 계산한다 */
export interface MarketData {
  area: string; // 서버가 확인한 시군구 이름
  months: string[]; // 조회 계약월 12개
  presale: Record<string, { deals: PresaleDeal[]; cancelled: number; fetchedAt: string }>;
  rent: Record<string, { deals: RentDeal[]; fetchedAt: string }>;
  sub: { items: SubscriptionItem[]; remainders: SubscriptionItem[]; since: string; fetchedAt: string } | null;
  details: Record<string, { models: ModelRow[]; competition: CompetitionRow[]; fetchedAt: string }>;
}

/** 요청 하나 — 종류 · 주소 · 상태 */
export interface Task {
  key: string;
  kind: "presale" | "rent" | "subscription" | "detail";
  url: string;
  status: "pending" | "running" | "done" | "error";
  error?: string;
}

/** 빈 시장 데이터를 만든다 — 계약월은 지난달부터 거꾸로 12개월 */
export function emptyMarket(area: string, today = new Date()): MarketData {
  return { area, months: lastMonths(previousMonth(today), 12), presale: {}, rent: {}, sub: null, details: {} };
}

/** 첫 요청 목록 — 청약홈 목록을 맨 앞에 두어 단지 상세 요청을 빨리 붙인다 */
export function initialTasks(m: MarketData): Task[] {
  const a = encodeURIComponent(m.area);
  return [
    { key: "subscription", kind: "subscription", url: `/api/market/subscription?area=${a}`, status: "pending" },
    ...m.months.map((ym): Task => ({ key: `presale-${ym}`, kind: "presale", url: `/api/market/presale?area=${a}&ym=${ym}`, status: "pending" })),
    ...m.months.map((ym): Task => ({ key: `rent-${ym}`, kind: "rent", url: `/api/market/rent?area=${a}&ym=${ym}`, status: "pending" })),
  ];
}

/** 청약홈 단지별 상세 요청 목록 */
export function detailTasks(items: SubscriptionItem[]): Task[] {
  return items.map((it) => ({
    key: `detail-${it.id}-${it.pblanc}`,
    kind: "detail",
    url: `/api/market/subscription/detail?id=${encodeURIComponent(it.id)}&pblanc=${encodeURIComponent(it.pblanc)}`,
    status: "pending",
  }));
}

/** 서버 라우트를 불러 JSON을 받는다. 오류면 서버가 준 메시지로 예외 */
export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* 본문 없음 */
  }
  if (!res.ok) throw new Error((body as { error?: string })?.error ?? `요청 실패 (HTTP ${res.status})`);
  return body as T;
}

/** 지역 확인 — 시군구 후보 */
export async function fetchRegion(q: string): Promise<RegionCandidate[]> {
  const r = await getJson<{ candidates: RegionCandidate[] }>(`/api/region?q=${encodeURIComponent(q)}`);
  return r.candidates;
}

/**
 * 요청 목록을 동시에 최대 limit개씩 처리한다. 처리 중에 목록에 요청이 더 붙으면(청약홈 상세) 그것도 처리한다.
 * exec는 요청 하나를 처리하고, 새로 붙일 요청이 있으면 돌려준다.
 */
export async function runPool(queue: Task[], exec: (t: Task) => Promise<Task[] | void>, limit = CONCURRENCY): Promise<void> {
  let next = 0;
  let running = 0;
  await new Promise<void>((resolve) => {
    const pump = () => {
      while (running < limit && next < queue.length) {
        const t = queue[next++];
        running++;
        exec(t)
          .then((more) => {
            if (more && more.length) queue.push(...more);
          })
          .catch(() => {
            /* 실패는 exec 안에서 기록한다 */
          })
          .finally(() => {
            running--;
            if (next >= queue.length && running === 0) resolve();
            else pump();
          });
      }
      if (next >= queue.length && running === 0) resolve();
    };
    pump();
  });
}
