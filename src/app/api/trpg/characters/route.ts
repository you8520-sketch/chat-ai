import { NextResponse } from "next/server";
import { parseTrpgCharacterSearchScope, searchTrpgCharacters } from "@/lib/trpg/characterSearch";
import { requireTrpgApi, trpgFail } from "@/lib/trpg/requireApi";

export async function GET(req: Request) {
  const gate = await requireTrpgApi();
  if ("error" in gate) return gate.error;
  try {
    const url = new URL(req.url);
    const characters = searchTrpgCharacters(gate.db, {
      viewerUserId: gate.user.id,
      scope: parseTrpgCharacterSearchScope(url.searchParams.get("scope")),
      query: url.searchParams.get("q") ?? "",
    });
    return NextResponse.json({ characters });
  } catch (e) {
    return trpgFail(e);
  }
}
