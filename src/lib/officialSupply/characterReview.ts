/**
 * Read-only official-character review dump.
 * Assembles authoring source, stored snapshot, and staged compiler output.
 * This is not the chat `buildContext` / provider payload.
 */
import fs from "node:fs";
import path from "node:path";

import { compileOfficialDraftFromBible, type OfficialCharacterBible } from "@/lib/officialSupply/bible";
import { composeOfficialSystemPrompt } from "@/lib/officialSupply/characterText";
import {
  renderAppearanceBlock,
  renderRuntimeAppearanceBlock,
} from "@/lib/officialSupply/appearance";
import { resolveOfficialCharacterLorebooks } from "@/lib/officialSupply/lorebookAttach";
import { composeOfficialCreatorComment } from "@/lib/officialSupply/publicProfileText";
import type {
  OfficialAppearanceLock,
  OfficialCharacterDraft,
  OfficialWorldLorebookEntry,
} from "@/lib/officialSupply/types";

export const LUCIAN_REVIEW_RELATIVE_PATH = "docs/official-supply/reviews/pilot-rf-03-lucian.md";
export const LUCIAN_REVIEW_REPRODUCE =
  "npm run official-supply:review-character -- pilot-rf-03 docs/official-supply/reviews/pilot-rf-03-lucian.md";

type PilotCharFile = {
  draftKey: string;
  brief: {
    archetype: string;
    relationshipTrope: string;
    occupation: string;
    rpHook: string;
    audience: OfficialCharacterDraft["audience"];
  };
  bible: OfficialCharacterBible;
  characterLorebook?: OfficialWorldLorebookEntry[];
  appearance: OfficialAppearanceLock;
  draft?: OfficialCharacterDraft;
};

const PILOT_DIR = path.join(process.cwd(), "src/lib/officialSupply/pilot");

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function loadPilotCharacter(draftKey: string): PilotCharFile {
  const dir = path.join(PILOT_DIR, "characters");
  for (const name of fs.readdirSync(dir).filter((v) => v.endsWith(".json"))) {
    const file = readJson<PilotCharFile>(path.join(dir, name));
    if (file.draftKey === draftKey) return file;
  }
  throw new Error(`official pilot character not found: ${draftKey}`);
}

function fieldMatch(label: string, stored: string | readonly string[] | undefined, live: string | readonly string[]): string {
  const left = Array.isArray(stored) ? stored.join("\n") : stored ?? "";
  const right = Array.isArray(live) ? live.join("\n") : live;
  return `- ${label}: ${left === right ? "MATCH" : "DRIFT"}`;
}

function lorebookBlock(title: string, entries: readonly OfficialWorldLorebookEntry[]): string[] {
  return [
    title,
    ...entries.flatMap((entry) => [
      `### ${entry.name} [${entry.entryKey}]`,
      `keywords: ${entry.keywords.join(" / ")}`,
      entry.content,
      "",
    ]),
  ];
}

