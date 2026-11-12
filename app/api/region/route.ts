import { checkArea, errorResponse, findRegion } from "@/lib/public-data";

/** GET /api/region?q=부산광역시 해운대구 — 법정동코드 API로 시군구 후보를 돌려준다 */
export async function GET(request: Request) {
  try {
    const q = checkArea(new URL(request.url).searchParams.get("q"));
    const { candidates, fetchedAt } = await findRegion(q);
    return Response.json({ q, candidates, fetchedAt });
  } catch (e) {
    return errorResponse(e);
  }
}
