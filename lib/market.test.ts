// 시장 분석 계산 검산 — 고정된 예시 응답으로 확인한다(네트워크 호출 없음).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  houseTyToM2,
  lastMonths,
  marketMargin,
  normalizeName,
  parseRtmsXml,
  leafRegions,
  matchRegion,
  pickOur84,
  pickSggCandidates,
  premiumTable,
  previousMonth,
  remainderTable,
  rentRatioTable,
  shortfallTable,
  supplyPriceTable,
  toCompetitionRow,
  toModelRow,
  toPresaleDeal,
  type PresaleDeal,
  type RentDeal,
  type SubscriptionDetail,
} from "./market.ts";

const close = (a: number | null, b: number, tol = 1e-6) => assert.ok(a !== null && Math.abs(a - b) < tol, `${a} ≠ ${b}`);

// 법정동코드 응답 예 — 경기도 수원시(아래에 구 4개) · 동 한 줄
const SUWON = [
  { region_cd: "4111000000", locatadd_nm: "경기도 수원시", sgg_cd: "110", umd_cd: "000", ri_cd: "00" },
  { region_cd: "4111100000", locatadd_nm: "경기도 수원시 장안구", sgg_cd: "111", umd_cd: "000", ri_cd: "00" },
  { region_cd: "4111300000", locatadd_nm: "경기도 수원시 권선구", sgg_cd: "113", umd_cd: "000", ri_cd: "00" },
  { region_cd: "4111500000", locatadd_nm: "경기도 수원시 팔달구", sgg_cd: "115", umd_cd: "000", ri_cd: "00" },
  { region_cd: "4111700000", locatadd_nm: "경기도 수원시 영통구", sgg_cd: "117", umd_cd: "000", ri_cd: "00" },
  { region_cd: "4111710100", locatadd_nm: "경기도 수원시 영통구 매탄동", sgg_cd: "117", umd_cd: "101", ri_cd: "00" },
];

test("지역 후보: 구가 있는 시는 빼고 구를 후보로 (경기도 수원시 → 구 4곳)", () => {
  const c = pickSggCandidates(SUWON, "경기도 수원시");
  assert.deepEqual(c.map((x) => x.code5), ["41111", "41113", "41115", "41117"]);
});

test("지역 후보: 이름이 정확히 같으면 그 한 곳 (경기도 수원시 영통구 → 41117)", () => {
  assert.deepEqual(pickSggCandidates(SUWON, "경기도  수원시 영통구"), [{ code5: "41117", name: "경기도 수원시 영통구" }]);
  assert.deepEqual(
    pickSggCandidates([{ region_cd: "2635000000", locatadd_nm: "부산광역시 해운대구", sgg_cd: "350", umd_cd: "000", ri_cd: "00" }], "부산광역시 해운대구"),
    [{ code5: "26350", name: "부산광역시 해운대구" }],
  );
});

test("실거래 XML: item을 읽고 해제 · 입주권을 구분한다", () => {
  const xml = `<response><header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header><body><items>
    <item><aptNm>가 단지</aptNm><cdealType> </cdealType><dealAmount>100,000</dealAmount><dealMonth>9</dealMonth><dealYear>2026</dealYear><dealDay>3</dealDay><excluUseAr>84.95</excluUseAr><ownershipGbn> </ownershipGbn></item>
    <item><aptNm>가 단지</aptNm><cdealType>O</cdealType><dealAmount>90,000</dealAmount><dealMonth>9</dealMonth><dealYear>2026</dealYear><dealDay>4</dealDay><excluUseAr>84.95</excluUseAr><ownershipGbn>입</ownershipGbn></item>
  </items><totalCount>2</totalCount></body></response>`;
  const r = parseRtmsXml(xml);
  assert.equal(r.ok, true);
  assert.equal(r.items.length, 2);
  const a = toPresaleDeal(r.items[0]);
  const b = toPresaleDeal(r.items[1]);
  assert.equal(a?.deal.amount, 100000);
  assert.equal(a?.deal.ym, "202609");
  assert.equal(a?.cancelled, false);
  assert.equal(a?.deal.ownership, "분양권");
  assert.equal(b?.cancelled, true);
  assert.equal(b?.deal.ownership, "입주권");
});

test("실거래 XML: 공공데이터포털 오류 응답은 ok=false, 데이터 없음(03)은 정상", () => {
  assert.equal(parseRtmsXml("<OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>30</returnReasonCode><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>").ok, false);
  assert.equal(parseRtmsXml("<response><header><resultCode>03</resultCode><resultMsg>NO DATA</resultMsg></header></response>").ok, true);
});

test("주택형 · 이름 · 기간 도우미", () => {
  assert.equal(houseTyToM2("084.8860A"), 84.886);
  assert.equal(normalizeName("베뉴브 해운대"), normalizeName("베뉴브해운대(분양권)"));
  assert.deepEqual(lastMonths("202602", 3), ["202512", "202601", "202602"]);
  assert.equal(lastMonths("202610", 12)[0], "202511");
  assert.equal(previousMonth(new Date(2026, 0, 15)), "202512");
});