export function buildOfficialCharacterReviewReport(draftKey = "pilot-rf-03"): string {
  const file = loadPilotCharacter(draftKey);
  const manifest = readJson<{ worldKey: string; styleKey: string; genre: string }>(
    path.join(PILOT_DIR, "manifest.json")
  );
  const world = readJson<{
    bible: {
      name: string;
      lorebook: OfficialWorldLorebookEntry[];
    };
  }>(path.join(PILOT_DIR, "world-bible.json"));

  const draft = compileOfficialDraftFromBible(file.bible, {
    draftKey: file.draftKey,
    worldKey: manifest.worldKey,
    styleKey: manifest.styleKey,
    genres: [manifest.genre] as OfficialCharacterDraft["genres"],
    audience: file.brief.audience,
    worldName: world.bible.name,
    hook: {
      archetype: file.brief.archetype,
      relationshipTrope: file.brief.relationshipTrope,
      occupation: file.brief.occupation,
      rpHook: file.brief.rpHook,
    },
  });

  const runtimeAppearance = renderRuntimeAppearanceBlock(file.appearance);
  const fullVisualAppearance = renderAppearanceBlock(file.appearance);
  const systemPrompt = composeOfficialSystemPrompt(draft, runtimeAppearance);
  const creatorComment = composeOfficialCreatorComment(draft);
  const resolvedLorebook = resolveOfficialCharacterLorebooks(world.bible.lorebook, file.characterLorebook);
  const approvedLocal = file.characterLorebook ?? [];
  const sharedKeys = new Set(world.bible.lorebook.map((entry) => entry.entryKey));
  const reusedKeys = approvedLocal.filter((entry) => sharedKeys.has(entry.entryKey)).map((entry) => entry.entryKey);
  const extraKeys = approvedLocal.filter((entry) => !sharedKeys.has(entry.entryKey)).map((entry) => entry.entryKey);
  const stored = file.draft;

  return [
    `# Official character review — ${draft.name} (${draft.draftKey})`,
    "",
    "## REPRODUCTION",
    "This markdown is the exact output of the official review compiler. Do not hand-edit.",
    "",
    "```",
    LUCIAN_REVIEW_REPRODUCE,
    "```",
    "",
    "## LAYER MAP",
    "- AUTHORING SOURCE: bible, appearance lock, characterLorebook, otherRelationships in the pilot fixture.",
    "- STORED SNAPSHOT: the `draft` object persisted in the same fixture after the last official compile.",
    "- COMPILED STAGED FORM: live `compileOfficialDraftFromBible` + public-text owners + `composeOfficialSystemPrompt`. This is the official-supply staging payload, not a hand rewrite.",
    "- NOT IN THIS DUMP: chat `buildContext`, provider messages, turn-time lorebook keyword activation. Those paths are not executed here.",
    "",
    "## SENSITIVITY",
    "The hosting repository is public. This dump contains fictional character-known secrets that already exist in the official pilot fixture. It must not contain user PII or operations credentials.",
    "",
    "## AUTHORING SOURCE — PUBLIC PROFILE",
    file.bible.publicProfile.description,
    "",
    "## AUTHORING SOURCE — CREATOR-FACING TAGLINE",
    file.bible.publicProfile.tagline,
    "",
    "## AUTHORING SOURCE — GREETING",
    file.bible.greeting,
    "",
    "## AUTHORING SOURCE — WORLD / PERSONAL / USER ENTRY",
    ["worldContext:", file.bible.situation.worldContext, "", "personalSituation:", file.bible.situation.personalSituation, "", "userEntry:", file.bible.situation.userEntry].join("\n"),
    "",
    "## AUTHORING SOURCE — SPEECH EXAMPLES",
    file.bible.speech.examples,
    "",
    "## AUTHORING SOURCE — CHARACTER-KNOWN SECRETS",
    ...(file.bible.secrets.length ? file.bible.secrets.map((secret) => `- ${secret}`) : ["(none)"]),
    "",
    "## STORED SNAPSHOT vs LIVE COMPILE",
    stored
      ? [
          fieldMatch("characterCore", stored.sections.characterCore, draft.sections.characterCore),
          fieldMatch("relationshipsAndDrives", stored.sections.relationshipsAndDrives, draft.sections.relationshipsAndDrives),
          fieldMatch("worldAndSituation", stored.sections.worldAndSituation, draft.sections.worldAndSituation),
          fieldMatch("secrets", stored.secrets, draft.secrets),
          fieldMatch("description", stored.description, draft.description),
          fieldMatch("greeting", stored.greeting, draft.greeting),
        ].join("\n")
      : "- stored draft: ABSENT",
    "",
    "## PUBLIC DESCRIPTION",
    draft.description,
    "",
    "## CREATOR COMMENT",
    creatorComment,
    "",
    "## GREETING",
    draft.greeting,
    "",
    "## WORLD / START SITUATION",
    draft.sections.worldAndSituation,
    "",
    "## SYSTEM PROMPT — ACTUAL STAGED FORM",
    systemPrompt,
    "",
    ...lorebookBlock(
      "## SHARED WORLD LOREBOOK — COMMON OWNER, NOT DUPLICATED INTO COMPACT SYSTEM PROMPT",
      world.bible.lorebook
    ),
    ...lorebookBlock(
      "## CHARACTER-LOCAL LOREBOOK CANDIDATES — APPROVED TEXT, SHARED KEY REUSES WORLD OWNER",
      approvedLocal
    ),
    ...lorebookBlock("## RESOLVED LOREBOOK — ACTUAL ATTACH SET", resolvedLorebook),
    "## LOREBOOK DIFF — APPROVED LOCAL vs RESOLVED ATTACH",
    `- shared owner reused, approved local not attached: ${reusedKeys.join(", ") || "(none)"}`,
    `- character-local extras attached: ${extraKeys.join(", ") || "(none)"}`,
    `- resolved entryKeys: ${resolvedLorebook.map((entry) => entry.entryKey).join(", ")}`,
    "",
    "## SPEECH PERSONALITY",
    draft.speech.personality,
    "",
    "## SPEECH TRAITS",
    draft.speech.traits,
    "",
    "## SPEECH EXAMPLES",
    draft.speech.examples,
    "",
    "## SPEECH FORBIDDEN",
    draft.speech.forbidden,
    "",
    "## CHARACTER-KNOWN SECRETS",
    ...(draft.secrets.length ? draft.secrets.map((secret) => `- ${secret}`) : ["(none)"]),
    "",
    "## OTHER PLAYABLE-CHARACTER RELATIONSHIP CANDIDATES — NOT ALWAYS-ON PROMPT",
    ...(file.bible.otherRelationships.length
      ? file.bible.otherRelationships.map((rel) => `- ${rel.target}: ${rel.public}`)
      : ["(none)"]),
    "",
    "## RUNTIME APPEARANCE — COMPACT",
    runtimeAppearance,
    "",
    "## VISUAL APPEARANCE LOCK — IMAGE/IDENTITY OWNER, NOT CHARACTER CORE",
    fullVisualAppearance,
    "",
  ].join("\n");
}
