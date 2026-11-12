// 시장 분석 — 공공데이터 응답을 정리하고 네 표 · 시장 대비 여유를 계산하는 순수 함수.
// 서버(라우트)와 화면이 함께 쓴다. 인증키 · 네트워크 호출은 여기 두지 않는다(lib/public-data.ts).
// 단위: 실거래 금액 · 분양가 만원, 평당가 만원/평, 면적 ㎡ · 평(1평 = 3.3058㎡).

const PYEONG_M2 = 3.3058;

// ───────────── 공통 형태 ─────────────

/** 시군구 후보 — 법정동코드 앞 5자리(실거래 LAWD_CD)와 전체 이름 */
export interface RegionCandidate {
  code5: string;
  name: string;
}

/** 분양권 · 입주권 실거래 한 건 */
export interface PresaleDeal {
  aptNm: string;
  umdNm: string;
  exclusiveM2: number;
  amount: number; // 거래금액(만원)
  ym: string; // 계약년월 YYYYMM
  day: number;
  floor: number | null;
  ownership: "분양권" | "입주권";
}

/** 아파트 전월세 실거래 한 건 */
export interface RentDeal {
  aptNm: string;
  umdNm: string;
  exclusiveM2: number;
  deposit: number; // 보증금(만원)
  monthlyRent: number; // 월세(만원), 0이면 전세
  buildYear: number | null;
  ym: string;
}

/** 청약홈 APT 분양 공고 한 건 */
export interface SubscriptionItem {
  id: string; // 주택관리번호
  pblanc: string; // 공고번호
  name: string;
  address: string; // 공급위치
  noticeDate: string; // 모집공고일 YYYY-MM-DD
  totalUnits: number | null; // 공급규모(잔여세대 공고는 잔여 공급 세대수)
  moveIn: string; // 입주예정월 YYYYMM
}

/** 청약홈 주택형별 분양정보 */
export interface ModelRow {
  houseTy: string; // 주택형 원문 예: 084.8860A
  exclusiveM2: number | null; // 주택형에서 읽은 전용면적
  supplyM2: number | null; // 공급면적(㎡)
  units: number; // 일반공급 + 특별공급 세대수
  topAmount: number | null; // 공급금액 — 분양최고금액(만원)
}

/** 청약홈 주택형별 경쟁률 한 줄(순위 · 거주지역별) */
export interface CompetitionRow {
  houseTy: string;
  rank: number; // 1 · 2순위
  resideName: string; // 해당지역 · 기타지역 등
  supplyUnits: number; // 공급세대수
  reqCnt: number; // 접수건수
  rateText: string; // 경쟁률 원문 — 미달은 "(△28)"처럼 온다
}

/** 단지 하나의 상세 — 공고 · 주택형 · 경쟁률 */
export interface SubscriptionDetail {
  item: SubscriptionItem;
  models: ModelRow[];
  competition: CompetitionRow[];
}

/** 표 공통 머리 — 지역 · 건수 · 제외 기준 · 조회일 */
export interface TableMeta {
  area: string;
  count: number;
  excluded: string[];
  fetchedAt: string;
}

// ───────────── 법정동코드 → 시군구 후보 ─────────────

/** 법정동코드 API 한 줄에서 쓰는 항목 */
export interface StanReginRow {
  region_cd: string;
  locatadd_nm: string;
  sgg_cd: string;
  umd_cd: string;
  ri_cd: string;
}

/**
 * 법정동코드 응답에서 실거래 조회에 쓸 시군구 후보를 고른다.
 * - 시군구 줄만(읍면동 · 리 제외, 시도 자체 제외)
 * - 아래에 구가 있는 시(예: 경기도 수원시)는 뺀다 — 실거래는 구 코드로만 나오기 때문
 * - 입력과 이름이 정확히 같은 후보가 있으면 그것만 돌려준다
 */
export function pickSggCandidates(rows: StanReginRow[], q: string): RegionCandidate[] {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  const sgg = rows
    .filter((r) => r.sgg_cd !== "000" && r.umd_cd === "000" && r.ri_cd === "00")
    .map((r) => ({ code5: r.region_cd.slice(0, 5), name: norm(r.locatadd_nm) }));
  const leaves = sgg.filter((c) => !sgg.some((o) => o !== c && o.name.startsWith(`${c.name} `)));
  const exact = leaves.filter((c) => c.name === norm(q));
  return exact.length > 0 ? exact : leaves;
}

