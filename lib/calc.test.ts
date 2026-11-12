// 검산 테스트 — Node 내장 node --test로 실행한다(npm test). 새 테스트 도구를 설치하지 않는다.
// 샘플 A(해운대 그린테라스, 가상) 다섯 값이 강의자료 기준값과 같아야 통과한다.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bisect,
  canRepayPf,
  emptyInput,
  endCash,
  limitLines,
  ltv,
  maturityDscr,
  repaySentence,
  riskMargins,
  sensitivityGrid,
  salesRevenue,
  toCalcInput,
  totalSupplyPyeong,
  totalUnits,
  waterfallSteps,
  type CalcInput,
} from "./calc.ts";
import { PRESETS, clonePreset } from "./presets.ts";

/** 반올림한 값이 기준값과 같은지 본다 — 화면 표시 자릿수 기준 */
function assertRounded(actual: number | null, expected: number, digits: number, label: string) {
  assert.notEqual(actual, null, `${label}: 값 없음`);
  const f = 10 ** digits;
  assert.equal(Math.round((actual as number) * f) / f, expected, `${label}: ${actual}`);
}

/** 임시 값을 계산용 값으로 바꾼다 — 빈 칸이 있으면 테스트 실패 */
function calcOf(id: "A" | "B" | "C"): CalcInput {
  const { value, missing } = toCalcInput(clonePreset(id));
  assert.ok(value, `${id} 빠진 항목: ${missing.join(", ")}`);
  return value as CalcInput;
}

test("샘플 A 기말현금 +380.3억", () => {
  assertRounded(endCash(calcOf("A"), 1), 380.3, 1, "기말현금");
});

test("샘플 A 만기 누적 DSCR 1.27", () => {
  assertRounded(maturityDscr(calcOf("A")), 1.27, 2, "DSCR");
});

test("샘플 A LTV 60.2%", () => {
  assertRounded(ltv(calcOf("A")), 60.2, 1, "LTV");
});

test("샘플 A 기말현금 0: 분양률 90.5% · 평당 2,183만원", () => {
  const l = limitLines(calcOf("A"));
  assertRounded(l.zero.rate === null ? null : l.zero.rate * 100, 90.5, 1, "분양률");
  assertRounded(l.zero.price, 2183, 0, "평당가");
});

test("샘플 A 상환 한계(기말현금 −후순위): 분양률 80.6% · 평당 1,934만원", () => {
  const l = limitLines(calcOf("A"));
  assertRounded(l.pfLimit.rate === null ? null : l.pfLimit.rate * 100, 80.6, 1, "분양률");
  assertRounded(l.pfLimit.price, 1934, 0, "평당가");
});

test("샘플 B · C 기말현금이 표와 같다 (+450.0억 · +210.0억)", () => {
  assertRounded(endCash(calcOf("B"), 1), 450.0, 1, "B 기말현금");
  assertRounded(endCash(calcOf("C"), 1), 210.0, 1, "C 기말현금");
});

test("한계선에서 기말현금이 실제로 0 · −후순위가 된다 (오차 0.0001억 = 1만원 이내)", () => {
  const TOL = 1e-4;
  for (const id of ["A", "B", "C"] as const) {
    const c = calcOf(id);
    const l = limitLines(c);
    assert.ok(Math.abs(endCash(c, l.zero.rate as number)) < TOL, `${id} 분양률 0선`);
    assert.ok(Math.abs(endCash(c, l.pfLimit.rate as number) + c.subordinated) < TOL, `${id} 분양률 한계선`);
    assert.ok(Math.abs(endCash(c, 1, l.zero.price as number)) < TOL, `${id} 평당가 0선`);
    assert.ok(Math.abs(endCash(c, 1, l.pfLimit.price as number) + c.subordinated) < TOL, `${id} 평당가 한계선`);
  }
});

test("분양수입 식: (공급면적 × 평당가 ÷ 10,000 + 상가) × 분양률", () => {
  const c = calcOf("A");
  assert.ok(Math.abs(salesRevenue(c, 1) - (16192 * 2420 / 10000 + 150)) < 1e-9);
  assert.ok(Math.abs(salesRevenue(c, 0.5) - salesRevenue(c, 1) / 2) < 1e-9);
});

test("상환 가능 여부는 기말현금 −후순위를 기준으로 한다", () => {
  const c = calcOf("A");
  assert.equal(canRepayPf(c, -400), true);
  assert.equal(canRepayPf(c, -400.1), false);
});

test("빈 칸이 있으면 계산하지 않고 빠진 항목을 알려준다", () => {
  const { value, missing } = toCalcInput(emptyInput());
  assert.equal(value, null);
  assert.ok(missing.includes("평당가") && missing.includes("본PF"));
});

