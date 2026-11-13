"use client";

// 사업계획서 입력 · 결과 화면. 계산은 lib/calc.ts의 순수 함수만 부른다.
// 구성: 입력 폼 · 임시 값 버튼 3개 · 사업계획서 1~7장.

import { useState } from "react";
import {
  AGENCY_FEE_PER_UNIT,
  SCHOOL_LEVY_KEEP,
  emptyInput,
  endCash,
  limitLines,
  ltv,
  m2ToPyeong,
  maturityDscr,
  repaySentence,
  riskMargins,
  salesRevenue,
  sensitivityGrid,
  toCalcInput,
  totalSupplyPyeong,
  totalUnits,
  type CalcInput,
  type PlanInput,
  type UnitType,
} from "@/lib/calc";
import { PRESETS, clonePreset } from "@/lib/presets";
import MarketMarginChart from "@/components/charts/MarketMarginChart";
import WaterfallChart from "@/components/charts/WaterfallChart";
import { canRepayPf, waterfallSteps } from "@/lib/calc";
import {
  marketMargin,
  pickOur84,
  premiumTable,
  remainderTable,
  rentRatioTable,
  shortfallTable,
  supplyPriceTable,
  type RegionCandidate,
  type SubscriptionDetail,
} from "@/lib/market";
import {
  detailTasks,
  emptyMarket,
  fetchRegion,
  getJson,
  initialTasks,
  runPool,
  type MarketData,
  type Task,
} from "@/lib/market-client";