// ───────────── 응답 파싱 ─────────────

/** 숫자 문자열("142,840", " 84.99 ")을 숫자로. 빈 값 · 숫자가 아니면 null */
export function toNum(s: unknown): number | null {
  if (s === null || s === undefined) return null;
  const t = String(s).replace(/,/g, "").trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** XML 특수문자를 되돌린다 */
function unescapeXml(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

/**
 * 국토부 실거래가 XML 응답을 읽는다. <item> 안의 평평한 태그만 꺼낸다.
 * resultCode가 000이 아니거나 공공데이터포털 오류 응답(returnReasonCode)이면 ok=false.
 */
export function parseRtmsXml(xml: string): { ok: boolean; code: string; message: string; totalCount: number; items: Record<string, string>[] } {
  const tag = (name: string, src: string) => {
    const m = src.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
    return m ? unescapeXml(m[1]).trim() : "";
  };
  const reason = tag("returnReasonCode", xml);
  if (reason) {
    return { ok: false, code: reason, message: tag("returnAuthMsg", xml) || tag("errMsg", xml) || "공공데이터포털 오류", totalCount: 0, items: [] };
  }
  const code = tag("resultCode", xml);
  const message = tag("resultMsg", xml);
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
    const rec: Record<string, string> = {};
    for (const f of m[1].matchAll(/<(\w+)>([\s\S]*?)<\/\1>/g)) rec[f[1]] = unescapeXml(f[2]).trim();
    return rec;
  });
  // 000 = 정상, 03 = 데이터 없음(오류 아님)
  const ok = code === "000" || code === "00" || code === "03";
  return { ok, code, message, totalCount: toNum(tag("totalCount", xml)) ?? items.length, items };
}

/** 분양권전매 응답 한 건을 정리한다. 해제 거래는 cancelled=true. 구분 "입"은 입주권, 나머지는 분양권. */
export function toPresaleDeal(rec: Record<string, string>): { deal: PresaleDeal; cancelled: boolean } | null {
  const ex = toNum(rec.excluUseAr);
  const amount = toNum(rec.dealAmount);
  const y = rec.dealYear;
  const mo = toNum(rec.dealMonth);
  if (ex === null || amount === null || !y || mo === null) return null;
  return {
    deal: {
      aptNm: rec.aptNm ?? "",
      umdNm: rec.umdNm ?? "",
      exclusiveM2: ex,
      amount,
      ym: `${y}${String(mo).padStart(2, "0")}`,
      day: toNum(rec.dealDay) ?? 0,
      floor: toNum(rec.floor),
      ownership: (rec.ownershipGbn ?? "").startsWith("입") ? "입주권" : "분양권",
    },
    cancelled: (rec.cdealType ?? "").trim() !== "",
  };
}

/** 전월세 응답 한 건을 정리한다 (기술문서에 해제 항목이 없다) */
export function toRentDeal(rec: Record<string, string>): RentDeal | null {
  const ex = toNum(rec.excluUseAr);
  const deposit = toNum(rec.deposit);
  const y = rec.dealYear;
  const mo = toNum(rec.dealMonth);
  if (ex === null || deposit === null || !y || mo === null) return null;
  return {
    aptNm: rec.aptNm ?? "",
    umdNm: rec.umdNm ?? "",
    exclusiveM2: ex,
    deposit,
    monthlyRent: toNum(rec.monthlyRent) ?? 0,
    buildYear: toNum(rec.buildYear),
    ym: `${y}${String(mo).padStart(2, "0")}`,
  };
}

/** 청약홈 공고 한 건(JSON 객체)을 정리한다 */
export function toSubscriptionItem(d: Record<string, unknown>): SubscriptionItem {
  return {
    id: String(d.HOUSE_MANAGE_NO ?? ""),
    pblanc: String(d.PBLANC_NO ?? ""),
    name: String(d.HOUSE_NM ?? ""),
    address: String(d.HSSPLY_ADRES ?? ""),
    noticeDate: String(d.RCRIT_PBLANC_DE ?? ""),
    totalUnits: toNum(d.TOT_SUPLY_HSHLDCO),
    moveIn: String(d.MVN_PREARNGE_YM ?? ""),
  };
}