// 단지 두 곳 — A: 84㎡형 2개 · 59㎡형 1개, B: 84㎡형 1개(분양가 없음)
const DETAILS: SubscriptionDetail[] = [
  {
    item: { id: "1", pblanc: "1", name: "가 단지", address: "부산광역시 해운대구 우동", noticeDate: "2026-05-01", totalUnits: 300, moveIn: "202905" },
    models: [
      toModelRow({ HOUSE_TY: "059.9800A", SUPLY_AR: "80.0000", SUPLY_HSHLDCO: 10, SPSPLY_HSHLDCO: 10, LTTOT_TOP_AMOUNT: "60000" }),
      toModelRow({ HOUSE_TY: "084.9500A", SUPLY_AR: "110.0000", SUPLY_HSHLDCO: 60, SPSPLY_HSHLDCO: 40, LTTOT_TOP_AMOUNT: "80000" }),
      toModelRow({ HOUSE_TY: "084.9700B", SUPLY_AR: "112.0000", SUPLY_HSHLDCO: 30, SPSPLY_HSHLDCO: 20, LTTOT_TOP_AMOUNT: "84000" }),
    ],
    competition: [
      toCompetitionRow({ HOUSE_TY: "084.9500A", SUBSCRPT_RANK_CODE: 1, RESIDE_SENM: "해당지역", SUPLY_HSHLDCO: 60, REQ_CNT: "40", CMPET_RATE: "(△20)" }),
      toCompetitionRow({ HOUSE_TY: "084.9500A", SUBSCRPT_RANK_CODE: 1, RESIDE_SENM: "기타지역", SUPLY_HSHLDCO: 60, REQ_CNT: "5", CMPET_RATE: "(△15)" }),
      toCompetitionRow({ HOUSE_TY: "084.9500A", SUBSCRPT_RANK_CODE: 2, RESIDE_SENM: "해당지역", SUPLY_HSHLDCO: 60, REQ_CNT: "10", CMPET_RATE: "(△5)" }),
      toCompetitionRow({ HOUSE_TY: "084.9700B", SUBSCRPT_RANK_CODE: 1, RESIDE_SENM: "해당지역", SUPLY_HSHLDCO: 30, REQ_CNT: "90", CMPET_RATE: "3.00" }),
    ],
  },
  {
    item: { id: "2", pblanc: "2", name: "나 단지", address: "부산광역시 해운대구 중동", noticeDate: "2026-07-01", totalUnits: 100, moveIn: "202912" },
    models: [toModelRow({ HOUSE_TY: "084.9000", SUPLY_AR: "111.0000", SUPLY_HSHLDCO: 50, SPSPLY_HSHLDCO: 0, LTTOT_TOP_AMOUNT: "" })],
    competition: [],
  },
];

test("표1 인근 신규 84㎡ 공급평당: 세대수 가중 평균 · 계획가 대비", () => {
  const t = supplyPriceTable(DETAILS, 2400);
  assert.equal(t.rows.length, 2);
  assert.deepEqual(t.excluded, { not84: 1, noPrice: 1 });
  const pA = 80000 / (110 / 3.3058); // 2,404.2
  const pB = 84000 / (112 / 3.3058); // 2,479.4
  close(t.avg, (pA * 100 + pB * 50) / 150);
  close(t.diffPct, (2400 / t.avg! - 1) * 100);
});

test("표2 분양권 웃돈: 같은 단지 · 전용 ±0.5㎡ 주택형의 분양최고금액과 비교, 입주권 · 미매칭 제외", () => {
  const deals: PresaleDeal[] = [
    { aptNm: "가 단지", umdNm: "우동", exclusiveM2: 84.95, amount: 85000, ym: "202609", day: 1, floor: 10, ownership: "분양권" }, // +5,000
    { aptNm: "가단지", umdNm: "우동", exclusiveM2: 84.97, amount: 82000, ym: "202609", day: 2, floor: 3, ownership: "분양권" }, // −2,000
    { aptNm: "가 단지", umdNm: "우동", exclusiveM2: 84.95, amount: 99000, ym: "202609", day: 3, floor: 5, ownership: "입주권" },
    { aptNm: "다 단지", umdNm: "중동", exclusiveM2: 84.9, amount: 70000, ym: "202609", day: 4, floor: 7, ownership: "분양권" },
  ];
  const t = premiumTable(deals, DETAILS);
  assert.equal(t.matched, 2);
  close(t.avgPremium, 1500);
  assert.equal(t.minusDeals, 1);
  assert.deepEqual(t.excluded, { moveInRights: 1, unmatched: 1 });
});

