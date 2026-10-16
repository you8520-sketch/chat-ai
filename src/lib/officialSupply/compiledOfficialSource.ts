import fs from "node:fs";
import path from "node:path";

import { renderRuntimeAppearanceBlock } from "@/lib/officialSupply/appearance";
import {
  compileOfficialDraftFromBible,
  type OfficialCharacterBible,
  type OfficialWorldBible,
} from "@/lib/officialSupply/bible";
import { composeOfficialSystemPrompt } from "@/lib/officialSupply/characterText";
import {
  assertWolfgangApprovedLocks,
  isWolfgangInPlaceSource,
  wolfgangApprovedPersistedSourcePath,
} from "@/lib/officialSupply/inPlaceWolfgang";
import { attachOfficialCharacterLorebooks } from "@/lib/officialSupply/lorebookAttach";
import { OfficialSupplyGateError } from "@/lib/officialSupply/store";
import type {
  OfficialAppearanceLock,
  OfficialCharacterDraft,
  OfficialWorldLorebookEntry,
} from "@/lib/officialSupply/types";

const DEFAULT_PILOT_DIR = path.join(process.cwd(), "src/lib/officialSupply/pilot");

/**
 * The pilot manuscript directory. Tests may point it at a frozen copy (for example the
 * previously approved Wolfgang manuscript) to exercise sync mechanics against a pinned
 * Text Lock; the override is ignored outside the Node test runner.
 */
function pilotDir(): string {
  const override = process.env.NODE_TEST_CONTEXT != null ? process.env.OFFICIAL_SUPPLY_PILOT_DIR?.trim() : "";
  return override || DEFAULT_PILOT_DIR;
}

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

function testPilotDirOverride(): string {
  return process.env.NODE_TEST_CONTEXT != null ? process.env.OFFICIAL_SUPPLY_PILOT_DIR?.trim() ?? "" : "";
}

function wolfgangCharacterFilePath(draftKey: string): string {
  const override = testPilotDirOverride();
  if (override) return path.join(override, "characters", `${draftKey}.json`);

  const persisted = wolfgangApprovedPersistedSourcePath();
  if (fs.existsSync(persisted)) return persisted;

  if (process.env.NODE_TEST_CONTEXT != null) {
    return path.join(DEFAULT_PILOT_DIR, "characters", `${draftKey}.json`);
  }

  throw new OfficialSupplyGateError(
    "approved_source_missing",
    `approved Wolfgang source is missing at ${persisted}; refusing to use the public repo sheet`
  );
}

export function loadOfficialPilotWorldBible(): OfficialWorldBible {
  return readJson<{ bible: OfficialWorldBible }>(path.join(pilotDir(), "world-bible.json")).bible;
}

export function officialAppearanceBlockForDraft(
  _draft: Pick<OfficialCharacterDraft, "promptStandard">,
  appearance: OfficialAppearanceLock
): string {
  return renderRuntimeAppearanceBlock(appearance);
}

export function loadCompiledOfficialCharacterSource(draftKey: string): {
  draftKey: string;
  worldKey: string;
  worldBible: OfficialWorldBible;
  draft: OfficialCharacterDraft;
  appearanceLock: OfficialAppearanceLock;
  appearanceBlock: string;
  systemPrompt: string;
  sharedLorebook: OfficialWorldLorebookEntry[];
  characterLorebook: OfficialWorldLorebookEntry[];
  resolvedLorebook: OfficialWorldLorebookEntry[];
} {
  const manifest = readJson<{ worldKey: string; styleKey: string }>(path.join(pilotDir(), "manifest.json"));
  const world = readJson<{ bible: OfficialWorldBible }>(path.join(pilotDir(), "world-bible.json"));
  const characterPath = isWolfgangInPlaceSource(draftKey)
    ? wolfgangCharacterFilePath(draftKey)
    : path.join(pilotDir(), "characters", `${draftKey}.json`);
  const file = readJson<PilotCharacterFile>(characterPath);
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
    worldBible: world.bible,
    hook: {
      archetype: brief.archetype,
      relationshipTrope: brief.relationshipTrope,
      occupation: brief.occupation,
      rpHook: brief.rpHook,
    },
  });
  if (!file.appearance) throw new Error(`official source ${draftKey} is missing appearance lock`);
  const loadedPersistedWolfgang =
    isWolfgangInPlaceSource(draftKey) &&
    !testPilotDirOverride() &&
    path.resolve(characterPath) === path.resolve(wolfgangApprovedPersistedSourcePath());
  if (loadedPersistedWolfgang) {
    assertWolfgangApprovedLocks({ draft, appearanceLock: file.appearance });
  }
  const sharedLorebook = world.bible.lorebook;
  const resolvedLorebook = attachOfficialCharacterLorebooks({
    shared: sharedLorebook,
    characterLocal: file.characterLorebook ?? [],
    otherRelationships: file.bible.otherRelationships ?? [],
    ownerKey: file.draftKey,
  });
  const characterLorebook = resolvedLorebook.filter(
    (entry) => !sharedLorebook.some((shared) => shared.entryKey === entry.entryKey)
  );
  const appearanceBlock = officialAppearanceBlockForDraft(draft, file.appearance);
  return {
    draftKey,
    worldKey: manifest.worldKey,
    worldBible: world.bible,
    draft,
    appearanceLock: file.appearance,
    appearanceBlock,
    systemPrompt: composeOfficialSystemPrompt(draft, appearanceBlock),
    sharedLorebook,
    characterLorebook,
    resolvedLorebook,
  };
}
