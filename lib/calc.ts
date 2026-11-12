// 사업계획서 계산 — 순수 함수만 둔다. 화면(components)에서 계산하지 않는다.
// 단위: 금액 억원, 평당가 만원/평(공급면적 기준), 면적 공급면적은 평 · 전용면적은 ㎡.
// 범위: 입력값 정리(공급면적 합계 · 세대수) · 사업수지(분양수입 · 기말현금) · 만기 누적 DSCR · LTV · 한계선(이분법).

/** 주택형 한 줄 — 이름 · 전용면적(㎡) · 세대당 공급면적(평) · 세대수 */
export interface UnitType {
  name: string;
  exclusiveM2: number | null;
  supplyPyeong: number | null;
  units: number | null;
}

/** 사업계획서 입력값. 비어 있는 칸은 null로 둔다(0과 구분해 "자료 없음"을 표시하기 위함). */
export interface PlanInput {
  projectName: string; // 사업명
  site: string; // 사업대상지 — 시도 + 시군구 전체 이름
  unitTypes: UnitType[]; // 주택형 표
  pricePerPyeong: number | null; // 평당가(만원/평, 공급기준)
  retail: number | null; // 상가 분양수입(억원)
  otherInflow: number | null; // 기타유입(억원) — 자기자본 · 이자수입 등 분양대금 외 유입
  fixedCost: number | null; // 고정비(억원) — 토지 · 공사 · 간접비 · 금융비용
  pf: number | null; // 본PF(억원)
  pfFinanceCost: number | null; // 본PF 금융비용(억원) — 이자 · 수수료
  subordinated: number | null; // 후순위(억원) — 공사비 유보 · 시행사 대여금
}

/** 처음 화면에 쓰는 빈 입력값을 만든다. 주택형은 빈 줄 하나로 시작한다. */
export function emptyInput(): PlanInput {
  return {
    projectName: "",
    site: "",
    unitTypes: [{ name: "", exclusiveM2: null, supplyPyeong: null, units: null }],
    pricePerPyeong: null,
    retail: null,
    otherInflow: null,
    fixedCost: null,
    pf: null,
    pfFinanceCost: null,
    subordinated: null,
  };
}

/** 공급면적과 세대수가 모두 들어온 주택형만 고른다. 한쪽이라도 비면 합계에서 뺀다. */
export function filledUnitTypes(types: UnitType[]): UnitType[] {
  return types.filter((t) => t.supplyPyeong !== null && t.units !== null);
}

/** 공급면적 합계(평) = Σ(세대당 공급면적 × 세대수). 계산할 주택형이 없으면 null(자료 없음). */
export function totalSupplyPyeong(types: UnitType[]): number | null {
  const rows = filledUnitTypes(types);
  if (rows.length === 0) return null;
  return rows.reduce((sum, t) => sum + (t.supplyPyeong as number) * (t.units as number), 0);
}

/** 총 세대수 = Σ세대수. 계산할 주택형이 없으면 null(자료 없음). */
export function totalUnits(types: UnitType[]): number | null {
  const rows = filledUnitTypes(types);
  if (rows.length === 0) return null;
  return rows.reduce((sum, t) => sum + (t.units as number), 0);
}

/** 전용면적(㎡)을 평으로 바꾼다. 1평 = 3.3058㎡. */
export function m2ToPyeong(m2: number): number {
  return m2 / 3.3058;
}

// ───────────── 사업수지 계산 ─────────────

/** 학교용지부담금 요율 — 분양수입의 0.8%. 분양수입에서 빼고 남는 비율 0.992로 쓴다. */
export const SCHOOL_LEVY_KEEP = 0.992;

/** 아파트 분양대행수수료 — 팔린 세대당 300만원 = 0.03억원 */
export const AGENCY_FEE_PER_UNIT = 0.03;