test("표3 1 · 2순위 미달: 접수 합계 vs 공급세대", () => {
  const t = shortfallTable(DETAILS);
  const a = t.rows.find((r) => r.houseTy === "084.9500A")!;
  assert.equal(a.rank1, 45);
  assert.equal(a.rank12, 55);
  assert.equal(a.status, "2순위까지 미달");
  assert.equal(t.rows.find((r) => r.houseTy === "084.9700B")!.status, "1순위 마감");
  assert.equal(t.rank1Short, 1);
  assert.equal(t.rank2Short, 1);
  assert.equal(t.excluded.noData, 1);
});

test("표4 잔여세대: 최근 공고 순 · 합계", () => {
  const t = remainderTable([
    { id: "1", pblanc: "1", name: "가", address: "", noticeDate: "2025-01-01", totalUnits: 10, moveIn: "" },
    { id: "2", pblanc: "2", name: "나", address: "", noticeDate: "2026-01-01", totalUnits: 5, moveIn: "" },
  ]);
  assert.equal(t.rows[0].name, "나");
  assert.equal(t.totalUnits, 15);
});

test("표5 84㎡ 신규 전세 ÷ 우리 84㎡ 세대당 분양가 (샘플 A 84㎡: 34.6평 × 2,420만원)", () => {
  const rents: RentDeal[] = [
    { aptNm: "가", umdNm: "", exclusiveM2: 84.9, deposit: 50000, monthlyRent: 0, buildYear: 2023, ym: "202609" },
    { aptNm: "나", umdNm: "", exclusiveM2: 84.9, deposit: 60000, monthlyRent: 0, buildYear: 2022, ym: "202609" },
    { aptNm: "다", umdNm: "", exclusiveM2: 84.9, deposit: 10000, monthlyRent: 100, buildYear: 2023, ym: "202609" },
    { aptNm: "라", umdNm: "", exclusiveM2: 59.9, deposit: 40000, monthlyRent: 0, buildYear: 2023, ym: "202609" },
    { aptNm: "마", umdNm: "", exclusiveM2: 84.9, deposit: 30000, monthlyRent: 0, buildYear: 1999, ym: "202609" },
  ];
  const t = rentRatioTable(rents, { supplyPyeong: 34.6, pricePerPyeong: 2420 }, 2026);
  assert.equal(t.count, 2);
  close(t.avgDeposit, 55000);
  close(t.ourPrice, 83732);
  close(t.ratioPct, (55000 / 83732) * 100);
  assert.deepEqual(t.excluded, { monthly: 1, not84: 1, old: 1 });
});

test("시장 대비 여유 = 1 − 상환 한계 평당가 ÷ 인근 평균", () => {
  close(marketMargin(1934, 2400), (1 - 1934 / 2400) * 100);
  assert.equal(marketMargin(null, 2400), null);
});

test("우리 84㎡ 주택형 고르기", () => {
  const t = pickOur84([
    { name: "59㎡", exclusiveM2: 59.9, supplyPyeong: 25.6 },
    { name: "84㎡", exclusiveM2: 84.9, supplyPyeong: 34.6 },
  ]);
  assert.equal(t?.supplyPyeong, 34.6);
});

// ───────────── 시군구 확인 (앱 안의 코드표) ─────────────
import { SGG_ROWS } from "./regions-data.ts";

const LEAVES = leafRegions(SGG_ROWS.map(([code5, name]) => ({ code5, name })));
const codes = (q: string) => matchRegion(LEAVES, q).map((c) => c.code5);

test("시군구 코드표: 샘플 A·B·C 지역과 특별자치시·도가 들어 있다", () => {
  assert.deepEqual(codes("부산광역시 해운대구"), ["26350"]);
  assert.deepEqual(codes("경기도 수원시 영통구"), ["41117"]);
  assert.deepEqual(codes("대전광역시 유성구"), ["30200"]);
  assert.deepEqual(codes("세종특별자치시"), ["36110"]);
  assert.deepEqual(codes("강원특별자치도 춘천시"), ["51110"]);
});

test("주소 찾기: 줄임말 · 시도 생략 · 동/지번까지 쓴 주소", () => {
  assert.deepEqual(codes("부산 해운대구"), ["26350"]);
  assert.deepEqual(codes("해운대구"), ["26350"]);
  assert.deepEqual(codes("수원시 영통구"), ["41117"]);
  assert.deepEqual(codes("부산광역시 해운대구 우동 1408"), ["26350"]);
  assert.deepEqual(codes("서울특별시 강남구 역삼동 123-4"), ["11680"]);
  assert.deepEqual(codes("세종시 한솔동"), ["36110"]);
  assert.deepEqual(codes("강원도 춘천시"), ["51110"]);
});

test("주소 찾기: 위 단계만 쓰면 아래 시군구 후보 여럿, 이름이 겹치면 후보 여럿, 없으면 빈 배열", () => {
  assert.deepEqual(codes("경기도 수원시"), ["41111", "41113", "41115", "41117"]);
  assert.ok(codes("중구").length >= 5); // 서울 · 부산 · 대구 · 인천 · 대전 · 울산 중구
  assert.deepEqual(codes("없는시 없는구"), []);
});
