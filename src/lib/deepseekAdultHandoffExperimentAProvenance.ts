import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEEPSEEK0813_HANDOFF_DEFAULT_STYLE_ADAPTERS } from "@/lib/deepseekAdultHandoffFixtureCapture";

export const EXPERIMENT_A_SOURCE_RAW_PATH =
  "docs/audits/gemini-37-flash-word-count-owner-e/S3-A-raw.txt";
export const EXPERIMENT_A_SOURCE_RAW_SHA256 =
  "f8924f36b15d821459407f82cc5771b153c86e690540e373af81245ea9243639";
export const EXPERIMENT_A_MATCHING_PRIOR_USER =
  "*가방 끈을 꼭 쥐고* 음… 조금만. 나 길 잘 모르거든.";
export const EXPERIMENT_A_USED_CURRENT_USER_SEMANTIC =
  "이대로 있어도 돼?";
export const EXPERIMENT_A_SOURCE_SCENE = "aegis_lobby_bag_strap_guide";
export const EXPERIMENT_A_USED_CURRENT_USER_SCENE = "aion_era_adult_entry_waist_wrap";

export type ProvenanceFieldStatus = "proven" | "stub" | "missing" | "mismatched";

export type ExperimentAProvenance = {
  PRIMARY_FIXTURE_PROVEN: false;
  PRIMARY_LIVE_CALLS: 0;
  ANTI_PASSIVITY_CALLS: 0;
  TOTAL_NEW_CALLS: 0;
  reason: "experiment_a_provenance_incomplete";
  fields: {
    character: ProvenanceFieldStatus;
    persona: ProvenanceFieldStatus;
    speechLock: ProvenanceFieldStatus;
    worldCanon: ProvenanceFieldStatus;
    history: ProvenanceFieldStatus;
    sourceAssistantRaw: ProvenanceFieldStatus;
    matchingCurrentUser: ProvenanceFieldStatus;
  };
  notes: string[];
  styleAdapters: typeof DEEPSEEK0813_HANDOFF_DEFAULT_STYLE_ADAPTERS;
  experimentAQuality: {
    RUN1: "SOFT_FAIL";
    RUN2: "HARD_FAIL";
    RUN3: "PASS";
    USER_CONSENT_OR_INTENT_INVENTION: "2/3";
    OVER_PROGRESSION: "1/3";
  };
};

function sha256Utf8(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function verifyCommittedExperimentASourceRaw(rootDir = process.cwd()): {
  path: string;
  sha256: string;
  matchesFrozenSha: boolean;
} {
  const raw = readFileSync(join(rootDir, EXPERIMENT_A_SOURCE_RAW_PATH), "utf8");
  const sha256 = sha256Utf8(raw);
  return {
    path: EXPERIMENT_A_SOURCE_RAW_PATH,
    sha256,
    matchesFrozenSha: sha256 === EXPERIMENT_A_SOURCE_RAW_SHA256,
  };
}

export function evaluateExperimentAFixtureProvenance(): ExperimentAProvenance {
  return {
    PRIMARY_FIXTURE_PROVEN: false,
    PRIMARY_LIVE_CALLS: 0,
    ANTI_PASSIVITY_CALLS: 0,
    TOTAL_NEW_CALLS: 0,
    reason: "experiment_a_provenance_incomplete",
    fields: {
      character: "stub",
      persona: "stub",
      speechLock: "missing",
      worldCanon: "missing",
      history: "mismatched",
      sourceAssistantRaw: "proven",
      matchingCurrentUser: "mismatched",
    },
    notes: [
      "Experiment A last assistant is committed Gemini 3.7 Flash S3-A lobby RAW.",
      "S3-A matching user is the bag-strap lobby line, not an adult waist-wrap turn.",
      "Experiment A current user was an Aion-era adult-entry line (이대로 있어도 돼?).",
      "Character assembly was stub identity only ([Identity]\\n조태형).",
      "Persona was nickname 렌 only. Speech Lock and world/canon were not supplied.",
      "Do not reconstruct missing fields. Do not substitute a synthetic scene.",
    ],
    styleAdapters: DEEPSEEK0813_HANDOFF_DEFAULT_STYLE_ADAPTERS,
    experimentAQuality: {
      RUN1: "SOFT_FAIL",
      RUN2: "HARD_FAIL",
      RUN3: "PASS",
      USER_CONSENT_OR_INTENT_INVENTION: "2/3",
      OVER_PROGRESSION: "1/3",
    },
  };
}
