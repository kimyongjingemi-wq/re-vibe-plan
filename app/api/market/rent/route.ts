import { checkArea, checkYm, errorResponse, rentMonth, resolveRegion } from "@/lib/public-data";

/** GET /api/market/rent?area=&ym= — 아파트 전월세 실거래 한 달치 */
export async function GET(request: Request) {
  try {
    const sp = new URL(request.url).searchParams;
    const area = checkArea(sp.get("area"));
    const ym = checkYm(sp.get("ym"));
    const region = await resolveRegion(area);
    const r = await rentMonth(region.code5, ym);
    return Response.json({ area: region.name, ym, ...r });
  } catch (e) {
    return errorResponse(e);
  }
}
