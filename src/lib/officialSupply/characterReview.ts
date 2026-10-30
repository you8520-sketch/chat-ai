/**
 * Read-only official-character review dump.
 * Assembles authoring source, stored snapshot, and staged compiler output.
 * This is not the chat `buildContext` / provider payload.
 */
import fs from "node:fs";
import path from "node:path";

import { compileOfficialDraftFromBible, type OfficialCharacterBible, type OfficialWorldBible } from "@/lib/officialSupply/bible";
import { composeOfficialSystemPrompt } from "@/lib/officialSupply/characterText";
import {
  renderAppearanceBlock,
  renderRuntimeAppearanceBlock,
} from "@/lib/officialSupply/appearance";
import {
  attachOfficialCharacterLorebooks,
  projectOtherRelationshipsToCharacterLorebook,
} from "@/lib/officialSupply/lorebookAttach";
import { composeOfficialCreatorComment } from "@/lib/officialSupply/publicProfileText";
import type {
  OfficialAppearanceLock,
  OfficialCharacterDraft,
  OfficialWorldLorebookEntry,
} from "@/lib/officialSupply/types";

export const LUCIAN_REVIEW_RELATIVE_PATH = "docs/official-supply/reviews/pilot-rf-03-lucian.md";
export const WOLFGANG_REVIEW_RELATIVE_PATH = "docs/official-supply/reviews/pilot-rf-02-wolfgang.md";

export function officialCharacterReviewRelativePath(draftKey: string): string {
  if (draftKey === "pilot-rf-03") return LUCIAN_REVIEW_RELATIVE_PATH;
  if (draftKey === "pilot-rf-02") return WOLFGANG_REVIEW_RELATIVE_PATH;
  return `docs/official-supply/reviews/${draftKey}.md`;
}

export function officialCharacterReviewReproduce(
  draftKey: string,
  outputPath = officialCharacterReviewRelativePath(draftKey)
): string {
  return `npm run official-supply:review-character -- ${draftKey} ${outputPath}`;
}

export const LUCIAN_REVIEW_REPRODUCE = officialCharacterReviewReproduce("pilot-rf-03");

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
  appearance?: OfficialAppearanceLock;
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

/** Evidence, never a semantic verdict or a canon rewrite. Rebuilt from the current source. */
export function buildOfficialCanonReviewEvidence(bible: OfficialCharacterBible, draft: OfficialCharacterDraft) {
  const sources = {
    identity: bible.identity,
    personality: bible.personality,
    values: bible.values,
    worldContext: bible.situation.worldContext,
    backstory: bible.backstory.events,
    abilities: bible.abilities,
    currentSituation: bible.situation,
    selfDrive: bible.rpEngine.selfDrive ?? null,
    behaviorRules: bible.behaviorRules,
    secrets: bible.secrets,
    publicProfile: bible.publicProfile,
    greeting: bible.greeting,
  };
  // Only exact preservation is mechanically testable. Paraphrase, causal grounding,
  // attribution and contradictory truth claims remain explicit editorial questions.
  const checks = bible.behaviorRules.flatMap((rule, index) =>
    rule.split(/(?<=[.!?。！？])\s+/u).filter(Boolean).map(text => ({
      sourcePath: `behaviorRules[${index}]`, text,
      compiledPath: "speech.traits",
      preservation: draft.speech.traits.includes(text) ? "EXACT_PRESENT" : "REVIEW_REQUIRED",
    }))
  );
  return {
    status: "REQUIRES_GPT_REVIEW" as const,
    semanticVerdict: null,
    sources,
    compiled: {
      sharedWorld: draft.sections.worldAndSituation,
      characterCore: draft.sections.characterCore,
      currentSituation: draft.sections.currentSituation ?? draft.sections.worldAndSituation,
      selfDrive: draft.sections.relationshipsAndDrives,
      speechTraits: draft.speech.traits,
      description: draft.description,
      creatorComment: composeOfficialCreatorComment(draft),
      greeting: draft.greeting,
      secrets: draft.secrets,
    },
    preservationChecks: checks,
    unresolved: [
      { topic: "canon_provenance", status: "REQUIRES_GPT_REVIEW", question: "관찰된 사실 / 인물의 주장 / 미확정 비밀 / 확정 canon을 원문별로 구분하고 서로 충돌하는지 검수. 서명·인장의 실재와 진위, 인물의 부인은 같은 명제가 아니다." },
      { topic: "self_drive_grounding", status: bible.rpEngine.selfDrive ? "REQUIRES_GPT_REVIEW" : "MISSING_SOURCE", question: "goal·ownMove·setback이 과거의 선택, 현재 사건, 능력의 한계·대가에 근거하는가? 이름을 바꿔도 성립하는 목표인가?" },
      { topic: "independent_facts", status: "REQUIRES_GPT_REVIEW", question: "중복 제거·재작성 전후 독립 행동 원칙과 사실이 남았는가? EXACT_PRESENT는 의미 정합성 승인이나 중복 제거 허가가 아니다." },
      { topic: "public_scene_agency", status: "REQUIRES_GPT_REVIEW", question: "공개 소개·코멘트·greeting이 같은 시작 상황이며 가능한 행동 2~3개를 제안하는가? 유저 감정·선택·결말, 비밀의 정답을 확정하지 않는가?" },
    ],
  };
}

