import fs from "node:fs";
import path from "node:path";

import { compileOfficialDraftFromBible, type OfficialCharacterBible } from "@/lib/officialSupply/bible";
import {
  composeOfficialSystemPrompt,
} from "@/lib/officialSupply/characterText";
import {
  renderAppearanceBlock,
  renderRuntimeAppearanceBlock,
} from "@/lib/officialSupply/appearance";
import { composeOfficialCreatorComment } from "@/lib/officialSupply/publicProfileText";
import type {
  OfficialAppearanceLock,
  OfficialCharacterDraft,
} from "@/lib/officialSupply/types";

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
  appearance: OfficialAppearanceLock;
};

const ROOT = path.join(process.cwd(), "src/lib/officialSupply/pilot");

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function loadPilotCharacter(draftKey: string): PilotCharFile {
  const dir = path.join(ROOT, "characters");
  for (const name of fs.readdirSync(dir).filter((v) => v.endsWith(".json"))) {
    const file = readJson<PilotCharFile>(path.join(dir, name));
    if (file.draftKey === draftKey) return file;
  }
  throw new Error(`official pilot character not found: ${draftKey}`);
}

const draftKey = process.argv[2]?.trim() || process.env.OFFICIAL_REVIEW_DRAFT_KEY?.trim() || "pilot-rf-03";
const outputPath = process.argv[3]?.trim() || process.env.OFFICIAL_REVIEW_OUTPUT_PATH?.trim() || "";
const draftJsonPath = process.env.OFFICIAL_REVIEW_DRAFT_JSON_PATH?.trim() || "";

const file = loadPilotCharacter(draftKey);
const manifest = readJson<{ worldKey: string; styleKey: string; genre: string }>(path.join(ROOT, "manifest.json"));
const world = readJson<{
  bible: {
    name: string;
    lorebook: Array<{ entryKey: string; name: string; keywords: string[]; content: string }>;
  };
}>(path.join(ROOT, "world-bible.json"));

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

const report = [
  `# Official character review — ${draft.name} (${draft.draftKey})`,
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
  "## SHARED WORLD LOREBOOK — APPROVED OWNER, NOT DUPLICATED INTO COMPACT SYSTEM PROMPT",
  ...world.bible.lorebook.map((entry) => `- ${entry.name} [${entry.entryKey}] — ${entry.keywords.join(" / ")}`),
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

if (draftJsonPath) {
  fs.mkdirSync(path.dirname(draftJsonPath), { recursive: true });
  fs.writeFileSync(draftJsonPath, JSON.stringify(draft, null, 2) + "\n", "utf8");
}
if (outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, report, "utf8");
  console.log(outputPath);
  if (draftJsonPath) console.log(draftJsonPath);
} else {
  process.stdout.write(report);
}
