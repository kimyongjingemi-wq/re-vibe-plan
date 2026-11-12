import { PublicDataError, errorResponse, subscriptionDetail } from "@/lib/public-data";

/** GET /api/market/subscription/detail?id=&pblanc= — 주택형별 분양가(분양최고금액) · 경쟁률 */
export async function GET(request: Request) {
  try {
    const sp = new URL(request.url).searchParams;
    const id = sp.get("id") ?? "";
    const pblanc = sp.get("pblanc") ?? "";
    if (!/^\d{1,20}$/.test(id) || !/^\d{1,20}$/.test(pblanc)) throw new PublicDataError("id · pblanc는 숫자여야 합니다", 400);
    const r = await subscriptionDetail(id, pblanc);
    return Response.json({ id, pblanc, ...r });
  } catch (e) {
    return errorResponse(e);
  }
}
