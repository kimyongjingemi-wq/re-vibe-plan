// 임시 값 3개 — 교육용 가상 사업장. 실재하는 단지 · 법인과 무관하다.
// 출처: R.E.VIBE 트랙 1 강의자료 「무엇을 입력하나 — 임시 값 3개로 시작합니다」 표.
// 단위: 금액 억원, 평당가 만원/평(공급기준), 전용면적 ㎡, 공급면적 평(세대당).
// 샘플 A는 검산 테스트(lib/calc.test.ts)에도 쓴다.

import type { PlanInput } from "./calc.ts";

/** 버튼 하나에 대응하는 임시 값 — 버튼 이름과 입력값 */
export interface Preset {
  id: "A" | "B" | "C";
  label: string;
  input: PlanInput;
}

/** 샘플 A — 해운대 그린테라스 (부산 해운대구). 표 기준 공급면적 16,192.0평 · 기말현금 +380.3억 */
const SAMPLE_A: PlanInput = {
  projectName: "해운대 그린테라스 (가상)",
  site: "부산광역시 해운대구",
  unitTypes: [
    { name: "59㎡", exclusiveM2: 59.9, supplyPyeong: 25.6, units: 200 },
    { name: "84㎡", exclusiveM2: 84.9, supplyPyeong: 34.6, units: 320 },
  ],
  pricePerPyeong: 2420,
  retail: 150,
  otherInflow: 175,
  fixedCost: 3815.0,
  pf: 2450,
  pfFinanceCost: 480,
  subordinated: 400,
};

/** 샘플 B — 영통 센트럴파크 (경기 수원시 영통구). 표 기준 공급면적 24,084.0평 · 기말현금 +450.0억 */
const SAMPLE_B: PlanInput = {
  projectName: "영통 센트럴파크 (가상)",
  site: "경기도 수원시 영통구",
  unitTypes: [
    { name: "59㎡", exclusiveM2: 59.8, supplyPyeong: 25.4, units: 300 },
    { name: "84㎡", exclusiveM2: 84.9, supplyPyeong: 34.3, units: 480 },
  ],
  pricePerPyeong: 2650,
  retail: 180,
  otherInflow: 260,
  fixedCost: 6296.4,
  pf: 4100,
  pfFinanceCost: 820,
  subordinated: 600,
};

/** 샘플 C — 유성 리버뷰 (대전 유성구). 표 기준 공급면적 12,592.0평 · 기말현금 +210.0억 */
const SAMPLE_C: PlanInput = {
  projectName: "유성 리버뷰 (가상)",
  site: "대전광역시 유성구",
  unitTypes: [
    { name: "74㎡", exclusiveM2: 74.6, supplyPyeong: 30.8, units: 140 },
    { name: "84㎡", exclusiveM2: 84.9, supplyPyeong: 34.5, units: 240 },
  ],
  pricePerPyeong: 1980,
  retail: 90,
  otherInflow: 120,
  fixedCost: 2461.2,
  pf: 1650,
  pfFinanceCost: 330,
  subordinated: 260,
};

/** 화면의 임시 값 버튼 3개 순서대로 */
export const PRESETS: Preset[] = [
  { id: "A", label: "A 해운대 그린테라스", input: SAMPLE_A },
  { id: "B", label: "B 영통 센트럴파크", input: SAMPLE_B },
  { id: "C", label: "C 유성 리버뷰", input: SAMPLE_C },
];

/** 임시 값을 폼에 넣을 때 쓰는 복사본을 만든다. 폼에서 고쳐도 원본 표 값은 바뀌지 않게 한다. */
export function clonePreset(id: Preset["id"]): PlanInput {
  const found = PRESETS.find((p) => p.id === id);
  if (!found) throw new Error(`임시 값 ${id}가 없습니다`);
  return structuredClone(found.input);
}
