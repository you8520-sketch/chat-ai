import fs from "node:fs";
import path from "node:path";

import {
  renderAppearanceBlock,
  renderRuntimeAppearanceBlock,
} from "@/lib/officialSupply/appearance";
import {
  compileOfficialDraftFromBible,
  type OfficialCharacterBible,
  type OfficialWorldBible,
} from "@/lib/officialSupply/bible";
import { composeOfficialSystemPrompt } from "@/lib/officialSupply/characterText";
import { resolveOfficialCharacterLorebooks } from "@/lib/officialSupply/lorebookAttach";
import type {
  OfficialAppearanceLock,
  OfficialCharacterDraft,
  OfficialWorldLorebookEntry,
} from "@/lib/officialSupply/types";

const PILOT_DIR = path.join(process.cwd(), "src/lib/officialSupply/pilot");

type PilotCharacterFile = {
  slot: number;
  draftKey: string;
  bible: OfficialCharacterBible;
  characterLorebook?: OfficialWorldLorebookEntry[];
  appearance?: OfficialAppearanceLock;
  brief: {
    audience: "all" | "female" | "male";
    archetype: string;
    relationshipTrope: string;
    occupation: string;
    rpHook: string;
  };
};

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

export function officialAppearanceBlockForDraft(
  draft: Pick<OfficialCharacterDraft, "promptStandard">,
  appearance: OfficialAppearanceLock
): string {
  return draft.promptStandard === "compact_rp_v1"
    ? renderRuntimeAppearanceBlock(appearance)
    : renderAppearanceBlock(appearance);
}

export function loadCompiledOfficialCharacterSource(draftKey: string): {
  draftKey: string;
  worldKey: string;
  draft: OfficialCharacterDraft;
  appearanceLock: OfficialAppearanceLock;
  appearanceBlock: string;
  systemPrompt: string;
  sharedLorebook: OfficialWorldLorebookEntry[];
  characterLorebook: OfficialWorldLorebookEntry[];
  resolvedLorebook: OfficialWorldLorebookEntry[];
} {
  const manifest = readJson<{ worldKey: string; styleKey: string }>(path.join(PILOT_DIR, "manifest.json"));
  const world = readJson<{ bible: OfficialWorldBible }>(path.join(PILOT_DIR, "world-bible.json"));
  const file = readJson<PilotCharacterFile>(path.join(PILOT_DIR, "characters", `${draftKey}.json`));
  if (file.draftKey !== draftKey) {
    throw new Error(`official source draftKey mismatch: ${file.draftKey} != ${draftKey}`);
  }
  const brief = world.bible.portfolio.find((item) => item.slot === file.slot);
  if (!brief) throw new Error(`official source missing world portfolio slot ${file.slot}`);
  const draft = compileOfficialDraftFromBible(file.bible, {
    draftKey: file.draftKey,
    worldKey: manifest.worldKey,
    styleKey: manifest.styleKey,
    genres: ["로맨스 판타지"],
    audience: file.brief.audience,
    worldName: world.bible.name,
    hook: {
      archetype: brief.archetype,
      relationshipTrope: brief.relationshipTrope,
      occupation: brief.occupation,
      rpHook: brief.rpHook,
    },
  });
  if (!file.appearance) throw new Error(`official source ${draftKey} is missing appearance lock`);
  const sharedLorebook = world.bible.lorebook;
  const characterLorebook = file.characterLorebook ?? [];
  const appearanceBlock = officialAppearanceBlockForDraft(draft, file.appearance);
  return {
    draftKey,
    worldKey: manifest.worldKey,
    draft,
    appearanceLock: file.appearance,
    appearanceBlock,
    systemPrompt: composeOfficialSystemPrompt(draft, appearanceBlock),
    sharedLorebook,
    characterLorebook,
    resolvedLorebook: resolveOfficialCharacterLorebooks(sharedLorebook, characterLorebook),
  };
}
