import { checkArea, errorResponse, resolveRegion, subscriptions } from "@/lib/public-data";

/** 오늘에서 3년 전 날짜 YYYY-MM-DD */
function threeYearsAgo(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 3);
  return d.toISOString().slice(0, 10);
}

/** GET /api/market/subscription?area= — 공급위치 LIKE 지역명 · 최근 3년 APT 분양 공고 + 잔여세대 공고 */
export async function GET(request: Request) {
  try {
    const area = checkArea(new URL(request.url).searchParams.get("area"));
    const region = await resolveRegion(area); // 지역 이름이 실제 시군구인지 서버에서 확인
    const since = threeYearsAgo();
    const r = await subscriptions(region.name, since);
    return Response.json({ area: region.name, since, ...r });
  } catch (e) {
    return errorResponse(e);
  }
}