/** 계산에 쓰는 값 — 빈 칸 없이 모두 숫자인 입력값. 금액 억원, 평당가 만원/평(공급기준). */
export interface CalcInput {
  supplyPyeong: number; // 공급면적 합계(평)
  units: number; // 총 세대수
  pricePerPyeong: number; // 계획 평당가(만원/평)
  retail: number; // 상가 분양수입(억원)
  otherInflow: number; // 기타유입(억원)
  fixedCost: number; // 고정비(억원)
  pf: number; // 본PF(억원)
  pfFinanceCost: number; // 본PF 금융비용(억원)
  subordinated: number; // 후순위(억원)
}

/** 계산에 필요한 항목 이름 — 비어 있으면 "자료 없음" 안내에 쓴다 */
export const REQUIRED_FIELDS: Record<keyof CalcInput, string> = {
  supplyPyeong: "주택형(공급면적)",
  units: "주택형(세대수)",
  pricePerPyeong: "평당가",
  retail: "상가",
  otherInflow: "기타유입",
  fixedCost: "고정비",
  pf: "본PF",
  pfFinanceCost: "본PF 금융비용",
  subordinated: "후순위",
};

/**
 * 폼 입력값을 계산용 값으로 바꾼다.
 * 빈 칸이 하나라도 있으면 값을 지어내지 않고 null과 빠진 항목 목록을 돌려준다.
 */
export function toCalcInput(input: PlanInput): { value: CalcInput | null; missing: string[] } {
  const draft = {
    supplyPyeong: totalSupplyPyeong(input.unitTypes),
    units: totalUnits(input.unitTypes),
    pricePerPyeong: input.pricePerPyeong,
    retail: input.retail,
    otherInflow: input.otherInflow,
    fixedCost: input.fixedCost,
    pf: input.pf,
    pfFinanceCost: input.pfFinanceCost,
    subordinated: input.subordinated,
  };
  const missing = (Object.keys(draft) as (keyof CalcInput)[])
    .filter((k) => draft[k] === null)
    .map((k) => REQUIRED_FIELDS[k])
    .filter((v, i, a) => a.indexOf(v) === i);
  if (missing.length > 0) return { value: null, missing };
  return { value: draft as CalcInput, missing: [] };
}

/** 분양수입(억원) = (공급면적 × 평당가 ÷ 10,000 + 상가) × 분양률. r은 0~1, p는 만원/평. */
export function salesRevenue(c: CalcInput, r: number, p: number = c.pricePerPyeong): number {
  return ((c.supplyPyeong * p) / 10000 + c.retail) * r;
}

/** 변동비(억원) = 학교용지부담금(분양수입 × 0.8%) + 분양대행수수료(세대수 × 분양률 × 0.03억) */
export function variableCost(c: CalcInput, r: number, p: number = c.pricePerPyeong): number {
  return salesRevenue(c, r, p) * (1 - SCHOOL_LEVY_KEEP) + c.units * r * AGENCY_FEE_PER_UNIT;
}

/** 기말현금(억원) = 분양수입 × 0.992 − 세대수 × 분양률 × 0.03 + 기타유입 − 고정비 */
export function endCash(c: CalcInput, r: number, p: number = c.pricePerPyeong): number {
  return salesRevenue(c, r, p) * SCHOOL_LEVY_KEEP - c.units * r * AGENCY_FEE_PER_UNIT + c.otherInflow - c.fixedCost;
}

/** 만기 누적 DSCR(배) = 1 + (기말현금 + 후순위) ÷ (본PF + 본PF 금융비용). 분모가 0 이하면 null. */
export function maturityDscr(c: CalcInput, r: number = 1, p: number = c.pricePerPyeong): number | null {
  const debt = c.pf + c.pfFinanceCost;
  if (debt <= 0) return null;
  return 1 + (endCash(c, r, p) + c.subordinated) / debt;
}

/** LTV(%) = 본PF ÷ 분양수입(분양률 100%, 계획 평당가) × 100. 분양수입이 0 이하면 null. */
export function ltv(c: CalcInput): number | null {
  const s = salesRevenue(c, 1);
  if (s <= 0) return null;
  return (c.pf / s) * 100;
}

