import "server-only";

// 공공데이터 호출 — 서버 전용. 인증키는 .env.local의 DATA_GO_KR_KEY에서 읽고, 값을 응답 · 로그에 넣지 않는다.
// 주소 · 파라미터는 api_docs/ 기술문서 그대로. 캐시: 법정동코드 30일, 나머지 하루.

import { cacheLife } from "next/cache";
import {
  pickSggCandidates,
  parseRtmsXml,
  toCompetitionRow,
  toModelRow,
  toPresaleDeal,
  toRentDeal,
  toSubscriptionItem,
  type CompetitionRow,
  type ModelRow,
  type PresaleDeal,
  type RegionCandidate,
  type RentDeal,
  type StanReginRow,
  type SubscriptionItem,
} from "./market";

const DATA_GO = "https://apis.data.go.kr";
const ODCLOUD = "https://api.odcloud.kr/api";
const TIMEOUT_MS = 20000;

/** 사용자에게 보여줄 수 있는 오류 — 키 값은 담지 않는다 */
export class PublicDataError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

/** 인증키를 읽는다. 없으면 설정 안내 오류. 값 자체는 어디에도 출력하지 않는다. */
function key(): string {
  const k = process.env.DATA_GO_KR_KEY;
  if (!k) throw new PublicDataError("인증키가 없습니다 — .env.local에 DATA_GO_KR_KEY를 넣으세요", 500);
  return k;
}

/** GET 요청을 보내고 본문 문자열을 돌려준다. 오류 메시지에서 키가 보이지 않게 지운다. */
async function getText(base: string, params: Record<string, string | number>, keyParam: string): Promise<string> {
  const k = key();
  const url = new URL(base);
  url.searchParams.set(keyParam, k);
  for (const [n, v] of Object.entries(params)) url.searchParams.set(n, String(v));
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new PublicDataError(`공공데이터 연결 실패: ${msg.split(k).join("***")}`);
  }
  const text = await res.text();
  if (!res.ok) {
    const hint = res.status === 403 || text.includes("SERVICE_KEY_IS_NOT_REGISTERED") ? " — 해당 API 활용신청이 필요합니다" : "";
    throw new PublicDataError(`공공데이터 응답 오류 HTTP ${res.status}${hint}`);
  }
  return text;
}

/** 오늘 날짜 문자열 YYYY-MM-DD — 조회일 표시용 */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// ───────────── 법정동코드 (30일 캐시) ─────────────

/** 지역 이름으로 시군구 후보를 찾는다. 이름이 정확히 같은 시군구가 있으면 그것만 돌려준다. */
export async function findRegion(q: string): Promise<{ candidates: RegionCandidate[]; fetchedAt: string }> {
  "use cache";
  cacheLife({ stale: 86400, revalidate: 86400 * 30, expire: 86400 * 60 });
  const text = await getText(
    `${DATA_GO}/1741000/StanReginCd/getStanReginCdList`,
    { type: "json", pageNo: 1, numOfRows: 1000, flag: "Y", locatadd_nm: q },
    "ServiceKey",
  );
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    throw new PublicDataError("법정동코드 응답을 읽지 못했습니다");
  }
  const root = (j as { StanReginCd?: unknown[]; RESULT?: { resultCode?: string } }) ?? {};
  if (!root.StanReginCd) {
    // INFO-3 데이터 없음 → 후보 없음(오류 아님)
    if (root.RESULT?.resultCode === "INFO-3") return { candidates: [], fetchedAt: today() };
    throw new PublicDataError(`법정동코드 오류: ${root.RESULT?.resultCode ?? "알 수 없음"}`);
  }
  const rows = (root.StanReginCd[1] as { row?: StanReginRow[] })?.row ?? [];
  return { candidates: pickSggCandidates(rows, q), fetchedAt: today() };
}

/** 지역 이름을 시군구 코드 하나로 확인한다. 후보가 없거나 여러 개면 오류. */
export async function resolveRegion(area: string): Promise<RegionCandidate> {
  const { candidates } = await findRegion(area);
  if (candidates.length === 0) throw new PublicDataError(`"${area}"에 해당하는 시군구를 찾지 못했습니다 — 행정구역 개편 여부를 확인하세요`, 404);
  if (candidates.length > 1) throw new PublicDataError(`"${area}"에 해당하는 시군구가 ${candidates.length}곳입니다 — 시군구 전체 이름으로 입력하세요`, 409);
  return candidates[0];
}

// ───────────── 실거래 (하루 캐시) ─────────────

/** 국토부 실거래 한 달치를 모든 페이지 받아 item 목록으로 돌려준다 */
async function rtmsMonth(path: string, code5: string, ym: string): Promise<Record<string, string>[]> {
  const items: Record<string, string>[] = [];
  for (let page = 1; page <= 20; page++) {
    const xml = await getText(`${DATA_GO}${path}`, { LAWD_CD: code5, DEAL_YMD: ym, pageNo: page, numOfRows: 1000 }, "serviceKey");
    const r = parseRtmsXml(xml);
    if (!r.ok) throw new PublicDataError(`실거래 응답 오류 ${r.code}: ${r.message}`);
    items.push(...r.items);
    if (items.length >= r.totalCount || r.items.length === 0) break;
  }
  return items;
}