export function buildOfficialCharacterReviewReport(
  draftKey = "pilot-rf-03",
  outputPath = officialCharacterReviewRelativePath(draftKey)
): string {
  const file = loadPilotCharacter(draftKey);
  const manifest = readJson<{ worldKey: string; styleKey: string; genre: string }>(
    path.join(PILOT_DIR, "manifest.json")
  );
  const world = readJson<{
    bible: OfficialWorldBible;
  }>(path.join(PILOT_DIR, "world-bible.json"));

  const draft = compileOfficialDraftFromBible(file.bible, {
    draftKey: file.draftKey,
    worldKey: manifest.worldKey,
    styleKey: manifest.styleKey,
    genres: [manifest.genre] as OfficialCharacterDraft["genres"],
    audience: file.brief.audience,
    worldName: world.bible.name,
    worldBible: world.bible,
    hook: {
      archetype: file.brief.archetype,
      relationshipTrope: file.brief.relationshipTrope,
      occupation: file.brief.occupation,
      rpHook: file.brief.rpHook,
    },
  });

  const runtimeAppearance = file.appearance ? renderRuntimeAppearanceBlock(file.appearance) : "";
  const fullVisualAppearance = file.appearance ? renderAppearanceBlock(file.appearance) : "(appearance lock not authored; narrative review only)";
  const systemPrompt = composeOfficialSystemPrompt(draft, runtimeAppearance);
  const creatorComment = composeOfficialCreatorComment(draft);
  const approvedLocal = file.characterLorebook ?? [];
  const relationshipLorebook = projectOtherRelationshipsToCharacterLorebook(
    file.bible.otherRelationships ?? [],
    file.draftKey
  );
  const resolvedLorebook = attachOfficialCharacterLorebooks({
    shared: world.bible.lorebook,
    characterLocal: approvedLocal,
    otherRelationships: file.bible.otherRelationships ?? [],
    ownerKey: file.draftKey,
  });
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
    officialCharacterReviewReproduce(draftKey, outputPath),
    "```",
    "",
    "## LAYER MAP",
    "- AUTHORING SOURCE: bible, appearance lock, characterLorebook, otherRelationships in the pilot fixture.",
    "- STORED SNAPSHOT: the `draft` object persisted in the same fixture after the last official compile.",
    "- COMPILED STAGED FORM: live `compileOfficialDraftFromBible` + public-text owners + `composeOfficialSystemPrompt`. This is the official-supply staging payload, not a hand rewrite.",
    "- CAST RELATIONSHIP LOREBOOK: public otherRelationships project into character-local keyword lorebooks. hidden stays LOCKED_SECRET.",
    "- NOT IN THIS DUMP: chat `buildContext`, provider messages, live keyword-match execution. Projected entries below are the attach set those keywords would activate.",
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
          fieldMatch("currentSituation", stored.sections.currentSituation ?? "", draft.sections.currentSituation ?? ""),
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
    "## SHARED WORLD — CANONICAL ETHERNOS OWNER",
    draft.sections.worldAndSituation,
    "",
    "## LOCAL CURRENT SITUATION — CHARACTER OWNER, NOT WORLD",
    draft.sections.currentSituation ?? "(none)",
    "",
    "## SYSTEM PROMPT — ACTUAL STAGED FORM",
    systemPrompt,
    "",
    ...lorebookBlock(
      "## SHARED WORLD LOREBOOK — COMMON OWNER, NOT DUPLICATED INTO COMPACT SYSTEM PROMPT",
      world.bible.lorebook
    ),
    ...lorebookBlock(
      "## CHARACTER-LOCAL LOREBOOK — DISTINCT KEYS, SHARED WORLD OWNER PRESERVED",
      approvedLocal
    ),
    ...lorebookBlock(
      "## CAST RELATIONSHIP LOREBOOK — NAME-TRIGGERED, NOT ALWAYS-ON",
      relationshipLorebook
    ),
    ...lorebookBlock("## RESOLVED LOREBOOK — ACTUAL ATTACH SET", resolvedLorebook),
    "## LOREBOOK DIFF — APPROVED LOCAL vs RESOLVED ATTACH",
    `- approved local keys: ${approvedLocal.map((entry) => entry.entryKey).join(", ") || "(none)"}`,
    `- attached as authored local bodies: ${extraKeys.join(", ") || "(none)"} (${extraKeys.length} of ${approvedLocal.length})`,
    reusedKeys.length ? `- SHARED-KEY COLLISION requires review: ${reusedKeys.join(", ")} — shared owner supersedes local candidate.` : "- SHARED-KEY COLLISION: none; all approved character-local bodies are attached under distinct entryKeys.",
    `- resolved entryKeys: ${resolvedLorebook.map((entry) => entry.entryKey).join(", ")}`,
    ...reusedKeys.flatMap((key) => {
      const approved = approvedLocal.find((entry) => entry.entryKey === key);
      const shared = world.bible.lorebook.find((entry) => entry.entryKey === key);
      const resolved = resolvedLorebook.find((entry) => entry.entryKey === key);
      const missingKeywords = (approved?.keywords ?? []).filter((word) => !(shared?.keywords ?? []).includes(word));
      return [
        `### OWNER CHOICE DETAIL — ${key}`,
        `approved local keywords: ${(approved?.keywords ?? []).join(" / ")}`,
        `shared/resolved keywords: ${(resolved?.keywords ?? shared?.keywords ?? []).join(" / ")}`,
        `creator-approved keywords absent from shared owner: ${missingKeywords.join(" / ") || "(none)"}`,
        "approved local body:",
        approved?.content ?? "(missing)",
        "shared owner body actually attached:",
        resolved?.content ?? shared?.content ?? "(missing)",
        "",
      ];
    }),
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
    "## CANON / INFORMATION PRESERVATION — UNRESOLVED EDITORIAL EVIDENCE",
    "This is not automatic semantic approval. Source wording is preserved; no claim is promoted to fact.",
    "```json",
    JSON.stringify(buildOfficialCanonReviewEvidence(file.bible, draft), null, 2),
    "```",
    "",
  ].join("\n");
}