test("민감도 표: 6행(100~75%) × 7열(계획 −500~+100만원), 계획 칸 = 기말현금", () => {
  const c = calcOf("A");
  const g = sensitivityGrid(c);
  assert.deepEqual(g.rates, [1, 0.95, 0.9, 0.85, 0.8, 0.75]);
  assert.deepEqual(g.prices, [1920, 2020, 2120, 2220, 2320, 2420, 2520]);
  assertRounded(g.cells[0][5].cash, 380.3, 1, "100% · 계획가 칸");
  // 상환 한계 평당가 1,934만원 → 분양률 100%에서 1,920은 불가, 2,020은 가능
  assert.equal(g.cells[0][0].repayable, false);
  assert.equal(g.cells[0][1].repayable, true);
  // 계획가에서 상환 한계 분양률 80.6% → 85%는 가능, 80%는 불가
  assert.equal(g.cells[3][5].repayable, true);
  assert.equal(g.cells[4][5].repayable, false);
});

test("자동 문장: 샘플 A", () => {
  assert.equal(repaySentence(calcOf("A")), "평당 2,420만원 / 분양률 80.6% 이상이면 상환 가능");
});

test("리스크 여유폭: 화면 반올림 값으로 계산 (샘플 A)", () => {
  const m = riskMargins(calcOf("A"));
  assert.equal(m.pfRate, 80.6);
  assert.equal(m.rateMargin, 19.4); // 100 − 80.6
  assert.equal(m.unsoldUnits, 100); // 520 × 19.4% = 100.88 → 내림
  assert.equal(m.priceMargin, -20.1); // 1,934 ÷ 2,420 − 1
  assert.equal(m.subordinatedBuffer, 9.9); // 90.5 − 80.6
});

test("폭포: 분양수입 → 변동비 → 고정비 → 기타유입 → 기말현금, 끝값 = 기말현금 (샘플 A)", () => {
  const c = calcOf("A");
  const s = waterfallSteps(c);
  assert.deepEqual(s.map((x) => x.label), ["분양수입", "변동비", "고정비", "기타유입", "기말현금"]);
  assertRounded(s[0].value, 4068.5, 1, "분양수입");
  assertRounded(s[1].value, -48.1, 1, "변동비"); // 4,068.46 × 0.8% + 520 × 0.03
  assert.equal(s[2].value, -3815);
  assert.equal(s[3].value, 175);
  assertRounded(s[4].end, 380.3, 1, "기말현금");
  assert.ok(Math.abs(s[4].end - endCash(c, 1)) < 1e-9);
  for (let i = 1; i < 4; i++) assert.ok(Math.abs(s[i].start - s[i - 1].end) < 1e-9, "단계가 이어진다");
});

test("이분법: 구간 안에 답이 없으면 null", () => {
  assert.equal(bisect((x) => x, 5, 0, 1), null);
  assert.ok(Math.abs((bisect((x) => x * x, 2, 0, 2) as number) - Math.SQRT2) < 1e-8);
});

// 강의자료 표의 공급면적 합계(평)와 세대수
const TABLE = {
  A: { supply: 16192.0, units: 520 },
  B: { supply: 24084.0, units: 780 },
  C: { supply: 12592.0, units: 380 },
} as const;

test("임시 값 3개의 공급면적 합계 · 세대수가 표와 같다", () => {
  for (const p of PRESETS) {
    assert.ok(Math.abs((totalSupplyPyeong(p.input.unitTypes) ?? NaN) - TABLE[p.id].supply) < 0.05, `${p.id} 공급면적`);
    assert.equal(totalUnits(p.input.unitTypes), TABLE[p.id].units, `${p.id} 세대수`);
  }
});

test("빈 폼은 공급면적 · 세대수가 자료 없음(null)", () => {
  const e = emptyInput();
  assert.equal(totalSupplyPyeong(e.unitTypes), null);
  assert.equal(totalUnits(e.unitTypes), null);
});

test("공급면적이나 세대수가 빈 주택형은 합계에서 뺀다", () => {
  const types = [
    { name: "59㎡", exclusiveM2: 59.9, supplyPyeong: 25.6, units: 200 },
    { name: "84㎡", exclusiveM2: 84.9, supplyPyeong: null, units: 320 },
  ];
  assert.ok(Math.abs((totalSupplyPyeong(types) ?? NaN) - 5120) < 1e-9);
  assert.equal(totalUnits(types), 200);
});

test("임시 값을 고쳐도 원본 표 값은 바뀌지 않는다", () => {
  const a = clonePreset("A");
  a.unitTypes[0].units = 1;
  assert.equal(PRESETS[0].input.unitTypes[0].units, 200);
});
