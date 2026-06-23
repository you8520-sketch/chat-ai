import { parseTableRowCells } from "./formatSpec";
import type { StatusMeta } from "./types";

const PLACEHOLDER_TIME = /^🕒\s*00:00$/;
const PLACEHOLDER_LOCATION = /^🏠\s*00$/;

/** Pull clock/place anchors from legacy fields or filled tableMarkdown cells */
export function extractTimeLocationAnchors(meta: StatusMeta): {
  datetime: string;
  location: string;
} {
  let datetime = meta.datetime?.trim() ?? "";
  let location = meta.location?.trim() ?? "";

  if (meta.tableMarkdown?.trim()) {
    for (const line of meta.tableMarkdown.split("\n")) {
      if (!line.trim().startsWith("|")) continue;
      for (const cell of parseTableRowCells(line)) {
        const t = cell.trim();
        if (!t) continue;
        if (/🕒/.test(t) && !PLACEHOLDER_TIME.test(t)) {
          datetime = t.replace(/^🕒\s*/, "").trim() || datetime;
        } else if (/🏠/.test(t) && !PLACEHOLDER_LOCATION.test(t)) {
          location = t.replace(/^🏠\s*/, "").trim() || location;
        }
      }
    }
  }

  return { datetime, location };
}

/** Flash-only user block section — explicit prior-turn clock anchor for TIMEKEEPER */
export function formatPreviousTurnStatusContext(meta: StatusMeta | null | undefined): string {
  if (!meta) {
    return `[PREVIOUS TURN STATUS META]
(none — first status window in this chat; infer an opening in-scene time from narrative only)`;
  }

  const { datetime, location } = extractTimeLocationAnchors(meta);
  const lines: string[] = ["[PREVIOUS TURN STATUS META]"];

  if (datetime) {
    lines.push(
      `Previous datetime — STARTING CLOCK for this turn's TIMEKEEPER calculation: ${datetime}`
    );
  } else {
    lines.push(
      "Previous datetime: (not recorded — infer baseline from narrative, then apply TIMEKEEPER progression)"
    );
  }

  if (location) {
    lines.push(`Previous location: ${location}`);
  }

  if (meta.tableMarkdown?.trim()) {
    lines.push("", "Previous status table:", meta.tableMarkdown.trim());
  } else {
    const payload = { ...meta };
    if (Object.values(payload).some((v) => typeof v === "string" && v.trim())) {
      lines.push("", "Previous status fields:", JSON.stringify(payload));
    }
  }

  return lines.join("\n");
}
