import fs from "node:fs";
import path from "node:path";

import {
  compileOfficialDraftFromBible,
  type OfficialCharacterBible,
  type OfficialWorldBible,
} from "@/lib/officialSupply/bible";
import type { PortfolioBriefInput } from "@/lib/officialSupply/authorPrompts";
import type { OfficialCharacterDraft } from "@/lib/officialSupply/types";

const PILOT_DIR = path.join(process.cwd(), "src/lib/officialSupply/pilot");
export const RELATION_START_BRIEFS_FILE = path.join(PILOT_DIR, "fixtures/relation-start-candidate-briefs.json");
export const RELATION_START_CANDIDATES_FILE = path.join(PILOT_DIR, "fixtures/relation-start-candidates.generated.json");

export type RelationStartCandidateBrief = { key: string; brief: PortfolioBriefInput };

export type RelationStartCandidate = {
  key: string;
  brief: PortfolioBriefInput;
  bible: OfficialCharacterBible;
  attempts: number;
  bibleQaErrors: string[];
  draftQaErrors: string[];
};

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

export function loadRelationStartWorld(): { world: OfficialWorldBible; worldKey: string; styleKey: string } {
  const briefs = readJson<{ worldKey: string }>(RELATION_START_BRIEFS_FILE);
  const world = readJson<{ bible: OfficialWorldBible }>(path.join(PILOT_DIR, "world-bible.json")).bible;
  const manifest = readJson<{ styleKey: string }>(path.join(PILOT_DIR, "manifest.json"));
  return { world, worldKey: briefs.worldKey, styleKey: manifest.styleKey };
}

export function loadRelationStartBriefs(): RelationStartCandidateBrief[] {
  return readJson<{ candidates: RelationStartCandidateBrief[] }>(RELATION_START_BRIEFS_FILE).candidates;
}

export function loadRelationStartCandidates(): RelationStartCandidate[] {
  return readJson<{ candidates: RelationStartCandidate[] }>(RELATION_START_CANDIDATES_FILE).candidates;
}

/** The same compile call the generator and the pilot use, so QA and review see one manuscript. */
export function compileRelationStartDraft(candidate: Pick<RelationStartCandidate, "key" | "brief" | "bible">): OfficialCharacterDraft {
  const { world, worldKey, styleKey } = loadRelationStartWorld();
  return compileOfficialDraftFromBible(candidate.bible, {
    draftKey: candidate.key,
    worldKey,
    styleKey,
    genres: ["로맨스 판타지"],
    audience: candidate.brief.audience,
    worldName: world.name,
    worldBible: world,
    hook: {
      archetype: candidate.brief.archetype,
      relationshipTrope: candidate.brief.relationshipTrope,
      occupation: candidate.brief.occupation,
      rpHook: candidate.brief.rpHook,
    },
  });
}