/** 숫자를 천단위 콤마로 표시한다. null은 "자료 없음". */
function fmt(n: number | null, digits = 0): string {
  if (n === null || !Number.isFinite(n)) return "자료 없음";
  return n.toLocaleString("ko-KR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** 숫자 칸 표시값 — 음수는 빨간색, 비어 있으면 "자료 없음"(회색) */
function Num({ value, digits = 0, unit }: { value: number | null; digits?: number; unit?: string }) {
  if (value === null) return <span className="text-muted">자료 없음</span>;
  return (
    <span className={`tabular-nums ${value < 0 ? "text-bad" : ""}`}>
      {fmt(value, digits)}
      {unit && <span className="ml-0.5 text-muted text-[0.85em]">{unit}</span>}
    </span>
  );
}

/** 입력 칸 문자열을 숫자로 바꾼다. 빈 칸 · 숫자가 아닌 값은 null(자료 없음). 콤마는 무시한다. */
function parseNum(s: string): number | null {
  const t = s.replace(/,/g, "").trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** 숫자 입력 칸 — 비우면 null. 입력 중에도 사용자가 친 글자를 그대로 보여준다. */
function NumberField({
  id,
  label,
  unit,
  value,
  onChange,
  hint,
}: {
  id: string;
  label: string;
  unit: string;
  value: number | null;
  onChange: (v: number | null) => void;
  hint?: string;
}) {
  const [text, setText] = useState<string>(value === null ? "" : String(value));
  const [last, setLast] = useState<number | null>(value);
  // 임시 값 버튼 등으로 바깥 값이 바뀌면 칸 글자도 맞춘다
  if (value !== last && value !== parseNum(text)) {
    setText(value === null ? "" : String(value));
    setLast(value);
  }
  return (
    <div className="field">
      <label htmlFor={id}>
        {label} <span className="unit">({unit})</span>
      </label>
      <input
        id={id}
        inputMode="decimal"
        value={text}
        placeholder="입력"
        onChange={(e) => {
          setText(e.target.value);
          const v = parseNum(e.target.value);
          setLast(v);
          onChange(v);
        }}
      />
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

export default function PlanApp() {
  const [input, setInput] = useState<PlanInput>(emptyInput);
  const [formKey, setFormKey] = useState(0); // 임시 값 · 초기화 때 입력 칸을 새로 그리기 위한 키

  /** 입력값 한 항목을 바꾼다 */
  const set = <K extends keyof PlanInput>(k: K, v: PlanInput[K]) => setInput((p) => ({ ...p, [k]: v }));

  /** 주택형 표의 한 칸을 바꾼다 */
  const setUnit = (i: number, k: keyof UnitType, v: string | number | null) =>
    setInput((p) => ({ ...p, unitTypes: p.unitTypes.map((t, j) => (j === i ? { ...t, [k]: v } : t)) }));

  const load = (next: PlanInput) => {
    setInput(next);
    setFormKey((k) => k + 1);
  };

  const supply = totalSupplyPyeong(input.unitTypes);
  const units = totalUnits(input.unitTypes);

  // ── 시장 분석: 지역 확인 → 동시 4개까지 호출, 끝난 표부터 그린다 ──
  const [market, setMarket] = useState<MarketData | null>(null);
  const [tasks, setTasks] = useState<Record<string, Task>>({});
  const [regionMsg, setRegionMsg] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<RegionCandidate[]>([]);
  const [busy, setBusy] = useState(false);

  /** 요청 하나를 실행하고 결과를 시장 데이터에 넣는다. 청약홈 목록이면 단지 상세 요청을 돌려준다. */
  const exec = async (t: Task): Promise<Task[] | void> => {
    setTasks((s) => ({ ...s, [t.key]: { ...t, status: "running", error: undefined } }));
    try {
      if (t.kind === "presale") {
        const r = await getJson<{ ym: string; deals: MarketData["presale"][string]["deals"]; cancelled: number; fetchedAt: string }>(t.url);
        setMarket((m) => (m ? { ...m, presale: { ...m.presale, [r.ym]: r } } : m));
      } else if (t.kind === "rent") {
        const r = await getJson<{ ym: string; deals: MarketData["rent"][string]["deals"]; fetchedAt: string }>(t.url);
        setMarket((m) => (m ? { ...m, rent: { ...m.rent, [r.ym]: r } } : m));
      } else if (t.kind === "subscription") {
        const r = await getJson<NonNullable<MarketData["sub"]>>(t.url);
        setMarket((m) => (m ? { ...m, sub: r } : m));
        setTasks((s) => ({ ...s, [t.key]: { ...t, status: "done" } }));
        const more = detailTasks(r.items);
        setTasks((s) => ({ ...s, ...Object.fromEntries(more.map((d) => [d.key, d])) }));
        return more;
      } else {
        const r = await getJson<{ id: string; pblanc: string } & MarketData["details"][string]>(t.url);
        setMarket((m) => (m ? { ...m, details: { ...m.details, [`${r.id}-${r.pblanc}`]: r } } : m));
      }
      setTasks((s) => ({ ...s, [t.key]: { ...t, status: "done" } }));
    } catch (e) {
      setTasks((s) => ({ ...s, [t.key]: { ...t, status: "error", error: e instanceof Error ? e.message : String(e) } }));
    }
  };

  /** 확인된 시군구 이름으로 시장 데이터를 받는다 */
  const startMarket = async (area: string) => {
    const m = emptyMarket(area);
    const queue = initialTasks(m);
    setMarket(m);
    setCandidates([]);
    setRegionMsg(null);
    setTasks(Object.fromEntries(queue.map((t) => [t.key, t])));
    setBusy(true);
    await runPool(queue, exec);
    setBusy(false);
  };

  /** [사업계획서 만들기] — 사업대상지 이름으로 지역부터 확인한다 */
  const build = async () => {
    const q = input.site.trim();
    if (!q) {
      setRegionMsg("사업대상지를 입력하세요 (예: 부산광역시 해운대구)");
      return;
    }
    setBusy(true);
    setRegionMsg("지역 확인 중…");
    try {
      const c = await fetchRegion(q);
      if (c.length === 0) {
        setRegionMsg(`"${q}"에 해당하는 시군구를 찾지 못했습니다 — 이름이나 행정구역 개편 여부를 확인하세요`);
        setBusy(false);
      } else if (c.length > 1) {
        setCandidates(c);
        setRegionMsg(`"${q}"에 해당하는 시군구가 ${c.length}곳입니다 — 하나를 고르세요`);
        setBusy(false);
      } else {
        await startMarket(c[0].name);
      }
    } catch (e) {
      setRegionMsg(`지역 확인 실패: ${e instanceof Error ? e.message : String(e)}`);
      setBusy(false);
    }
  };

  /** 실패한 요청만 다시 부른다 */
  const retry = async () => {
    const failed = Object.values(tasks).filter((t) => t.status === "error").map((t) => ({ ...t, status: "pending" as const, error: undefined }));
    if (failed.length === 0) return;
    setBusy(true);
    await runPool(failed, exec);
    setBusy(false);
  };

  return (
    <main className="doc">
      <header className="no-print toolbar">
        <div>
          <p className="eyebrow">시행사 → 대주단 제출용</p>
          <h1>사업계획서 작성</h1>
          <p className="sub">단위: 금액 억원 · 평당가 만원/평(공급면적 기준) · 면적 ㎡ / 평</p>
        </div>
        <div className="presets" role="group" aria-label="임시 값">
          <span className="sub">임시 값</span>
          {PRESETS.map((p) => (
            <button key={p.id} type="button" onClick={() => load(clonePreset(p.id))}>
              {p.label}
            </button>
          ))}
          <button type="button" className="ghost" onClick={() => load(emptyInput())}>
            비우기
          </button>
        </div>
      </header>
      <p className="no-print notice">임시 값은 교육용 가상 사업장입니다. 실재하는 단지 · 법인과 관계없습니다.</p>

      <section className="no-print card" key={formKey}>
        <h2>입력</h2>

        <div className="grid2">
          <div className="field">
            <label htmlFor="projectName">사업명</label>
            <input id="projectName" value={input.projectName} placeholder="입력" onChange={(e) => set("projectName", e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="site">
              사업대상지 <span className="unit">(시군구까지 · 동/지번 포함 주소도 가능)</span>
            </label>
            <input id="site" value={input.site} placeholder="예: 부산광역시 해운대구" onChange={(e) => set("site", e.target.value)} />
          </div>
        </div>

        <h3>주택형</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>이름</th>
                <th className="r">전용면적(㎡)</th>
                <th className="r">세대당 공급면적(평)</th>
                <th className="r">세대수</th>
                <th className="r">공급면적 소계(평)</th>
                <th aria-label="삭제"></th>
              </tr>
            </thead>
            <tbody>
              {input.unitTypes.map((t, i) => (
                <tr key={i}>
                  <td>
                    <input id={`ut-${i}-name`} aria-label={`${i + 1}번 주택형 이름`} value={t.name} placeholder="예: 84㎡" onChange={(e) => setUnit(i, "name", e.target.value)} />
                  </td>
                  <td>
                    <input id={`ut-${i}-ex`} aria-label="전용면적" className="r" inputMode="decimal" defaultValue={t.exclusiveM2 ?? ""} onChange={(e) => setUnit(i, "exclusiveM2", parseNum(e.target.value))} />
                  </td>
                  <td>
                    <input id={`ut-${i}-sp`} aria-label="세대당 공급면적" className="r" inputMode="decimal" defaultValue={t.supplyPyeong ?? ""} onChange={(e) => setUnit(i, "supplyPyeong", parseNum(e.target.value))} />
                  </td>
                  <td>
                    <input id={`ut-${i}-n`} aria-label="세대수" className="r" inputMode="numeric" defaultValue={t.units ?? ""} onChange={(e) => setUnit(i, "units", parseNum(e.target.value))} />
                  </td>
                  <td className="r">
                    <Num value={t.supplyPyeong !== null && t.units !== null ? t.supplyPyeong * t.units : null} digits={1} />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="ghost small"
                      onClick={() => {
                        setInput((p) => ({ ...p, unitTypes: p.unitTypes.filter((_, j) => j !== i) }));
                        setFormKey((k) => k + 1);
                      }}
                    >
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>
                  합계 <span className="formula">= Σ(세대당 공급면적 × 세대수) · Σ세대수</span>
                </td>
                <td className="r">
                  <Num value={units} unit="세대" />
                </td>
                <td className="r">
                  <Num value={supply} digits={1} unit="평" />
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
        <button
          type="button"
          className="ghost small"
          onClick={() => setInput((p) => ({ ...p, unitTypes: [...p.unitTypes, { name: "", exclusiveM2: null, supplyPyeong: null, units: null }] }))}
        >
          + 주택형 추가
        </button>

        <h3>분양 · 비용 · 자금</h3>
        <div className="grid3">
          <NumberField id="price" label="평당가" unit="만원/평, 공급기준" value={input.pricePerPyeong} onChange={(v) => set("pricePerPyeong", v)} />
          <NumberField id="retail" label="상가" unit="억원, 분양수입" value={input.retail} onChange={(v) => set("retail", v)} />
          <NumberField id="otherInflow" label="기타유입" unit="억원" value={input.otherInflow} onChange={(v) => set("otherInflow", v)} hint="분양대금 외 유입 — 자기자본 · 이자수입" />
          <NumberField id="fixedCost" label="고정비" unit="억원" value={input.fixedCost} onChange={(v) => set("fixedCost", v)} hint="분양 실적과 무관 — 토지 · 공사 · 간접비 · 금융비용" />
          <NumberField id="pf" label="본PF" unit="억원" value={input.pf} onChange={(v) => set("pf", v)} hint="만기 일시상환 차입금" />
          <NumberField id="pfFinanceCost" label="본PF 금융비용" unit="억원" value={input.pfFinanceCost} onChange={(v) => set("pfFinanceCost", v)} hint="이자 · 수수료" />
          <NumberField id="subordinated" label="후순위" unit="억원" value={input.subordinated} onChange={(v) => set("subordinated", v)} hint="본PF를 다 갚은 뒤 받는 돈 — 공사비 유보 · 시행사 대여금" />
        </div>

        <div className="build-row">
          <button type="button" className="primary" onClick={build} disabled={busy}>
            사업계획서 만들기
          </button>
          <span className="sub">사업대상지의 공공데이터(실거래 · 청약홈)로 2장 시장 분석을 채웁니다</span>
        </div>
        {regionMsg && <p className="region-msg">{regionMsg}</p>}
        {candidates.length > 0 && (
          <div className="presets">
            {candidates.map((c) => (
              <button key={c.code5} type="button" className="ghost" onClick={() => startMarket(c.name)}>
                {c.name}
              </button>
            ))}
          </div>
        )}
      </section>
      <Progress market={market} tasks={tasks} busy={busy} onRetry={retry} siteNow={input.site} />

      <article className="card report">
        <h2>1. 사업 개요</h2>
        <table className="kv">
          <tbody>
            <tr>
              <th>사업명</th>
              <td>{input.projectName || <span className="text-muted">자료 없음</span>}</td>
            </tr>
            <tr>
              <th>사업대상지</th>
              <td>{input.site || <span className="text-muted">자료 없음</span>}</td>
            </tr>
            <tr>
              <th>총 세대수</th>
              <td>
                <Num value={units} unit="세대" /> <span className="formula">= Σ세대수</span>
              </td>
            </tr>
            <tr>
              <th>공급면적 합계</th>
              <td>
                <Num value={supply} digits={1} unit="평" /> <span className="formula">= Σ(세대당 공급면적 × 세대수)</span>
              </td>
            </tr>
            <tr>
              <th>계획 분양가</th>
              <td>
                <Num value={input.pricePerPyeong} unit="만원/평(공급기준)" />
              </td>
            </tr>
          </tbody>
        </table>
        <h3>주택형</h3>
        {units === null ? (
          <p className="text-muted">자료 없음</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>주택형</th>
                  <th className="r">전용면적</th>
                  <th className="r">세대당 공급면적</th>
                  <th className="r">세대수</th>
                </tr>
              </thead>
              <tbody>
                {input.unitTypes
                  .filter((t) => t.units !== null || t.name)
                  .map((t, i) => (
                    <tr key={i}>
                      <td>{t.name || "자료 없음"}</td>
                      <td className="r">
                        <Num value={t.exclusiveM2} digits={1} unit="㎡" />
                        {t.exclusiveM2 !== null && <span className="text-muted"> ({fmt(m2ToPyeong(t.exclusiveM2), 1)}평)</span>}
                      </td>
                      <td className="r">
                        <Num value={t.supplyPyeong} digits={1} unit="평" />
                      </td>
                      <td className="r">
                        <Num value={t.units} unit="세대" />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </article>

      <Report input={input} market={market} tasks={tasks} />
    </main>
  );
}

// ───────────── 시장 분석: 진행 표시 ─────────────

/** 진행 표시 — 분양권 n/12개월 · 전월세 n/12개월 · 청약홈 k/N곳, 실패 항목과 [다시 시도] */
function Progress({ market, tasks, busy, onRetry, siteNow }: { market: MarketData | null; tasks: Record<string, Task>; busy: boolean; onRetry: () => void; siteNow: string }) {
  if (!market) return null;
  const list = Object.values(tasks);
  const done = (k: Task["kind"]) => list.filter((t) => t.kind === k && t.status === "done").length;
  const total = (k: Task["kind"]) => list.filter((t) => t.kind === k).length;
  const subDone = tasks["subscription"]?.status === "done";
  const failed = list.filter((t) => t.status === "error");
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  return (
    <section className="no-print card progress" aria-live="polite">
      <div className="progress-line">
        <strong>{market.area}</strong>
        <span>분양권 {done("presale")}/{total("presale")}개월</span>
        <span>전월세 {done("rent")}/{total("rent")}개월</span>
        <span>청약홈 {subDone ? `${done("detail")}/${total("detail")}곳` : "목록 확인 중"}</span>
        {busy ? <span className="text-muted">받는 중…</span> : failed.length === 0 ? <span className="text-ok">완료</span> : null}
      </div>
      {norm(siteNow) !== norm(market.area) && <p className="text-bad small-note">사업대상지가 바뀌었습니다 — [사업계획서 만들기]를 다시 누르세요</p>}
      {failed.length > 0 && (
        <div className="failed">
          <p className="text-bad">실패 {failed.length}건</p>
          <ul>
            {failed.slice(0, 6).map((t) => (
              <li key={t.key}>
                {t.key}: {t.error}
              </li>
            ))}
            {failed.length > 6 && <li>외 {failed.length - 6}건</li>}
          </ul>
          <button type="button" className="ghost small" onClick={onRetry} disabled={busy}>
            다시 시도
          </button>
        </div>
      )}
    </section>
  );
}

// ───────────── 시장 분석: 2장 표 ─────────────

/** 받아 온 데이터에서 단지별 상세(공고 + 주택형 + 경쟁률)를 묶는다 */
function joinDetails(market: MarketData): SubscriptionDetail[] {
  if (!market.sub) return [];
  return market.sub.items
    .filter((it) => market.details[`${it.id}-${it.pblanc}`])
    .map((it) => ({ item: it, ...market.details[`${it.id}-${it.pblanc}`] }));
}

/** 2장에 쓰는 요약 — 5 · 6장 "시장 대비 여유"에도 쓴다 */
export interface MarketSummary {
  area: string;
  nearbyAvg: number | null; // 인근 신규 84㎡ 공급평당(만원/평)
  rows: number;
  fetchedAt: string;
}

/** 시장 데이터에서 인근 신규 84㎡ 공급평당 요약을 만든다 */
function summarize(market: MarketData | null, planPrice: number | null): MarketSummary | null {
  if (!market) return null;
  const t = supplyPriceTable(joinDetails(market), planPrice);
  return { area: market.area, nearbyAvg: t.avg, rows: t.rows.length, fetchedAt: latestDate(market) };
}

/** 받아 온 응답 중 가장 늦은 조회일 */
function latestDate(market: MarketData): string {
  const ds = [
    ...Object.values(market.presale).map((x) => x.fetchedAt),
    ...Object.values(market.rent).map((x) => x.fetchedAt),
    ...Object.values(market.details).map((x) => x.fetchedAt),
    market.sub?.fetchedAt ?? "",
  ].filter(Boolean);
  return ds.sort().at(-1) ?? "";
}

/** 표 아래 공통 줄 — 지역 · 건수 · 제외 기준 · 조회일 */
function Meta({ area, count, excluded, fetchedAt, note }: { area: string; count: string; excluded: string; fetchedAt: string; note?: string }) {
  return (
    <p className="meta">
      지역 {area} · 건수 {count} · 제외 기준: {excluded} · 조회일 {fetchedAt || "-"}
      {note && <> · {note}</>}
    </p>
  );
}

/** 2장 시장 분석 · 분양가 근거 */
function MarketSection({ input, market, tasks }: { input: PlanInput; market: MarketData | null; tasks: Record<string, Task> }) {
  if (!market) {
    return (
      <article className="card report">
        <h2>2. 시장 분석 · 분양가 근거</h2>
        <p className="text-muted">
          자료 없음 — 공공데이터 확인 필요<span className="no-print"> ([사업계획서 만들기]를 누르면 사업대상지 기준으로 채웁니다)</span>
        </p>
      </article>
    );
  }
  const details = joinDetails(market);
  const presaleMonths = Object.keys(market.presale).length;
  const rentMonths = Object.keys(market.rent).length;
  const period = `${market.months[0].slice(0, 4)}.${market.months[0].slice(4)} ~ ${market.months.at(-1)!.slice(0, 4)}.${market.months.at(-1)!.slice(4)} 계약`;
  const subDate = market.sub?.fetchedAt ?? "";
  const totalDetails = Object.values(tasks).filter((t) => t.kind === "detail").length;
  const detailNote = `청약홈 상세 ${details.length}/${totalDetails}곳 반영`;

  const supply = supplyPriceTable(details, input.pricePerPyeong);
  const presaleDeals = Object.values(market.presale).flatMap((x) => x.deals);
  const cancelled = Object.values(market.presale).reduce((s, x) => s + x.cancelled, 0);
  const premium = premiumTable(presaleDeals, details);
  const shortfall = shortfallTable(details);
  const remainder = remainderTable(market.sub?.remainders ?? []);
  const our84 = pickOur84(input.unitTypes);
  const rent = rentRatioTable(
    Object.values(market.rent).flatMap((x) => x.deals),
    our84 && our84.supplyPyeong !== null && input.pricePerPyeong !== null ? { supplyPyeong: our84.supplyPyeong, pricePerPyeong: input.pricePerPyeong } : null,
    Number(market.months.at(-1)!.slice(0, 4)),
  );
  const presaleDate = Object.values(market.presale).map((x) => x.fetchedAt).sort().at(-1) ?? "";
  const rentDate = Object.values(market.rent).map((x) => x.fetchedAt).sort().at(-1) ?? "";
  // 차트용 기준값 — 5장과 같은 값(상환 한계 평당가 정수 · 인근 평균 정수)으로 여유를 맞춘다
  const calcIn = toCalcInput(input).value;
  const pfLimitPrice = calcIn ? riskMargins(calcIn).pfPrice : null;
  const nearbyAvg = supply.avg !== null ? Math.round(supply.avg) : null;

  return (
    <article className="card report">
      <h2>2. 시장 분석 · 분양가 근거</h2>
      <p className="sub">
        사업대상지 {market.area} · 국토교통부 실거래가(분양권전매 · 아파트 전월세), 한국부동산원 청약홈(분양정보 · 경쟁률) · 청약홈은 최근 3년(모집공고일 {market.sub?.since ?? "-"} 이후) 공급위치 기준
      </p>

      <h3>① 인근 신규 84㎡ 공급평당 vs 계획가</h3>
      {supply.rows.length === 0 ? (
        <p className="text-muted">자료 없음{market.sub ? "" : " — 청약홈 확인 중"}</p>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>단지</th>
                  <th>모집공고일</th>
                  <th>주택형</th>
                  <th className="r">공급면적(평)</th>
                  <th className="r">분양최고금액(만원)</th>
                  <th className="r">공급평당(만원/평)</th>
                </tr>
              </thead>
              <tbody>
                {supply.rows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.name}</td>
                    <td>{r.noticeDate}</td>
                    <td>{r.houseTy}</td>
                    <td className="r"><Num value={r.supplyPyeong} digits={1} /></td>
                    <td className="r"><Num value={r.topAmount} /></td>
                    <td className="r"><Num value={r.pricePerPyeong} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            인근 신규 84㎡ 공급평당 <strong><Num value={supply.avg} unit="만원/평" /></strong> (세대수 가중 평균) vs 계획가 <Num value={input.pricePerPyeong} unit="만원/평" /> → 계획가가{" "}
            {supply.diffPct === null ? "자료 없음" : supply.diffPct <= 0 ? <strong>{fmt(Math.abs(supply.diffPct), 1)}% 낮음</strong> : <strong className="text-bad">{fmt(supply.diffPct, 1)}% 높음</strong>}
            <span className="formula">= 계획가 ÷ 인근 평균 − 1</span>
          </p>
        </>
      )}
      <Meta
        area={market.area}
        count={`주택형 ${fmt(supply.rows.length)}개 · ${fmt(supply.complexes)}개 단지`}
        excluded={`84㎡형(전용 84~86㎡) 외 ${fmt(supply.excluded.not84)}개 · 분양가 없음 ${fmt(supply.excluded.noPrice)}개`}
        fetchedAt={subDate}
        note={`분양최고금액 기준이라 평균 분양가보다 높게 나옴 · ${detailNote}`}
      />
      <MarketMarginChart
        rows={supply.rows}
        complexes={supply.complexes}
        nearbyAvg={nearbyAvg}
        planPrice={input.pricePerPyeong}
        pfLimitPrice={pfLimitPrice}
        margin={marketMargin(pfLimitPrice, nearbyAvg)}
        area={market.area}
        fetchedAt={subDate}
      />

      <h3>② 분양권 웃돈 (입주권 제외)</h3>
      {premium.rows.length === 0 ? (
        <p className="text-muted">자료 없음</p>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>단지</th>
                  <th className="r">거래</th>
                  <th className="r">평균 웃돈(만원)</th>
                  <th className="r">분양가 대비</th>
                  <th className="r">마이너스 거래</th>
                </tr>
              </thead>
              <tbody>
                {premium.rows.map((r) => (
                  <tr key={r.name}>
                    <td>{r.name}</td>
                    <td className="r"><Num value={r.deals} unit="건" /></td>
                    <td className="r"><Num value={r.avgPremium} /></td>
                    <td className="r"><Num value={r.avgPremiumPct} digits={1} unit="%" /></td>
                    <td className="r"><Num value={r.minusDeals} unit="건" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            평균 웃돈 <strong><Num value={premium.avgPremium} unit="만원" /></strong> · 마이너스 거래 {fmt(premium.minusDeals)}건 / {fmt(premium.matched)}건
            <span className="formula">= 분양권 거래금액 − 같은 단지 · 전용 ±0.5㎡ 주택형의 분양최고금액</span>
          </p>
        </>
      )}
      <Meta
        area={market.area}
        count={`분양권 ${fmt(premium.matched)}건 (${presaleMonths}/12개월 · ${period})`}
        excluded={`해제 ${fmt(cancelled)}건 · 입주권 ${fmt(premium.excluded.moveInRights)}건 · 청약홈 공고와 짝 없음 ${fmt(premium.excluded.unmatched)}건`}
        fetchedAt={presaleDate}
        note="분양최고금액 기준이라 실제 웃돈보다 작게 나옴 · 최근 달은 신고 기한(30일) 전이라 덜 잡힐 수 있음"
      />

      <h3>③ 1 · 2순위 미달</h3>
      {shortfall.rows.length === 0 ? (
        <p className="text-muted">자료 없음</p>
      ) : (
        <>
          <p>
            주택형 {fmt(shortfall.rows.length)}개 중 1순위 미달 <strong className={shortfall.rank1Short > 0 ? "text-bad" : ""}>{fmt(shortfall.rank1Short)}개</strong> · 2순위까지 미달{" "}
            <strong className={shortfall.rank2Short > 0 ? "text-bad" : ""}>{fmt(shortfall.rank2Short)}개</strong>
            <span className="formula">순위별 접수 합계(해당 + 기타지역) vs 공급세대</span>
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>단지</th>
                  <th>모집공고일</th>
                  <th>주택형</th>
                  <th className="r">공급세대</th>
                  <th className="r">1순위 접수</th>
                  <th className="r">1 + 2순위 접수</th>
                  <th>결과</th>
                </tr>
              </thead>
              <tbody>
                {shortfall.rows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.name}</td>
                    <td>{r.noticeDate}</td>
                    <td>{r.houseTy}</td>
                    <td className="r"><Num value={r.supplyUnits} /></td>
                    <td className="r"><Num value={r.rank1} /></td>
                    <td className="r"><Num value={r.rank12} /></td>
                    <td className={r.status === "1순위 마감" ? "" : "text-bad"}>{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <Meta
        area={market.area}
        count={`주택형 ${fmt(shortfall.rows.length)}개`}
        excluded={`경쟁률 자료 없는 단지 ${fmt(shortfall.excluded.noData)}곳`}
        fetchedAt={subDate}
        note={`경쟁률은 청약 접수 기준으로 계약률이 아님 · ${detailNote}`}
      />

      <h3>④ 잔여세대</h3>
      {remainder.rows.length === 0 ? (
        <p className="text-muted">{market.sub ? "최근 3년 잔여세대 공고 없음" : "자료 없음"}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>단지</th>
                <th>모집공고일</th>
                <th>공급위치</th>
                <th className="r">잔여세대 공급</th>
              </tr>
            </thead>
            <tbody>
              {remainder.rows.map((r) => (
                <tr key={`${r.id}-${r.pblanc}`}>
                  <td>{r.name}</td>
                  <td>{r.noticeDate}</td>
                  <td>{r.address}</td>
                  <td className="r"><Num value={r.totalUnits} unit="세대" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Meta
        area={market.area}
        count={`잔여세대 공고 ${fmt(remainder.rows.length)}건 · ${fmt(remainder.totalUnits)}세대`}
        excluded="공급위치에 지역명이 없는 공고"
        fetchedAt={subDate}
        note="미계약 · 계약 해지분 재공급 공고 — 공고가 있다는 것은 미계약이 생겼다는 신호"
      />

      <h3>⑤ 84㎡ 신규 전세 ÷ 우리 84㎡ 세대당 분양가</h3>
      {rent.count === 0 || rent.ourPrice === null ? (
        <p className="text-muted">자료 없음{rent.ourPrice === null ? " — 우리 사업에 84㎡ 주택형이 없거나 평당가가 비어 있음" : ""}</p>
      ) : (
        <p>
          인근 신규 84㎡ 전세 평균 <strong><Num value={rent.avgDeposit} unit="만원" /></strong> ÷ 우리 84㎡ 세대당 분양가 <Num value={rent.ourPrice} unit="만원" /> ={" "}
          <strong><Num value={rent.ratioPct} digits={1} unit="%" /></strong>
          <span className="formula">세대당 분양가 = 84㎡ 공급면적 {fmt(our84?.supplyPyeong ?? null, 1)}평 × 계획 평당가 · 잔금 때 전세를 놓아 메울 수 있는 비율</span>
        </p>
      )}
      <Meta
        area={market.area}
        count={`전세 ${fmt(rent.count)}건 · ${fmt(rent.complexes)}개 단지 (${rentMonths}/12개월 · ${period})`}
        excluded={`월세 ${fmt(rent.excluded.monthly)}건 · 84㎡형 외 ${fmt(rent.excluded.not84)}건 · 건축 ${Number(market.months.at(-1)!.slice(0, 4)) - 5}년 미만 ${fmt(rent.excluded.old)}건`}
        fetchedAt={rentDate}
        note="전월세 기술문서에 해제 항목이 없어 해제 제외는 적용하지 않음"
      />
    </article>
  );
}

/** 빈 장 표시 — 계산에 필요한 값이 비어 있을 때 */
function NoData({ missing }: { missing: string[] }) {
  return (
    <p className="text-muted">
      자료 없음 — 입력되지 않은 항목: {missing.join(" · ")}
    </p>
  );
}

/** 지표 한 줄 — 이름 · 값 · 계산 수식 */
function Row({ label, children, formula, strong }: { label: string; children: React.ReactNode; formula?: string; strong?: boolean }) {
  return (
    <tr className={strong ? "strong" : undefined}>
      <th>{label}</th>
      <td className="r">{children}</td>
      <td className="formula-cell">{formula}</td>
    </tr>
  );
}

/** 분양률(0~1)을 % 문자열로. 100%를 넘으면 상환 불가 뜻을 붙인다. */
function RatePct({ rate }: { rate: number | null }) {
  if (rate === null) return <span className="text-muted">자료 없음</span>;
  return (
    <span className="tabular-nums">
      {fmt(rate * 100, 1)}%{rate > 1 && <span className="text-bad"> (100% 초과 — 다 팔아도 부족)</span>}
    </span>
  );
}

/** 사업계획서 2~7장 */
function Report({ input, market, tasks }: { input: PlanInput; market: MarketData | null; tasks: Record<string, Task> }) {
  const { value: c, missing } = toCalcInput(input);
  const summary = summarize(market, input.pricePerPyeong);
  const failed = Object.values(tasks).filter((t) => t.status === "error").length;
  return (
    <>
      <MarketSection input={input} market={market} tasks={tasks} />

      {c === null ? (
        <article className="card report">
          <h2>3. 사업수지</h2>
          <NoData missing={missing} />
          <h2 className="mt">4. 자금조달과 상환</h2>
          <NoData missing={missing} />
          <h2 className="mt">5. 민감도</h2>
          <NoData missing={missing} />
          <h2 className="mt">6. 리스크와 완화 방안</h2>
          <NoData missing={missing} />
        </article>
      ) : (
        <Chapters c={c} market={summary} />
      )}

      <article className="card report">
        <h2>7. 확인하지 못한 것</h2>
        <ul className="list">
          {!market && <li>2장 시장 분석 · 분양가 근거: 자료 없음 — 공공데이터 확인 필요</li>}
          {market && failed > 0 && <li>공공데이터 요청 {failed}건 실패 — 해당 부분은 2장 표에서 빠짐</li>}
          {market && <li>시장 분석은 사업대상지 시군구({market.area}) 단위 — 단지까지의 거리 · 입지 차이는 반영하지 않음</li>}
          {market && <li>청약홈 분양가는 분양최고금액, 경쟁률은 접수 기준 — 실제 평균 분양가 · 계약률은 확인하지 못함</li>}
          {missing.length > 0 && <li>입력되지 않은 항목: {missing.join(" · ")}</li>}
          <li>
            <strong>월별 자금수지 · IRR은 이 앱의 범위 밖</strong> — 만기 시점 누적값(기말현금 · 누적 DSCR)만 계산합니다. 공사 중 자금 부족 시점은 확인하지 못합니다.
          </li>
          <li>고정비 · 금융비용의 세부 내역과 적정성: 입력된 합계만 사용</li>
        </ul>
      </article>
    </>
  );
}

/** 계산이 가능한 경우의 3~6장 */
function Chapters({ c, market }: { c: CalcInput; market: MarketSummary | null }) {
  const revenue = salesRevenue(c, 1);
  const levy = revenue * (1 - SCHOOL_LEVY_KEEP);
  const agency = c.units * AGENCY_FEE_PER_UNIT;
  const cash = endCash(c, 1);
  const dscr = maturityDscr(c);
  const loanToValue = ltv(c);
  const lines = limitLines(c);
  const grid = sensitivityGrid(c);
  const m = riskMargins(c);
  const p = fmt(c.pricePerPyeong);
  // 시장 대비 여유 — 화면에 보이는 반올림 값(상환 한계 평당가 정수, 인근 평균 정수)으로 계산
  const nearby = market?.nearbyAvg != null ? Math.round(market.nearbyAvg) : null;
  const margin = marketMargin(m.pfPrice, nearby);

  return (
    <>
      <article className="card report">
        <h2>3. 사업수지</h2>
        <p className="sub">분양률 100% · 계획 평당가 {p}만원/평(공급기준) 기준. 단위 억원.</p>
        <table className="kv3">
          <tbody>
            <Row label="분양수입" formula={`(공급면적 ${fmt(c.supplyPyeong, 1)}평 × ${p}만원 ÷ 10,000 + 상가 ${fmt(c.retail, 1)}) × 100%`}>
              <Num value={revenue} digits={1} />
            </Row>
            <Row label="변동비 — 학교용지부담금" formula="분양수입 × 0.8%">
              <Num value={-levy} digits={1} />
            </Row>
            <Row label="변동비 — 분양대행수수료" formula={`세대수 ${fmt(c.units)} × 100% × 0.03억(300만원)`}>
              <Num value={-agency} digits={1} />
            </Row>
            <Row label="기타유입" formula="입력값 — 자기자본 · 이자수입 등">
              <Num value={c.otherInflow} digits={1} />
            </Row>
            <Row label="고정비" formula="입력값 — 토지 · 공사 · 간접비 · 금융비용">
              <Num value={-c.fixedCost} digits={1} />
            </Row>
            <Row label="기말현금" strong formula="분양수입 × 0.992 − 세대수 × 분양률 × 0.03 + 기타유입 − 고정비">
              <Num value={cash} digits={1} />
            </Row>
          </tbody>
        </table>
        <WaterfallChart steps={waterfallSteps(c)} subordinated={c.subordinated} repayable={canRepayPf(c, cash)} basis={`분양률 100% · 계획 평당가 ${p}만원/평`} />
      </article>

      <article className="card report">
        <h2>4. 자금조달과 상환</h2>
        <table className="kv3">
          <tbody>
            <Row label="본PF" formula="입력값 — 만기 일시상환">
              <Num value={c.pf} digits={1} unit="억원" />
            </Row>
            <Row label="본PF 금융비용" formula="입력값 — 이자 · 수수료">
              <Num value={c.pfFinanceCost} digits={1} unit="억원" />
            </Row>
            <Row label="후순위" formula="입력값 — 본PF를 다 갚은 뒤 지급">
              <Num value={c.subordinated} digits={1} unit="억원" />
            </Row>
            <Row label="만기 누적 DSCR" strong formula={`1 + (기말현금 ${fmt(cash, 1)} + 후순위 ${fmt(c.subordinated, 1)}) ÷ (본PF ${fmt(c.pf, 1)} + 금융비용 ${fmt(c.pfFinanceCost, 1)})`}>
              <Num value={dscr} digits={2} unit="배" />
            </Row>
            <Row label="LTV" strong formula={`본PF ${fmt(c.pf, 1)} ÷ 분양수입 ${fmt(revenue, 1)} (분양률 100%)`}>
              <Num value={loanToValue} digits={1} unit="%" />
            </Row>
          </tbody>
        </table>
        <p className="sub">
          상환 여부: 기말현금 {fmt(cash, 1)}억이 −후순위({fmt(-c.subordinated, 1)}억) 이상이면 본PF 원리금 전액 상환 가능 —{" "}
          {cash >= -c.subordinated ? <strong className="text-ok">상환 가능</strong> : <strong className="text-bad">상환 불가</strong>}
        </p>
      </article>

      <article className="card report">
        <h2>5. 민감도</h2>
        <h3>두 한계선</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>한계선</th>
                <th className="r">분양률 (계획 평당가 {p}만원)</th>
                <th className="r">평당가 (분양률 100%, 공급기준)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>기말현금 0 — 후순위까지 전액 지급</td>
                <td className="r"><RatePct rate={lines.zero.rate} /></td>
                <td className="r"><Num value={lines.zero.price} unit="만원/평" /></td>
              </tr>
              <tr className="strong">
                <td>기말현금 −후순위 — 본PF 전액 상환 한계</td>
                <td className="r"><RatePct rate={lines.pfLimit.rate} /></td>
                <td className="r"><Num value={lines.pfLimit.price} unit="만원/평" /></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="formula">이분법으로 기말현금 = 0, 기말현금 = −후순위({fmt(-c.subordinated, 1)}억)가 되는 지점을 찾음</p>

        <h3>분양률 × 평당가 — 기말현금(억원)</h3>
        <div className="table-wrap">
          <table className="sens">
            <thead>
              <tr>
                <th>분양률 ↓ · 평당가 →</th>
                {grid.prices.map((pp, j) => (
                  <th key={pp} className="r">
                    {fmt(pp)}
                    <span className="th-sub">{SENS_LABELS[j]}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.rates.map((r, i) => (
                <tr key={r}>
                  <th>{fmt(r * 100)}%</th>
                  {grid.cells[i].map((cell, j) => (
                    <td key={j} className={`r ${cell.repayable ? "ok" : "ng"}`}>
                      {fmt(cell.cash, 1)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="legend">
          <span className="ok swatch">상환 가능</span> 기말현금 ≥ −후순위 · <span className="ng swatch">상환 불가</span> 기말현금 &lt; −후순위
        </p>
        <div className="conclusion">
          <p className="sentence">{repaySentence(c)}</p>
          <div className="margin-box">
            <div className="margin-label">시장 대비 여유</div>
            {m.pfPrice === null || nearby === null || margin === null ? (
              <p className="text-muted">자료 없음 — 2장 인근 신규 84㎡ 공급평당 필요</p>
            ) : (
              <>
                <p className="margin-value">
                  <Num value={margin} digits={1} unit="%" />
                </p>
                <p className="formula">
                  상환 한계 평당가 {fmt(m.pfPrice)}만원 — 인근 신규 84㎡ 공급평당 {fmt(nearby)}만원 ({market!.area}, 주택형 {fmt(market!.rows)}개, 조회일 {market!.fetchedAt}) · 여유 = 1 − {fmt(m.pfPrice)} ÷ {fmt(nearby)}
                </p>
              </>
            )}
          </div>
        </div>
        {lines.pfLimit.rate !== null && lines.pfLimit.rate > 0 && lines.pfLimit.rate <= 1 && (
          <p className="formula">
            상환 한계 분양률 {fmt(lines.pfLimit.rate * 100, 2)}%를 소수 1자리로 올림 — 위 표(반올림)와 0.1%p 다를 수 있음
          </p>
        )}
      </article>

      <article className="card report">
        <h2>6. 리스크와 완화 방안</h2>
        <p className="sub">5장의 상환 한계선에서 거꾸로 짚습니다. 숫자는 화면에 보이는 반올림 값으로 계산했습니다.</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>리스크</th>
                <th>근거 숫자</th>
                <th>완화 방안</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>분양률 미달</td>
                <td>
                  {m.pfRate === null || m.rateMargin === null ? (
                    "자료 없음"
                  ) : m.pfRate > 100 ? (
                    <span className="text-bad">계획가에서는 분양률 100%로도 본PF 상환 불가</span>
                  ) : (
                    <>상환 한계 분양률 {fmt(m.pfRate, 1)}% → 미분양 허용 {fmt(m.rateMargin, 1)}%p (= 100 − {fmt(m.pfRate, 1)}), 약 {fmt(m.unsoldUnits)}세대</>
                  )}
                </td>
                <td>상환 한계 분양률에 여유를 둔 계약률을 본PF 인출 · 상환 조건으로 건다</td>
              </tr>
              <tr>
                <td>분양가 하락</td>
                <td>
                  {m.pfPrice === null || m.priceMargin === null ? (
                    "자료 없음"
                  ) : (
                    <>상환 한계 평당가 {fmt(m.pfPrice)}만원 → 계획 {p}만원 대비 <Num value={m.priceMargin} digits={1} unit="%" /> (= {fmt(m.pfPrice)} ÷ {p} − 1)</>
                  )}
                </td>
                <td>
                  {margin === null ? (
                    "2장 시장 분석(공공데이터)으로 계획 평당가의 근거를 확인한다 — 현재 자료 없음"
                  ) : (
                    <>
                      인근 신규 84㎡ 공급평당 {fmt(nearby)}만원 대비 상환 한계까지 여유 <Num value={margin} digits={1} unit="%" /> — 분양최고금액 기준이라 실제 여유는 이보다 작을 수 있다
                    </>
                  )}
                </td>
              </tr>
              <tr>
                <td>후순위 완충 부족</td>
                <td>
                  {m.subordinatedBuffer === null || m.zeroRate === null || m.pfRate === null ? (
                    "자료 없음"
                  ) : (
                    <>후순위 {fmt(c.subordinated, 1)}억이 받쳐 주는 분양률 폭 {fmt(m.subordinatedBuffer, 1)}%p (= {fmt(m.zeroRate, 1)} − {fmt(m.pfRate, 1)})</>
                  )}
                </td>
                <td>후순위 지급 조건(본PF 전액 상환 후)을 약정서에서 확인한다</td>
              </tr>
              <tr>
                <td>만기 상환 여력</td>
                <td>
                  만기 누적 DSCR <Num value={dscr} digits={2} unit="배" /> · LTV <Num value={loanToValue} digits={1} unit="%" />
                </td>
                <td>DSCR이 1배에 가까우면 만기 연장 옵션 · 추가 신용보강을 검토한다</td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>
    </>
  );
}

/** 민감도 열 머리 아래 작은 글씨 — 계획 평당가 대비 차이 */
const SENS_LABELS = ["−500", "−400", "−300", "−200", "−100", "계획", "+100"];
