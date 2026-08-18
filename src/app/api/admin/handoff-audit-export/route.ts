import { NextResponse } from "next/server";

import {
  authorizeHandoffAuditExport,
  exportProductionHandoffAuditSnapshot,
  isHandoffAuditExportEnabled,
  parseHandoffAuditExportMode,
  resolveHandoffAuditAdminPersonaCandidates,
  resolveHandoffAuditCharacterCandidates,
  snapshotPublicLogLine,
  writeHandoffAuditSnapshotPrivate,
  type HandoffAuditExportMode,
} from "@/lib/handoffAuditExport";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function deny(): NextResponse {
  return NextResponse.json({ error: "handoff audit export denied" }, { status: 403 });
}

function handleMode(mode: HandoffAuditExportMode, url: URL): NextResponse {
  switch (mode) {
    case "resolve-character": {
      const name = url.searchParams.get("name") ?? "";
      if (!name.trim()) {
        return NextResponse.json({ error: "name is required" }, { status: 400 });
      }
      const candidates = resolveHandoffAuditCharacterCandidates(name);
      console.log(
        `[handoff-audit-export] mode=resolve-character name_chars=${name.trim().length} matches=${candidates.length}`
      );
      return NextResponse.json({
        ok: true,
        mode,
        candidates,
      });
    }
    case "resolve-admin-personas": {
      const candidates = resolveHandoffAuditAdminPersonaCandidates();
      console.log(`[handoff-audit-export] mode=resolve-admin-personas matches=${candidates.length}`);
      return NextResponse.json({
        ok: true,
        mode,
        candidates,
      });
    }
    case "snapshot": {
      const characterId = Number(url.searchParams.get("characterId") ?? "");
      const personaId = Number(url.searchParams.get("personaId") ?? "");
      if (!Number.isInteger(characterId) || characterId <= 0) {
        return NextResponse.json({ error: "characterId is required" }, { status: 400 });
      }
      if (!Number.isInteger(personaId) || personaId <= 0) {
        return NextResponse.json({ error: "personaId is required" }, { status: 400 });
      }
      try {
        const snapshot = exportProductionHandoffAuditSnapshot({ characterId, personaId });
        console.log(snapshotPublicLogLine(snapshot));
        const persist = url.searchParams.get("persist") === "1";
        const privateDir = persist ? writeHandoffAuditSnapshotPrivate(snapshot) : null;
        return NextResponse.json({
          ok: true,
          mode,
          snapshot,
          privateDir,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "export failed";
        const status = /not found|loader miss|not an admin/i.test(message) ? 404 : 500;
        return NextResponse.json({ error: message }, { status });
      }
    }
    default: {
      const _exhaustive: never = mode;
      return NextResponse.json({ error: `unhandled mode: ${String(_exhaustive)}` }, { status: 400 });
    }
  }
}

export async function GET(req: Request) {
  if (!isHandoffAuditExportEnabled() || !authorizeHandoffAuditExport(req)) {
    return deny();
  }

  const url = new URL(req.url);
  const mode = parseHandoffAuditExportMode(url.searchParams.get("mode"));
  if (!mode) {
    return NextResponse.json({ error: "unknown mode" }, { status: 400 });
  }
  return handleMode(mode, url);
}
