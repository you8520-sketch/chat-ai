import { hashSectionText } from "@/lib/promptSectionFingerprint";
import { buildCompactTerminalLayoutRecencyLine } from "@/lib/webnovelOutputFormat";
import type { TrackedPromptSection } from "@/services/promptAudit";

const LAYOUT_SECTION_IDS = new Set(["rule-output-layout-recency"]);

export type LayoutAbParityReport = {
  allNonLayoutSectionHashesEqual: boolean;
  aSystemLayoutHash: string | null;
  bSystemLayoutHash: string | null;
  aUserTailHash: string;
  bUserTailHash: string;
  nonLayoutHashMismatches: string[];
};

function extractUserTailLayoutHash(userTurnContent: string): string {
  const layoutLine = buildCompactTerminalLayoutRecencyLine();
  const normalizedTurn = userTurnContent.trim();
  const hasLayout = normalizedTurn.includes(layoutLine.trim().slice(0, 20));
  return hashSectionText(hasLayout ? layoutLine : normalizedTurn.slice(-120));
}

export function compareLayoutAbPayloadParity(opts: {
  sectionsA: TrackedPromptSection[];
  sectionsB: TrackedPromptSection[];
  userTurnA: string;
  userTurnB: string;
}): LayoutAbParityReport {
  const mapA = new Map(
    opts.sectionsA
      .filter((s) => !LAYOUT_SECTION_IDS.has(s.id))
      .map((s) => [s.id, hashSectionText(s.text)])
  );
  const mapB = new Map(
    opts.sectionsB
      .filter((s) => !LAYOUT_SECTION_IDS.has(s.id))
      .map((s) => [s.id, hashSectionText(s.text)])
  );

  const mismatches: string[] = [];
  for (const [id, hashA] of mapA) {
    const hashB = mapB.get(id);
    if (hashB == null) {
      mismatches.push(`${id}: missing-in-B`);
      continue;
    }
    if (hashA !== hashB) mismatches.push(`${id}: ${hashA}≠${hashB}`);
  }
  for (const id of mapB.keys()) {
    if (!mapA.has(id)) mismatches.push(`${id}: extra-in-B`);
  }

  const aLayout = opts.sectionsA.find((s) => s.id === "rule-output-layout-recency");
  const bLayout = opts.sectionsB.find((s) => s.id === "rule-output-layout-recency");

  return {
    allNonLayoutSectionHashesEqual: mismatches.length === 0,
    aSystemLayoutHash: aLayout ? hashSectionText(aLayout.text) : null,
    bSystemLayoutHash: bLayout ? hashSectionText(bLayout.text) : null,
    aUserTailHash: extractUserTailLayoutHash(opts.userTurnA),
    bUserTailHash: extractUserTailLayoutHash(opts.userTurnB),
    nonLayoutHashMismatches: mismatches,
  };
}
