import { NextRequest, NextResponse } from "next/server";
import { validBBox } from "@/lib/geo";
import { getStates } from "@/server/opensky";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const bbox = {
    lamin: Number(params.get("lamin")),
    lomin: Number(params.get("lomin")),
    lamax: Number(params.get("lamax")),
    lomax: Number(params.get("lomax")),
  };
  const problem = validBBox(bbox);
  if (problem) {
    return NextResponse.json({ message: problem }, { status: 400 });
  }

  const payload = await getStates(bbox);
  return NextResponse.json(payload, {
    headers: { "Cache-Control": "no-store" },
  });
}