/** 분양권전매 한 달치 — 해제 거래는 빼고 건수만 센다 */
export async function presaleMonth(code5: string, ym: string): Promise<{ deals: PresaleDeal[]; cancelled: number; fetchedAt: string }> {
  "use cache";
  cacheLife({ stale: 3600, revalidate: 86400, expire: 86400 * 2 });
  const items = await rtmsMonth("/1613000/RTMSDataSvcSilvTrade/getRTMSDataSvcSilvTrade", code5, ym);
  const deals: PresaleDeal[] = [];
  let cancelled = 0;
  for (const it of items) {
    const p = toPresaleDeal(it);
    if (!p) continue;
    if (p.cancelled) cancelled++;
    else deals.push(p.deal);
  }
  return { deals, cancelled, fetchedAt: today() };
}

/** 아파트 전월세 한 달치 (기술문서에 해제 항목이 없어 해제 제외는 적용되지 않는다) */
export async function rentMonth(code5: string, ym: string): Promise<{ deals: RentDeal[]; fetchedAt: string }> {
  "use cache";
  cacheLife({ stale: 3600, revalidate: 86400, expire: 86400 * 2 });
  const items = await rtmsMonth("/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent", code5, ym);
  const deals = items.map(toRentDeal).filter((d): d is RentDeal => d !== null);
  return { deals, fetchedAt: today() };
}

// ───────────── 청약홈 (하루 캐시) ─────────────

/** 청약홈 JSON 목록을 모든 페이지 받는다 (조건은 cond[필드::연산자] 형식) */
async function odcloudAll(path: string, cond: Record<string, string>): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let page = 1; page <= 20; page++) {
    const params: Record<string, string | number> = { page, perPage: 500 };
    for (const [k, v] of Object.entries(cond)) params[`cond[${k}]`] = v;
    const text = await getText(`${ODCLOUD}${path}`, params, "serviceKey");
    let j: { data?: Record<string, unknown>[]; matchCount?: number; totalCount?: number };
    try {
      j = JSON.parse(text);
    } catch {
      throw new PublicDataError("청약홈 응답을 읽지 못했습니다");
    }
    const data = j.data ?? [];
    out.push(...data);
    const total = j.matchCount ?? j.totalCount ?? 0;
    if (out.length >= total || data.length === 0) break;
  }
  return out;
}

/** 공급위치 LIKE 지역명 · 모집공고일 since 이후 — APT 분양 공고와 잔여세대 공고 */
export async function subscriptions(area: string, since: string): Promise<{ items: SubscriptionItem[]; remainders: SubscriptionItem[]; fetchedAt: string }> {
  "use cache";
  cacheLife({ stale: 3600, revalidate: 86400, expire: 86400 * 2 });
  const cond = { "HSSPLY_ADRES::LIKE": area, "RCRIT_PBLANC_DE::GTE": since };
  const [apt, rem] = await Promise.all([
    odcloudAll("/ApplyhomeInfoDetailSvc/v1/getAPTLttotPblancDetail", cond),
    odcloudAll("/ApplyhomeInfoDetailSvc/v1/getRemndrLttotPblancDetail", cond),
  ]);
  return { items: apt.map(toSubscriptionItem), remainders: rem.map(toSubscriptionItem), fetchedAt: today() };
}

/** 단지 하나의 주택형별 분양가 · 경쟁률 */
export async function subscriptionDetail(id: string, pblanc: string): Promise<{ models: ModelRow[]; competition: CompetitionRow[]; fetchedAt: string }> {
  "use cache";
  cacheLife({ stale: 3600, revalidate: 86400, expire: 86400 * 2 });
  const cond = { "HOUSE_MANAGE_NO::EQ": id, "PBLANC_NO::EQ": pblanc };
  const [models, comp] = await Promise.all([
    odcloudAll("/ApplyhomeInfoDetailSvc/v1/getAPTLttotPblancMdl", cond),
    odcloudAll("/ApplyhomeInfoCmpetRtSvc/v1/getAPTLttotPblancCmpet", cond),
  ]);
  return { models: models.map(toModelRow), competition: comp.map(toCompetitionRow), fetchedAt: today() };
}

/**
 * 라우트 공통 오류 응답 — 메시지만 돌려준다.
 * 캐시 경계를 지나면 클래스가 바뀔 수 있어 status 필드로 판별한다. 키 문자열은 한 번 더 지운다.
 */
export function errorResponse(e: unknown): Response {
  const k = process.env.DATA_GO_KR_KEY;
  const scrub = (s: string) => (k ? s.split(k).join("***") : s);
  if (e && typeof e === "object" && "message" in e && "status" in e && typeof (e as { status: unknown }).status === "number") {
    const err = e as { message: string; status: number };
    return Response.json({ error: scrub(err.message) }, { status: err.status });
  }
  const msg = e instanceof Error ? scrub(e.message) : "서버 처리 중 오류가 발생했습니다";
  return Response.json({ error: msg }, { status: 500 });
}

/** 지역 이름 입력 검사 — 한글 · 숫자 · 공백만, 40자 이내 */
export function checkArea(area: string | null): string {
  const a = (area ?? "").replace(/\s+/g, " ").trim();
  if (!a || a.length > 40 || !/^[가-힣0-9 ]+$/.test(a)) throw new PublicDataError("사업대상지 이름을 확인하세요 (예: 부산광역시 해운대구)", 400);
  return a;
}

/** 계약년월 입력 검사 — YYYYMM */
export function checkYm(ym: string | null): string {
  if (!ym || !/^\d{6}$/.test(ym)) throw new PublicDataError("ym은 YYYYMM 형식이어야 합니다", 400);
  return ym;
}
