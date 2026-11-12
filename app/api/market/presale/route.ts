import { checkArea, checkYm, errorResponse, presaleMonth, resolveRegion } from "@/lib/public-data";

/** GET /api/market/presale?area=&ym= — 분양권전매 실거래 한 달치(해제 제외) */
export async function GET(request: Request) {
  try {
    const sp = new URL(request.url).searchParams;
    const area = checkArea(sp.get("area"));
    const ym = checkYm(sp.get("ym"));
    const region = await resolveRegion(area);
    const r = await presaleMonth(region.code5, ym);
    return Response.json({ area: region.name, ym, ...r });
  } catch (e) {
    return errorResponse(e);
  }
}
