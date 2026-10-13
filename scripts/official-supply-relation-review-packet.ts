/**
 * Renders the GPT review packet for the relation-start (bible V2) candidates from the
 * committed generated fixture. No provider call: it compiles, saves through the real form
 * path in an isolated temp DB, and measures the final RP system prompt.
 *
 *   node --conditions=react-server --import tsx scripts/official-supply-relation-review-packet.ts \
 *     [--baseline=<earlier generated json>]
 */
import fs from "node:fs";
import path from "node:path";
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

import type { OfficialCharacterBible } from "@/lib/officialSupply/bible";
import {
  compileRelationStartDraft,
  loadRelationStartCandidates,
  RELATION_START_CANDIDATES_FILE,
  type RelationStartCandidate,
} from "@/lib/officialSupply/relationStartCandidates";
import { buildRelationStartWire } from "@/lib/officialSupply/relationStartWire";
import type { OfficialCharacterDraft } from "@/lib/officialSupply/types";
import { getDb } from "@/lib/db";
import { installIsolatedTestDatabase, uninstallIsolatedTestDatabase } from "@/lib/test/isolatedTestDatabase";
import { estimateTokens } from "@/lib/tokenEstimate";

const REVIEW_DIR = path.join(process.cwd(), "docs/official-supply/reviews");
const PACKET_FILE = path.join(REVIEW_DIR, "relation-start-v2-packet.md");
const MANUSCRIPT_FILE = path.join(REVIEW_DIR, "relation-start-v2-manuscripts.md");
const KRW_PER_USD = 1500;
const SHINGLE = 8;

const squash = (text: string): string => text.replace(/\s+/g, "");

function shingles(text: string): Set<string> {
  const flat = squash(text);
  const out = new Set<string>();
  for (let i = 0; i + SHINGLE <= flat.length; i += 1) out.add(flat.slice(i, i + SHINGLE));
  return out;
}

/** Share of the source's 8-char shingles that reappear in `others` (0..1). */
function overlapShare(source: string, others: string): number {
  const own = shingles(source);
  if (own.size === 0) return 0;
  const rest = shingles(others);
  let hit = 0;
  for (const piece of own) if (rest.has(piece)) hit += 1;
  return hit / own.size;
}

function manuscriptTokens(draft: OfficialCharacterDraft): number {
  const parts = [
    draft.description,
    draft.greeting,
    draft.speech.description,
    draft.speech.examples,
    draft.speech.forbidden,
    ...Object.values(draft.sections),
  ];
  return parts.filter((p): p is string => typeof p === "string").reduce((sum, p) => sum + estimateTokens(p), 0);
}

/** RP-wire setting text (what the model reads) with the fixedFacts line itself removed. */
function settingTextWithoutFixed(draft: OfficialCharacterDraft, fixed: string): string {
  const text = [draft.sections.currentSituation ?? "", draft.sections.relationshipsAndDrives].join("\n");
  return fixed ? text.split(fixed).join("") : text;
}

function withoutV2(bible: OfficialCharacterBible): OfficialCharacterBible {
  const { type: _type, fixedFacts: _fixed, userDecides: _decides, ...relation } = bible.userRelationship;
  const { selfDrive: _selfDrive, ...engine } = bible.rpEngine;
  return { ...bible, userRelationship: relation, rpEngine: engine };
}

function canonBlock(systemPrompt: string): string {
  const start = systemPrompt.indexOf("<WORLD_LORE>");
  const end = systemPrompt.indexOf("</WORLD_LORE>");
  return start >= 0 && end > start ? systemPrompt.slice(start, end + "</WORLD_LORE>".length) : systemPrompt;
}

function endStop(text: string): string {
  return text.trim().replace(/[.!?。！？]+$/u, "");
}

type Row = {
  key: string;
  type: string;
  attempts: number;
  manuscriptTokens: number;
  finalPromptTokens: number;
  relationshipsLegacyTokens: number;
  relationshipsV2Tokens: number;
  fixedOnce: boolean | null;
  decidesOnce: boolean | null;
  driveOnce: boolean;
  fixedOverlapInSetting: number | null;
  overlapBaseline: number | null;
  overflowChars: number;
};

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

function readBaseline(file: string | undefined): Map<string, RelationStartCandidate> {
  if (!file) return new Map();
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { candidates: RelationStartCandidate[] };
  return new Map(parsed.candidates.map((c) => [c.key, c]));
}