/** 주택형 원문("084.8860A")에서 전용면적(㎡)을 읽는다 */
export function houseTyToM2(houseTy: string): number | null {
  const m = String(houseTy).match(/\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/** 청약홈 주택형별 분양정보 한 줄을 정리한다 */
export function toModelRow(d: Record<string, unknown>): ModelRow {
  const houseTy = String(d.HOUSE_TY ?? "").trim();
  return {
    houseTy,
    exclusiveM2: houseTyToM2(houseTy),
    supplyM2: toNum(d.SUPLY_AR),
    units: (toNum(d.SUPLY_HSHLDCO) ?? 0) + (toNum(d.SPSPLY_HSHLDCO) ?? 0),
    topAmount: toNum(d.LTTOT_TOP_AMOUNT),
  };
}

/** 청약홈 경쟁률 한 줄을 정리한다 */
export function toCompetitionRow(d: Record<string, unknown>): CompetitionRow {
  return {
    houseTy: String(d.HOUSE_TY ?? "").trim(),
    rank: toNum(d.SUBSCRPT_RANK_CODE) ?? 0,
    resideName: String(d.RESIDE_SENM ?? ""),
    supplyUnits: toNum(d.SUPLY_HSHLDCO) ?? 0,
    reqCnt: toNum(d.REQ_CNT) ?? 0,
    rateText: String(d.CMPET_RATE ?? ""),
  };
}

// ───────────── 공통 도우미 ─────────────

/** 84㎡형인지 — 전용 84.00 ~ 85.99㎡ */
export function is84(m2: number | null): boolean {
  return m2 !== null && m2 >= 84 && m2 < 86;
}

/** 단지명 비교용 — 공백 · 괄호 · 기호를 지우고 소문자로 */
export function normalizeName(s: string): string {
  return s.replace(/\(.*?\)/g, "").replace(/[\s·\-_.,'"]/g, "").toLowerCase();
}

/** 기준월(YYYYMM)부터 거꾸로 n개월 목록 — 오래된 달부터 */
export function lastMonths(endYm: string, n: number): string[] {
  let y = Number(endYm.slice(0, 4));
  let m = Number(endYm.slice(4, 6));
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.unshift(`${y}${String(m).padStart(2, "0")}`);
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

/** 오늘 날짜에서 지난달(YYYYMM)을 구한다 — 이번 달은 신고 기한(30일) 전이라 뺀다 */
export function previousMonth(today: Date): string {
  const d = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** 평균. 빈 배열이면 null */
function mean(xs: number[]): number | null {
  return xs.length === 0 ? null : xs.reduce((s, x) => s + x, 0) / xs.length;
}

// ───────────── 표 1: 인근 신규 84㎡ 공급평당 vs 계획가 ─────────────

export interface SupplyPriceRow {
  name: string;
  noticeDate: string;
  houseTy: string;
  supplyPyeong: number;
  topAmount: number; // 만원
  pricePerPyeong: number; // 만원/평(공급)
  units: number;
}

/**
 * 인근 신규 분양 84㎡형의 공급평당 분양가(분양최고금액 ÷ 공급면적(평)).
 * 평균은 공급 세대수 가중. 계획가 대비 차이 = 계획가 ÷ 인근 평균 − 1.
 */
export function supplyPriceTable(details: SubscriptionDetail[], planPrice: number | null) {
  const rows: SupplyPriceRow[] = [];
  let not84 = 0;
  let noPrice = 0;
  for (const d of details) {
    for (const m of d.models) {
      if (!is84(m.exclusiveM2)) {
        not84++;
        continue;
      }
      if (m.topAmount === null || m.topAmount <= 0 || m.supplyM2 === null || m.supplyM2 <= 0) {
        noPrice++;
        continue;
      }
      const supplyPyeong = m.supplyM2 / PYEONG_M2;
      rows.push({
        name: d.item.name,
        noticeDate: d.item.noticeDate,
        houseTy: m.houseTy,
        supplyPyeong,
        topAmount: m.topAmount,
        pricePerPyeong: m.topAmount / supplyPyeong,
        units: m.units,
      });
    }
  }
  const totalUnits = rows.reduce((s, r) => s + r.units, 0);
  const avg =
    rows.length === 0
      ? null
      : totalUnits > 0
        ? rows.reduce((s, r) => s + r.pricePerPyeong * r.units, 0) / totalUnits
        : mean(rows.map((r) => r.pricePerPyeong));
  const diffPct = avg !== null && planPrice !== null && avg > 0 ? (planPrice / avg - 1) * 100 : null;
  return {
    rows: rows.sort((a, b) => b.noticeDate.localeCompare(a.noticeDate)),
    complexes: new Set(rows.map((r) => r.name)).size,
    avg,
    diffPct,
    excluded: { not84, noPrice },
  };
}

// ───────────── 표 2: 분양권 웃돈 (입주권 제외) ─────────────

export interface PremiumRow {
  name: string;
  deals: number;
  avgPremium: number; // 만원
  avgPremiumPct: number; // 분양가 대비 %
  minusDeals: number; // 마이너스 거래 수
}

/**
 * 분양권 웃돈 = 거래금액 − 같은 단지 · 같은 전용면적(±0.5㎡) 주택형의 분양최고금액.
 * 분양최고금액 기준이라 실제 웃돈보다 작게 나온다. 입주권 · 청약홈과 짝을 못 찾은 거래는 제외.
 */
export function premiumTable(deals: PresaleDeal[], details: SubscriptionDetail[]) {
  const byName = new Map<string, SubscriptionDetail>();
  for (const d of details) byName.set(normalizeName(d.item.name), d);
  let moveInRights = 0;
  let unmatched = 0;
  const groups = new Map<string, { premiums: number[]; pcts: number[] }>();
  for (const deal of deals) {
    if (deal.ownership === "입주권") {
      moveInRights++;
      continue;
    }
    const d = byName.get(normalizeName(deal.aptNm));
    const model = d?.models
      .filter((m) => m.exclusiveM2 !== null && m.topAmount !== null && m.topAmount > 0)
      .sort((a, b) => Math.abs((a.exclusiveM2 as number) - deal.exclusiveM2) - Math.abs((b.exclusiveM2 as number) - deal.exclusiveM2))[0];
    if (!d || !model || Math.abs((model.exclusiveM2 as number) - deal.exclusiveM2) > 0.5) {
      unmatched++;
      continue;
    }
    const premium = deal.amount - (model.topAmount as number);
    const g = groups.get(d.item.name) ?? { premiums: [], pcts: [] };
    g.premiums.push(premium);
    g.pcts.push((premium / (model.topAmount as number)) * 100);
    groups.set(d.item.name, g);
  }
  const rows: PremiumRow[] = [...groups.entries()].map(([name, g]) => ({
    name,
    deals: g.premiums.length,
    avgPremium: mean(g.premiums) as number,
    avgPremiumPct: mean(g.pcts) as number,
    minusDeals: g.premiums.filter((p) => p < 0).length,
  }));
  const all = [...groups.values()].flatMap((g) => g.premiums);
  return {
    rows: rows.sort((a, b) => b.deals - a.deals),
    matched: all.length,
    avgPremium: mean(all),
    minusDeals: all.filter((p) => p < 0).length,
    excluded: { moveInRights, unmatched },
  };
}

// ───────────── 표 3: 1 · 2순위 미달 ─────────────

export interface ShortfallRow {
  name: string;
  noticeDate: string;
  houseTy: string;
  supplyUnits: number;
  rank1: number; // 1순위 접수(해당 + 기타지역)
  rank12: number; // 1 + 2순위 접수
  status: "1순위 마감" | "2순위 마감" | "2순위까지 미달";
}

/**
 * 주택형별로 1순위 접수 합계가 공급세대에 못 미치면 1순위 미달, 1 + 2순위 합계도 못 미치면 2순위까지 미달.
 * 접수건수 기준이며 계약률이 아니다.
 */
export function shortfallTable(details: SubscriptionDetail[]) {
  const rows: ShortfallRow[] = [];
  let noData = 0;
  for (const d of details) {
    if (d.competition.length === 0) {
      noData++;
      continue;
    }
    const byTy = new Map<string, CompetitionRow[]>();
    for (const c of d.competition) byTy.set(c.houseTy, [...(byTy.get(c.houseTy) ?? []), c]);
    for (const [houseTy, cs] of byTy) {
      const supply = Math.max(...cs.map((c) => c.supplyUnits));
      const rank1 = cs.filter((c) => c.rank === 1).reduce((s, c) => s + c.reqCnt, 0);
      const rank12 = cs.filter((c) => c.rank === 1 || c.rank === 2).reduce((s, c) => s + c.reqCnt, 0);
      const status = rank1 >= supply ? "1순위 마감" : rank12 >= supply ? "2순위 마감" : "2순위까지 미달";
      rows.push({ name: d.item.name, noticeDate: d.item.noticeDate, houseTy, supplyUnits: supply, rank1, rank12, status });
    }
  }
  return {
    rows: rows.sort((a, b) => b.noticeDate.localeCompare(a.noticeDate) || a.houseTy.localeCompare(b.houseTy)),
    rank1Short: rows.filter((r) => r.status !== "1순위 마감").length,
    rank2Short: rows.filter((r) => r.status === "2순위까지 미달").length,
    excluded: { noData },
  };
}

// ───────────── 표 4: 잔여세대 ─────────────

/** 잔여세대 공고 — 단지별 잔여 공급 세대수(최근 공고 순) */
export function remainderTable(items: SubscriptionItem[]) {
  const rows = [...items].sort((a, b) => b.noticeDate.localeCompare(a.noticeDate));
  return { rows, totalUnits: rows.reduce((s, r) => s + (r.totalUnits ?? 0), 0) };
}

// ───────────── 표 5: 84㎡ 신규 전세 ÷ 우리 84㎡ 세대당 분양가 ─────────────

/**
 * 잔금 여력 — 인근 신규(건축 5년 이내) 84㎡형 전세 보증금 평균 ÷ 우리 84㎡ 세대당 분양가.
 * 세대당 분양가(만원) = 공급면적(평) × 평당가(만원). 월세 · 84㎡ 외 · 구축은 제외.
 */
export function rentRatioTable(rents: RentDeal[], our84: { supplyPyeong: number; pricePerPyeong: number } | null, refYear: number) {
  let monthly = 0;
  let not84 = 0;
  let old = 0;
  const kept: RentDeal[] = [];
  for (const r of rents) {
    if (r.monthlyRent > 0) {
      monthly++;
      continue;
    }
    if (!is84(r.exclusiveM2)) {
      not84++;
      continue;
    }
    if (r.buildYear === null || r.buildYear < refYear - 5) {
      old++;
      continue;
    }
    kept.push(r);
  }
  const avgDeposit = mean(kept.map((r) => r.deposit));
  const ourPrice = our84 ? our84.supplyPyeong * our84.pricePerPyeong : null;
  return {
    count: kept.length,
    complexes: new Set(kept.map((r) => r.aptNm)).size,
    avgDeposit,
    ourPrice,
    ratioPct: avgDeposit !== null && ourPrice !== null && ourPrice > 0 ? (avgDeposit / ourPrice) * 100 : null,
    excluded: { monthly, not84, old },
  };
}

// ───────────── 시장 대비 여유 ─────────────

/**
 * 상환 한계 평당가와 인근 신규 84㎡ 공급평당 평균을 비교한다.
 * 여유(%) = 1 − 상환 한계 평당가 ÷ 인근 평균. 양수면 시장가가 한계선보다 그만큼 높다.
 */
export function marketMargin(pfLimitPrice: number | null, nearbyAvg: number | null): number | null {
  if (pfLimitPrice === null || nearbyAvg === null || nearbyAvg <= 0) return null;
  return (1 - pfLimitPrice / nearbyAvg) * 100;
}

/** 우리 사업의 84㎡ 주택형 — 전용 84 ~ 86㎡ 중 첫 번째, 없으면 이름에 "84"가 든 것 */
export function pickOur84<T extends { name: string; exclusiveM2: number | null; supplyPyeong: number | null }>(types: T[]): T | null {
  return types.find((t) => is84(t.exclusiveM2) && t.supplyPyeong !== null) ?? types.find((t) => t.name.includes("84") && t.supplyPyeong !== null) ?? null;
}