/**
 * 이분법으로 f(x) = target 이 되는 x를 [lo, hi]에서 찾는다.
 * f는 x가 커질수록 커지는 함수여야 한다. 구간 안에 답이 없으면 null.
 */
export function bisect(f: (x: number) => number, target: number, lo: number, hi: number, tol = 1e-9, maxIter = 200): number | null {
  let a = lo;
  let b = hi;
  if (f(a) - target > 0 || f(b) - target < 0) return null;
  for (let i = 0; i < maxIter && b - a > tol; i++) {
    const m = (a + b) / 2;
    if (f(m) - target < 0) a = m;
    else b = m;
  }
  return (a + b) / 2;
}

/** 분양률 탐색 범위 상한 — 100%를 넘는 답은 "그 가격으로는 다 팔아도 부족"을 뜻한다 */
const MAX_RATE = 3;

/** 계획 평당가에서 기말현금 = target 이 되는 분양률(0~1 기준, 1 초과 가능). 답이 없으면 null. */
export function breakEvenRate(c: CalcInput, target: number): number | null {
  return bisect((r) => endCash(c, r), target, 0, MAX_RATE);
}

/** 분양률 100%에서 기말현금 = target 이 되는 평당가(만원/평, 공급기준). 답이 없으면 null. */
export function breakEvenPrice(c: CalcInput, target: number): number | null {
  return bisect((p) => endCash(c, 1, p), target, 0, Math.max(c.pricePerPyeong, 1) * 10);
}

/** 두 한계선 — ① 기말현금 0(후순위까지 전액 지급) ② 기말현금 −후순위(본PF 전액 상환 한계). 분양률 기준 · 평당가 기준. */
export function limitLines(c: CalcInput) {
  return {
    zero: { rate: breakEvenRate(c, 0), price: breakEvenPrice(c, 0) },
    pfLimit: { rate: breakEvenRate(c, -c.subordinated), price: breakEvenPrice(c, -c.subordinated) },
  };
}

/** 상환 가능 여부 — 기말현금이 −후순위 이상이면 본PF 원리금을 다 갚을 수 있다 */
export function canRepayPf(c: CalcInput, cash: number): boolean {
  return cash >= -c.subordinated;
}

// ───────────── 사업수지 폭포 ─────────────

/** 폭포 차트 한 단계 — 증감액과 누적 시작 · 끝(억원) */
export interface WaterfallStep {
  label: string;
  value: number; // 이 단계의 증감(유출은 음수). 마지막 기말현금은 합계
  start: number; // 누적 시작점
  end: number; // 누적 끝점
  kind: "inflow" | "outflow" | "total";
  formula: string;
}

/**
 * 사업수지를 분양수입 → 변동비 → 고정비 → 기타유입 → 기말현금 순서로 쌓는다.
 * 마지막 단계의 end는 endCash(c, r, p)와 같다.
 */
export function waterfallSteps(c: CalcInput, r = 1, p: number = c.pricePerPyeong): WaterfallStep[] {
  const revenue = salesRevenue(c, r, p);
  const variable = variableCost(c, r, p);
  const steps: WaterfallStep[] = [];
  let acc = 0;
  const push = (label: string, value: number, kind: "inflow" | "outflow", formula: string) => {
    steps.push({ label, value, start: acc, end: acc + value, kind, formula });
    acc += value;
  };
  push("분양수입", revenue, "inflow", "(공급면적 × 평당가 ÷ 10,000 + 상가) × 분양률");
  push("변동비", -variable, "outflow", "분양수입 × 0.8% + 세대수 × 분양률 × 0.03억");
  push("고정비", -c.fixedCost, "outflow", "입력값");
  push("기타유입", c.otherInflow, "inflow", "입력값");
  steps.push({ label: "기말현금", value: acc, start: 0, end: acc, kind: "total", formula: "분양수입 − 변동비 − 고정비 + 기타유입" });
  return steps;
}

// ───────────── 민감도 ─────────────

/** 민감도 행 — 분양률 100% → 75%, 5%p 간격 */
export const SENS_RATES = [1, 0.95, 0.9, 0.85, 0.8, 0.75];