async function main(): Promise<void> {
  const baselineArg = process.argv.slice(2).find((a) => a.startsWith("--baseline="));
  const baseline = readBaseline(baselineArg?.split("=")[1]);
  const generated = JSON.parse(fs.readFileSync(RELATION_START_CANDIDATES_FILE, "utf8")) as {
    runs?: { cost?: { billedCostUsd?: number; physicalAttempts?: number; inputTokens?: number; outputTokens?: number } }[];
    cost?: { billedCostUsd?: number; physicalAttempts?: number; inputTokens?: number; outputTokens?: number };
  };
  const runs = generated.runs ?? (generated.cost ? [{ cost: generated.cost }] : []);
  const costUsd = runs.reduce((sum, r) => sum + (r.cost?.billedCostUsd ?? 0), 0);
  const calls = runs.reduce((sum, r) => sum + (r.cost?.physicalAttempts ?? 0), 0);

  installIsolatedTestDatabase();
  const rows: Row[] = [];
  const manuscripts: string[] = ["# Relation-start V2: generated manuscripts and final RP prompts", "", "Generated by `scripts/official-supply-relation-review-packet.ts` from `pilot/fixtures/relation-start-candidates.generated.json`. Raw author output compiled by `compileOfficialDraftFromBible`; nothing is hand-edited.", ""];
  try {
    for (const candidate of loadRelationStartCandidates()) {
      getDb().exec("DELETE FROM character_lorebook_attachments; DELETE FROM characters; DELETE FROM worlds; DELETE FROM users WHERE email LIKE '%@site-managed.invalid';");
      const draft = compileRelationStartDraft(candidate);
      const wire = await buildRelationStartWire(candidate, draft);
      const prompt = squash(wire.systemPrompt);
      const rel = candidate.bible.userRelationship;
      const drive = candidate.bible.rpEngine.selfDrive;
      const legacy = compileRelationStartDraft({ ...candidate, bible: withoutV2(candidate.bible) });
      const fixed = rel.fixedFacts?.trim() ?? "";
      const decides = rel.userDecides?.trim() ?? "";
      const before = baseline.get(candidate.key);
      const beforeDraft = before ? compileRelationStartDraft(before) : null;
      const beforeFixed = before?.bible.userRelationship.fixedFacts?.trim() ?? "";
      rows.push({
        key: candidate.key,
        type: rel.type ?? "legacy",
        attempts: candidate.attempts,
        manuscriptTokens: manuscriptTokens(draft),
        finalPromptTokens: estimateTokens(wire.systemPrompt),
        relationshipsLegacyTokens: estimateTokens(legacy.sections.relationshipsAndDrives),
        relationshipsV2Tokens: estimateTokens(draft.sections.relationshipsAndDrives),
        fixedOnce: fixed ? occurrences(prompt, squash(fixed)) === 1 : null,
        decidesOnce: decides ? occurrences(prompt, squash(decides)) === 1 : null,
        driveOnce: drive
          ? [drive.goal, drive.ownMove, drive.setback].every((t) => occurrences(prompt, squash(endStop(t))) === 1)
          : false,
        fixedOverlapInSetting: fixed ? overlapShare(fixed, settingTextWithoutFixed(draft, fixed)) : null,
        overlapBaseline: beforeDraft && beforeFixed ? overlapShare(beforeFixed, settingTextWithoutFixed(beforeDraft, beforeFixed)) : null,
        overflowChars: wire.settingOverflowChars,
      });
      manuscripts.push(
        `## ${candidate.key} (${rel.type}) — ${draft.name}`,
        "",
        `Author attempts used: ${candidate.attempts}. Bible QA errors: ${candidate.bibleQaErrors.length}. Draft QA errors: ${candidate.draftQaErrors.length}.`,
        "",
        "### Public intro (draft.description)",
        "",
        draft.description,
        "",
        `### Greeting\n\n${draft.greeting}`,
        "",
        "### Final RP prompt: character canon block (production buildContext, appearance block excluded)",
        "",
        `The shared RP rules around this block are the unchanged common prompt (total final system prompt: ${estimateTokens(wire.systemPrompt)} tokens). The block below contains the compiled characterCore, currentSituation and relationshipsAndDrives exactly as the model reads them.`,
        "",
        "```text",
        canonBlock(wire.systemPrompt),
        "```",
        ""
      );
    }
  } finally {
    uninstallIsolatedTestDatabase();
  }

  fs.mkdirSync(REVIEW_DIR, { recursive: true });
  fs.writeFileSync(MANUSCRIPT_FILE, `${manuscripts.join("\n")}\n`, "utf8");

  const pct = (value: number | null): string => (value == null ? "-" : `${Math.round(value * 100)}%`);
  const tableRows = rows.map(
    (r) =>
      `| ${r.key} | ${r.type} | ${r.attempts} | ${r.manuscriptTokens} | ${r.finalPromptTokens} | ${r.relationshipsLegacyTokens} -> ${r.relationshipsV2Tokens} (+${r.relationshipsV2Tokens - r.relationshipsLegacyTokens}) | ${r.fixedOnce ?? "-"} / ${r.decidesOnce ?? "-"} / ${r.driveOnce} | ${pct(r.overlapBaseline)} -> ${pct(r.fixedOverlapInSetting)} | ${r.overflowChars} |`
  );
  const packet = [
    "# Relation-start V2 (19-item checklist + start types): measured packet",
    "",
    "Generated by `scripts/official-supply-relation-review-packet.ts`; token = `estimateTokens` (0.9 x chars), the repository estimator.",
    "",
    "## Cost record (paid author calls)",
    "",
    `- Model gpt-6-luna: ${calls} physical calls in ${runs.length} runs recorded in the fixture, billed $${costUsd.toFixed(4)} (about ${Math.round(costUsd * KRW_PER_USD)} KRW at ${KRW_PER_USD} KRW/USD).`,
    "- Not in the fixture ledger: the first 9-call generation (billed $0.0075, overwritten by the next run, whose prompts predate the final edits) and one aborted run that stopped on a voice-call shape error. Conservative grand total is below $0.06 (under 90 KRW).",
    "- Pre-run estimate: expected 57 KRW, worst case 431 KRW (3 attempts x 3 candidates x 3 calls), below the 1,000 KRW approval line.",
    "",
    "## Measured per candidate",
    "",
    "| candidate | type | author attempts | manuscript tokens | final RP prompt tokens | relationshipsAndDrives tokens legacy -> V2 | fixedFacts / userDecides / selfDrive reach final prompt exactly once | fixedFacts 8-gram overlap with the rest of the RP setting (currentSituation + relationshipsAndDrives; first generation -> final) | RP setting overflow chars |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...tableRows,
    "",
    "Manuscript tokens count the public intro, greeting, speech and every compiled section. The final prompt is the production `buildContext` system prompt after the form-save path (appearance block excluded; it is the later image-lock owner).",
    "",
    "Full texts: `relation-start-v2-manuscripts.md`.",
    "",
    "## Author prompt tokens (one-time authoring cost, not RP runtime)",
    "",
    "Measured with `estimateTokens` over the six first-attempt prompts (part1, voice, bonds; system + user) for the three briefs, `main@3b553c6c` vs this branch. These are static measurements, not regenerated by this script.",
    "",
    "| candidate | main | this branch | delta |",
    "| --- | --- | --- | --- |",
    "| free | 7,118 | 8,591 | +1,473 |",
    "| role_bound | 7,116 | 8,841 | +1,725 |",
    "| relationship_bound | 7,163 | 8,994 | +1,831 |",
    "",
    "System prompts: part1 1,317 -> 1,992 (checklist + gap rules), voice 1,764 -> 1,857, bonds 1,519 -> 1,927. The bonds user prompt sends only the planned type's rule (the other two types are not sent).",
    "",
    "## Rules kept, merged, deleted",
    "",
    "- Kept: persona-flexible default (`기본은 persona-flexible`), action-based progression, no automatic love, 0 secrets / 0 NPCs valid, no cast auto-fill, adult sections unchanged, FREE principle string byte-identical for legacy bibles.",
    "- Merged: five old `userRelationship` author lines became one default line + two shared lines + one per-type rule sent only for the planned type; `progression` and `rpEngine` lines were merged into the checklist rules instead of adding parallel sentences.",
    "- Deleted: the old per-bible `opening 자체가 특정 관계를 핵심 전제로 삼을 때만 최소 관계를 고정` line (replaced by the explicit type), the fixed 3-slot `progression` skeleton (now 2-4 action conditions).",
    "- Added (only true gaps): `userRelationship.type / fixedFacts / userDecides`, `rpEngine.selfDrive {goal, ownMove, setback}`, defense behavior inside `fears`, non-verbal habits inside `habits`, and one QA rule that bans shared RP directives (output length, memory, auto-progression, per-turn monologue) inside the character setting. `mediumConflict` is the unresolved-conflict seed and `longTermChange` the growth/fall possibility; no new field.",
    "",
    "## STOP / FOLLOW-UP",
    "",
    "- No production DB write, no re-publish of existing characters, no Text Lock replacement (the Lucian #50 and Wolfgang #51 Text Lock hashes are asserted unchanged), no auto-publish, no follower notification. #1589 (ownership, lorebook, asset storage, CP) is out of scope.",
    "- Author model reliability: roughly 11 of 17 workflow attempts needed a retry. The only run whose reasons were logged (the last role_bound run) failed on the model omitting whole sections (habits/situation, or `publicProfile`) and on the existing adult-term substring check matching ordinary words (`음부` across a word boundary, `보지` in `보지 않은`); earlier runs did not log reasons, so a V2-contract contribution to the other retries is not ruled out. The generator now logs QA reasons per attempt. Reducing the retry rate is a FOLLOW-UP (candidate: per-call missing-section repair; detector word-boundary fix), not part of this PR.",
    "- GPT review of the three raw manuscripts is the next gate. Cursor assigns no literary score.",
    "",
  ].join("\n");
  fs.writeFileSync(PACKET_FILE, packet, "utf8");
  console.log(JSON.stringify({ packet: path.relative(process.cwd(), PACKET_FILE), manuscripts: path.relative(process.cwd(), MANUSCRIPT_FILE), rows }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
