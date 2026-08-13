import { NextResponse } from "next/server";
import { loadTrpgCatalog } from "@/lib/trpg/catalog";
import { requireTrpgApi, trpgFail } from "@/lib/trpg/requireApi";

export async function GET() {
  const gate = await requireTrpgApi();
  if ("error" in gate) return gate.error;
  try {
    return NextResponse.json(loadTrpgCatalog(gate.db, gate.user.id));
  } catch (e) {
    return trpgFail(e);
  }
}