/** 민감도 열 — 계획 평당가 기준 −500 ~ +100만원, 100만원 간격 */
export const SENS_PRICE_OFFSETS = [-500, -400, -300, -200, -100, 0, 100];

/** 민감도 한 칸 — 기말현금(억원)과 본PF 상환 가능 여부 */
export interface SensCell {
  cash: number;
  repayable: boolean;
}

/** 분양률 × 평당가 2차원 표를 만든다. 셀은 기말현금, 상환 가능 여부는 기말현금 ≥ −후순위. */
export function sensitivityGrid(c: CalcInput): { rates: number[]; prices: number[]; cells: SensCell[][] } {
  const prices = SENS_PRICE_OFFSETS.map((o) => c.pricePerPyeong + o);
  const cells = SENS_RATES.map((r) =>
    prices.map((p) => {
      const cash = endCash(c, r, p);
      return { cash, repayable: canRepayPf(c, cash) };
    }),
  );
  return { rates: SENS_RATES, prices, cells };
}

/** 소수 1자리로 올림한다 — "이 값 이상이면" 문장에서 기준을 낮춰 보이지 않게 하기 위함 */
export function ceil1(x: number): number {
  return Math.ceil(x * 10 - 1e-9) / 10;
}

/**
 * 표 아래 자동 문장 — 계획 평당가에서 본PF를 다 갚으려면 필요한 최소 분양률.
 * 예: "평당 2,420만원 / 분양률 80.6% 이상이면 상환 가능"
 */
export function repaySentence(c: CalcInput): string {
  const p = c.pricePerPyeong.toLocaleString("ko-KR");
  const rate = breakEvenRate(c, -c.subordinated);
  if (rate === null) return `평당 ${p}만원에서는 상환 한계 분양률을 찾을 수 없음`;
  if (rate <= 0) return `평당 ${p}만원 / 분양률과 관계없이 상환 가능`;
  if (rate > 1) return `평당 ${p}만원에서는 분양률 100%로도 상환 불가`;
  return `평당 ${p}만원 / 분양률 ${ceil1(rate * 100).toFixed(1)}% 이상이면 상환 가능`;
}

// ───────────── 리스크 — 한계선에서 거꾸로 짚기 ─────────────

/**
 * 계획 대비 여유폭. 문장에 쓰는 숫자는 화면에 보이는 반올림 값(분양률 소수 1자리, 평당가 정수)으로 계산해
 * 독자가 검산할 수 있게 한다. 한계선을 찾지 못하면 해당 값은 null.
 */
export function riskMargins(c: CalcInput) {
  const l = limitLines(c);
  const pfRate = l.pfLimit.rate === null ? null : Math.round(l.pfLimit.rate * 1000) / 10; // %
  const zeroRate = l.zero.rate === null ? null : Math.round(l.zero.rate * 1000) / 10; // %
  const pfPrice = l.pfLimit.price === null ? null : Math.round(l.pfLimit.price); // 만원/평
  return {
    pfRate,
    zeroRate,
    pfPrice,
    // 분양률 여유(%p) = 100 − 상환 한계 분양률
    rateMargin: pfRate === null ? null : Math.round((100 - pfRate) * 10) / 10,
    // 팔리지 않아도 되는 세대수 ≈ 세대수 × (100 − 상환 한계 분양률) ÷ 100 (내림)
    unsoldUnits: pfRate === null ? null : Math.floor((c.units * (100 - pfRate)) / 100),
    // 분양가 여유(%) = 상환 한계 평당가 ÷ 계획 평당가 − 1
    priceMargin: pfPrice === null ? null : Math.round((pfPrice / c.pricePerPyeong - 1) * 1000) / 10,
    // 후순위가 받쳐 주는 분양률 폭(%p) = 기말현금 0 분양률 − 상환 한계 분양률
    subordinatedBuffer: pfRate === null || zeroRate === null ? null : Math.round((zeroRate - pfRate) * 10) / 10,
  };
}
