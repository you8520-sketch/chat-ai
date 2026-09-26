import { OfficialSupplyGateError } from "@/lib/officialSupply/store";
import type { AdultConsentMode, AdultDialogueProfile } from "@/lib/adultSceneRouting";
import type { PortfolioBriefInput } from "@/lib/officialSupply/authorPrompts";
import {
  qaResult,
  type OfficialCharacterDraft,
  type OfficialSupportingNpc,
  type OfficialWorldLorebookEntry,
  type QaIssue,
  type QaResult,
} from "@/lib/officialSupply/types";

/**
 * Authoring bibles — production-time source, never runtime data.
 *
 * `OfficialWorldBible` / `OfficialCharacterBible` are the structured
 * authoring source (FIXED SKELETON + VARIABLE CONTENT DENSITY).
 * `compileOfficialDraftFromBible` is the single canonical compiler into the
 * pipeline representation (`OfficialCharacterDraft`); the prompt sections
 * never inject raw bible JSON into runtime prompts.
 *
 * Knowledge visibility: only COMMON compiles into the shared lorebook.
 * FACTION / CHARACTER_LOCAL / AUTHOR_ONLY never leave the bible, and other
 * characters' `hidden` opinions compile into local secrets only.
 */

// ── World bible ──────────────────────────────────────────────────────────────

export type WorldFaction = {
  name: string;
  purpose: string;
  leadership: string;
  means: string;
  relations: string;
  publicView: string;
};

export type WorldLocation = { name: string; purpose: string; mood: string; users: string; rpEvents: string };
export type WorldHistoryEvent = { event: string; impact: string };

export type OfficialWorldBible = {
  name: string;
  genre: string;
  subgenre: string;
  tone: string;
  era: string;
  techLevel: string;
  regions: string;
  societyForm: string;
  premise: string;
  centralPremise: string;
  situation: {
    biggestEvent: string;
    beneficiaries: string;
    threatened: string;
    upcomingChange: string;
  };
  factions: WorldFaction[];
  powerSystem: {
    capabilities: string;
    users: string;
    acquisition: string;
    ranks: string;
    limits: string;
    costs: string;
    socialImpact: string;
    taboos: string;
  };
  society: Record<string, string>;
  culture: { name: string; detail: string }[];
  locations: WorldLocation[];
  history: WorldHistoryEvent[];
  knowledge: {
    common: string[];
    faction: string[];
    characterLocal: string[];
    authorOnly: string[];
  };
  userEntry: { allowedRoles: string[]; note: string };
  lorebook: OfficialWorldLorebookEntry[];
  portfolio: PortfolioBriefInput[];
};

export const WORLD_BIBLE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    name: { type: "string" },
    genre: { type: "string" },
    subgenre: { type: "string" },
    tone: { type: "string" },
    era: { type: "string" },
    techLevel: { type: "string" },
    regions: { type: "string" },
    societyForm: { type: "string" },
    premise: { type: "string" },
    centralPremise: { type: "string" },
    situation: {
      type: "object",
      properties: {
        biggestEvent: { type: "string" },
        beneficiaries: { type: "string" },
        threatened: { type: "string" },
        upcomingChange: { type: "string" },
      },
    },
    factions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          purpose: { type: "string" },
          leadership: { type: "string" },
          means: { type: "string" },
          relations: { type: "string" },
          publicView: { type: "string" },
        },
      },
    },
    powerSystem: {
      type: "object",
      properties: {
        capabilities: { type: "string" },
        users: { type: "string" },
        acquisition: { type: "string" },
        ranks: { type: "string" },
        limits: { type: "string" },
        costs: { type: "string" },
        socialImpact: { type: "string" },
        taboos: { type: "string" },
      },
    },
    society: { type: "object" },
    culture: {
      type: "array",
      items: {
        type: "object",
        properties: { name: { type: "string" }, detail: { type: "string" } },
      },
    },
    locations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          purpose: { type: "string" },
          mood: { type: "string" },
          users: { type: "string" },
          rpEvents: { type: "string" },
        },
      },
    },
    history: {
      type: "array",
      items: {
        type: "object",
        properties: { event: { type: "string" }, impact: { type: "string" } },
      },
    },
    knowledge: {
      type: "object",
      properties: {
        common: { type: "array", items: { type: "string" } },
        faction: { type: "array", items: { type: "string" } },
        characterLocal: { type: "array", items: { type: "string" } },
        authorOnly: { type: "array", items: { type: "string" } },
      },
    },
    userEntry: {
      type: "object",
      properties: {
        allowedRoles: { type: "array", items: { type: "string" } },
        note: { type: "string" },
      },
    },
    lorebook: {
      type: "array",
      items: {
        type: "object",
        properties: {
          entryKey: { type: "string" },
          name: { type: "string" },
          keywords: { type: "array", items: { type: "string" } },
          content: { type: "string" },
        },
      },
    },
    portfolio: {
      type: "array",
      items: {
        type: "object",
        properties: {
          slot: { type: "number" },
          name: { type: "string" },
          gender: { type: "string" },
          age: { type: "number" },
          archetype: { type: "string" },
          relationshipTrope: { type: "string" },
          occupation: { type: "string" },
          faction: { type: "string" },
          socialPosition: { type: "string" },
          personalityCore: { type: "string" },
          visualSilhouette: { type: "string" },
          rpHook: { type: "string" },
          adultCandidate: { type: "boolean" },
          speechDirection: { type: "string" },
          audience: { type: "string" },
        },
      },
    },
  },
};

// ── Character bible ──────────────────────────────────────────────────────────

export type BibleAbility = {
  name: string;
  scope: string;
  level: string;
  limit: string;
  cost: string;
  usage: string;
};

export type BibleSpeech = {
  register: string;
  sentenceLength: string;
  tempo: string;
  vocabulary: string;
  frequentPhrases: string[];
  rarePhrases: string[];
  profanity: string;
  humorStyle: string;
  addressStyle: string;
  hiddenEmotionStyle: string;
  angryStyle: string;
  intimateStyle: string;
  keywords: string[];
  description: string;
  examples: string;
  forbidden: string;
};

export type BibleAdultSection = {
  orientation: string;
  hookSummary: string;
  dialogueProfile: string;
  consentModes: string[];
  tone: string;
  preferenceKeywords: string[];
  boundaries: string[];
  consentBehavior: string;
  scenarioExamples: string[];
};

export type OfficialCharacterBible = {
  identity: {
    name: string;
    gender: string;
    age: number;
    apparentAge: string;
    heightCm: number;
    species: string;
    occupation: string;
    socialPosition: string;
    affiliation: string;
    worldRole: string;
  };
  appearance: {
    faceShape: string;
    eyes: string;
    eyeColor: string;
    hairColor: string;
    hairstyle: string;
    hairLength: string;
    skin: string;
    build: string;
    musculature: string;
    distinguishingFeatures: string;
    usualExpression: string;
    defaultOutfit: string;
    accessories: string;
    impression: string;
  };
  personality: { keywords: string[]; behavioral: string };
  contradiction: string;
  values: { desires: string[]; fears: string[]; coreValues: string[]; nonNegotiable: string[] };
  backstory: { events: { event: string; choice: string; residue: string }[] };
  abilities: BibleAbility[];
  habits: { hobbies: string[]; habits: string[]; likes: string[]; dislikes: string[] };
  dailyLife: string;
  situation: { worldContext: string; personalSituation: string; userEntry: string };
  speech: BibleSpeech;
  behaviorRules: string[];
  userRelationship: {
    initialView: string;
    userRole: string;
    startingPoint: string;
    progression: string[];
  };
  otherRelationships: { target: string; public: string; privateOpinion: string; hidden: string }[];
  secrets: string[];
  rpEngine: {
    immediateHook: string;
    repeatable: string[];
    mediumConflict: string;
    longTermChange: string;
  };
  greeting: string;
  publicProfile: { tagline: string; description: string; tags: string[] };
  npcs: OfficialSupportingNpc[];
  nsfw: boolean;
  adultSection: BibleAdultSection | null;
};

export const CHARACTER_BIBLE_1_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    identity: {
      type: "object",
      properties: {
        name: { type: "string" },
        gender: { type: "string" },
        age: { type: "number" },
        apparentAge: { type: "string" },
        heightCm: { type: "number" },
        species: { type: "string" },
        occupation: { type: "string" },
        socialPosition: { type: "string" },
        affiliation: { type: "string" },
        worldRole: { type: "string" },
      },
    },
    appearance: {
      type: "object",
      properties: {
        faceShape: { type: "string" },
        eyes: { type: "string" },
        eyeColor: { type: "string" },
        hairColor: { type: "string" },
        hairstyle: { type: "string" },
        hairLength: { type: "string" },
        skin: { type: "string" },
        build: { type: "string" },
        musculature: { type: "string" },
        distinguishingFeatures: { type: "string" },
        usualExpression: { type: "string" },
        defaultOutfit: { type: "string" },
        accessories: { type: "string" },
        impression: { type: "string" },
      },
    },
    personality: {
      type: "object",
      properties: {
        keywords: { type: "array", items: { type: "string" } },
        behavioral: { type: "string" },
      },
    },
    contradiction: { type: "string" },
    values: {
      type: "object",
      properties: {
        desires: { type: "array", items: { type: "string" } },
        fears: { type: "array", items: { type: "string" } },
        coreValues: { type: "array", items: { type: "string" } },
        nonNegotiable: { type: "array", items: { type: "string" } },
      },
    },
    backstory: {
      type: "object",
      properties: {
        events: {
          type: "array",
          items: {
            type: "object",
            properties: {
              event: { type: "string" },
              choice: { type: "string" },
              residue: { type: "string" },
            },
          },
        },
      },
    },
    abilities: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          scope: { type: "string" },
          level: { type: "string" },
          limit: { type: "string" },
          cost: { type: "string" },
          usage: { type: "string" },
        },
      },
    },
    habits: {
      type: "object",
      properties: {
        hobbies: { type: "array", items: { type: "string" } },
        habits: { type: "array", items: { type: "string" } },
        likes: { type: "array", items: { type: "string" } },
        dislikes: { type: "array", items: { type: "string" } },
      },
    },
    dailyLife: { type: "string" },
    situation: {
      type: "object",
      properties: {
        worldContext: { type: "string" },
        personalSituation: { type: "string" },
        userEntry: { type: "string" },
      },
    },
  },
};

export const CHARACTER_BIBLE_2_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    speech: {
      type: "object",
      properties: {
        register: { type: "string" },
        sentenceLength: { type: "string" },
        tempo: { type: "string" },
        vocabulary: { type: "string" },
        frequentPhrases: { type: "array", items: { type: "string" } },
        rarePhrases: { type: "array", items: { type: "string" } },
        profanity: { type: "string" },
        humorStyle: { type: "string" },
        addressStyle: { type: "string" },
        hiddenEmotionStyle: { type: "string" },
        angryStyle: { type: "string" },
        intimateStyle: { type: "string" },
        keywords: { type: "array", items: { type: "string" } },
        description: { type: "string" },
        examples: { type: "string" },
        forbidden: { type: "string" },
      },
    },
    behaviorRules: { type: "array", items: { type: "string" } },
    userRelationship: {
      type: "object",
      properties: {
        initialView: { type: "string" },
        userRole: { type: "string" },
        startingPoint: { type: "string" },
        progression: { type: "array", items: { type: "string" } },
      },
    },
    otherRelationships: {
      type: "array",
      items: {
        type: "object",
        properties: {
          target: { type: "string" },
          public: { type: "string" },
          privateOpinion: { type: "string" },
          hidden: { type: "string" },
        },
      },
    },
    secrets: { type: "array", items: { type: "string" } },
    rpEngine: {
      type: "object",
      properties: {
        immediateHook: { type: "string" },
        repeatable: { type: "array", items: { type: "string" } },
        mediumConflict: { type: "string" },
        longTermChange: { type: "string" },
      },
    },
    greeting: { type: "string" },
    publicProfile: {
      type: "object",
      properties: {
        tagline: { type: "string" },
        description: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
      },
    },
    npcs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: ["number", "null"] },
          heightCm: { type: ["number", "null"] },
          appearance: { type: "string" },
          personalityKeywords: { type: "array", items: { type: "string" } },
          role: { type: "string" },
          relationToChar: { type: "string" },
          speech: { type: "string" },
          adultEligible: { type: "boolean" },
        },
      },
    },
    nsfw: { type: "boolean" },
    adultSection: {
      type: ["object", "null"],
      properties: {
        orientation: { type: "string" },
        hookSummary: { type: "string" },
        dialogueProfile: { type: "string" },
        consentModes: { type: "array", items: { type: "string" } },
        tone: { type: "string" },
        preferenceKeywords: { type: "array", items: { type: "string" } },
        boundaries: { type: "array", items: { type: "string" } },
        consentBehavior: { type: "string" },
        scenarioExamples: { type: "array", items: { type: "string" } },
      },
    },
  },
};

// ── Bible validators (deterministic, §55) ────────────────────────────────────

function err(code: string, message: string): QaIssue {
  return { code, message };
}

function warn(code: string, message: string): QaIssue {
  return { code, message };
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Supernatural / high-power abilities must carry a limit or a cost. */
const HIGH_POWER_RE = /(마법|마력|주문|축복|저주|신력|성력|정령|소환|예지|회귀|빙의|재생|불사|순간이동|염동력|정신지배|시간|차원|검기|오러|소드마스터|그랜드|아크메이지|드래곤|용언)/;

const HIDDEN_KNOWLEDGE_RE = /(숨겨진|비밀|정체를\s*숨|진짜\s*정체|사실은|혈통|출생의\s*비밀|속마음|흑막|훗날|미래에|장차|결국\s*\S+하게\s*된다)/;

export function validateWorldBible(
  bible: OfficialWorldBible,
  opts: { slots: number; adultCandidates: number }
): QaResult {
  const errors: QaIssue[] = [];
  const warnings: QaIssue[] = [];
  for (const key of ["name", "genre", "tone", "era", "regions", "premise", "centralPremise"] as const) {
    if (!nonEmpty(bible[key])) errors.push(err("world_identity_missing", `${key} is required`));
  }
  if (nonEmpty(bible.premise) && (bible.premise.length < 300 || bible.premise.length > 600)) {
    warnings.push(warn("world_premise_band", `premise ${bible.premise.length} chars (target 300-600)`));
  }
  const situation = bible.situation ?? ({} as OfficialWorldBible["situation"]);
  let situationChars = 0;
  for (const key of ["biggestEvent", "beneficiaries", "threatened", "upcomingChange"] as const) {
    if (!nonEmpty(situation[key])) errors.push(err("world_situation_missing", `situation.${key} is required`));
    else situationChars += situation[key].length;
  }
  if (situationChars > 0 && (situationChars < 500 || situationChars > 1000)) {
    warnings.push(warn("world_situation_band", `situation ${situationChars} chars (target 500-1000)`));
  }
  if (!Array.isArray(bible.factions) || bible.factions.length < 3 || bible.factions.length > 6) {
    errors.push(err("world_faction_count", `factions 3-6 required, got ${bible.factions?.length ?? 0}`));
  } else {
    bible.factions.forEach((f, i) => {
      for (const key of ["name", "purpose", "leadership", "means", "relations", "publicView"] as const) {
        if (!nonEmpty(f[key])) errors.push(err("world_faction_incomplete", `factions[${i}].${key} is required`));
      }
    });
  }
  const power = bible.powerSystem ?? ({} as OfficialWorldBible["powerSystem"]);
  for (const key of ["capabilities", "users", "limits", "costs", "taboos"] as const) {
    if (!nonEmpty(power[key])) errors.push(err("world_power_missing", `powerSystem.${key} is required`));
  }
  const societyKeys = Object.keys(bible.society ?? {}).filter((k) => nonEmpty(bible.society[k]));
  if (societyKeys.length < 3) errors.push(err("world_society_thin", "society needs at least 3 defined areas"));
  if (!Array.isArray(bible.culture) || bible.culture.length < 3 || bible.culture.length > 6) {
    errors.push(err("world_culture_count", `culture 3-6 required, got ${bible.culture?.length ?? 0}`));
  }
  if (!Array.isArray(bible.locations) || bible.locations.length < 5 || bible.locations.length > 10) {
    errors.push(err("world_location_count", `locations 5-10 required, got ${bible.locations?.length ?? 0}`));
  } else {
    bible.locations.forEach((location, i) => {
      for (const key of ["name", "purpose", "mood", "users", "rpEvents"] as const) {
        if (!nonEmpty(location[key])) errors.push(err("world_location_incomplete", `locations[${i}].${key} is required`));
      }
    });
  }
  if (!Array.isArray(bible.history) || bible.history.length < 3 || bible.history.length > 6) {
    errors.push(err("world_history_count", `history 3-6 required, got ${bible.history?.length ?? 0}`));
  }
  const knowledge = bible.knowledge ?? { common: [], faction: [], characterLocal: [], authorOnly: [] };
  if (!Array.isArray(knowledge.common) || knowledge.common.length === 0) {
    errors.push(err("world_knowledge_empty", "knowledge.common is required"));
  }
  for (const fact of knowledge.common ?? []) {
    if (HIDDEN_KNOWLEDGE_RE.test(fact)) {
      errors.push(err("world_knowledge_hidden_in_common", `COMMON leaks hidden knowledge: ${fact.slice(0, 40)}…`));
    }
  }
  if (!Array.isArray(bible.userEntry?.allowedRoles) || bible.userEntry.allowedRoles.length < 2) {
    errors.push(err("world_user_entry_narrow", "userEntry needs at least 2 allowed roles"));
  }
  if (!Array.isArray(bible.lorebook) || bible.lorebook.length < 8 || bible.lorebook.length > 12) {
    errors.push(err("world_lorebook_count", `lorebook 8-12 required, got ${bible.lorebook?.length ?? 0}`));
  } else {
    bible.lorebook.forEach((entry, i) => {
      if (!nonEmpty(entry.name) || !nonEmpty(entry.content)) {
        errors.push(err("world_lorebook_incomplete", `lorebook[${i}] needs name + content`));
      }
      if (entry.content?.length > 800) errors.push(err("world_lorebook_too_long", `lorebook[${i}] > 800 chars`));
      if ((entry.keywords?.length ?? 0) > 10) errors.push(err("world_lorebook_keywords", `lorebook[${i}] > 10 keywords`));
      if (entry.content && HIDDEN_KNOWLEDGE_RE.test(entry.content)) {
        errors.push(err("world_lorebook_hidden", `lorebook[${i}] contains hidden-knowledge wording`));
      }
    });
  }
  if (!Array.isArray(bible.portfolio) || bible.portfolio.length !== opts.slots) {
    errors.push(err("world_portfolio_count", `portfolio must hold exactly ${opts.slots} briefs`));
  } else {
    const adultCount = bible.portfolio.filter((b) => b.adultCandidate).length;
    if (adultCount !== opts.adultCandidates) {
      errors.push(
        err("world_portfolio_adult", `portfolio adult candidates ${adultCount}, manifest requires ${opts.adultCandidates}`)
      );
    }
  }
  return qaResult(errors, warnings);
}

export function validateCharacterBible(
  bible: OfficialCharacterBible,
  opts: { adultExpected: boolean }
): QaResult {
  const errors: QaIssue[] = [];
  const warnings: QaIssue[] = [];

  const id = bible.identity ?? ({} as OfficialCharacterBible["identity"]);
  if (!nonEmpty(id.name)) errors.push(err("bible_identity_name", "identity.name is required"));
  else if (id.name.length > 20) errors.push(err("bible_identity_name_long", "identity.name must fit 20 chars"));
  if (!["male", "female", "other"].includes(id.gender)) errors.push(err("bible_identity_gender", "identity.gender invalid"));
  if (!Number.isInteger(id.age) || id.age < 19) {
    errors.push(err("bible_identity_age", `pilot characters must be 19+, got ${String(id.age)}`));
  }
  if (!Number.isInteger(id.heightCm) || id.heightCm < 140 || id.heightCm > 220) {
    errors.push(err("bible_identity_height", `heightCm must be 140-220, got ${String(id.heightCm)}`));
  }
  for (const key of ["occupation", "socialPosition", "worldRole"] as const) {
    if (!nonEmpty(id[key])) errors.push(err("bible_identity_missing", `identity.${key} is required`));
  }

  const appearance = bible.appearance ?? ({} as OfficialCharacterBible["appearance"]);
  const appearanceKeys = [
    "faceShape",
    "eyes",
    "eyeColor",
    "hairColor",
    "hairstyle",
    "hairLength",
    "skin",
    "build",
    "musculature",
    "distinguishingFeatures",
    "usualExpression",
    "defaultOutfit",
    "accessories",
    "impression",
  ] as const;
  let appearanceChars = 0;
  for (const key of appearanceKeys) {
    if (!nonEmpty(appearance[key])) errors.push(err("bible_appearance_missing", `appearance.${key} is required`));
    else appearanceChars += appearance[key].length;
  }
  if (appearanceChars > 0 && (appearanceChars < 250 || appearanceChars > 500)) {
    warnings.push(warn("bible_appearance_band", `appearance ${appearanceChars} chars (target 250-500)`));
  }

  const keywords = bible.personality?.keywords ?? [];
  if (keywords.length < 5 || keywords.length > 8) {
    errors.push(err("bible_personality_keywords", `personality.keywords 5-8 required, got ${keywords.length}`));
  }
  const behavioral = bible.personality?.behavioral ?? "";
  if (behavioral.length < 400) errors.push(err("bible_behavioral_thin", `behavioral ${behavioral.length} chars (< 400)`));
  else if (behavioral.length > 800) warnings.push(warn("bible_behavioral_band", `behavioral ${behavioral.length} chars (> 800)`));
  for (const probe of ["낯선", "화났", "불안", "당황", "애정", "갈등"]) {
    if (!behavioral.includes(probe)) {
      warnings.push(warn("bible_behavioral_coverage", `behavioral may not cover '${probe}'`));
    }
  }

  if (!nonEmpty(bible.contradiction) || bible.contradiction.length < 30) {
    errors.push(err("bible_contradiction_missing", "internal contradiction is required (≥30 chars)"));
  }

  const values = bible.values ?? { desires: [], fears: [], coreValues: [], nonNegotiable: [] };
  const checkCount = (list: string[], min: number, max: number, code: string) => {
    if (!Array.isArray(list) || list.length < min || list.length > max) {
      errors.push(err(code, `${code}: ${list?.length ?? 0} items (need ${min}-${max})`));
    }
  };
  checkCount(values.desires, 1, 3, "bible_desires");
  checkCount(values.fears, 1, 3, "bible_fears");
  checkCount(values.coreValues, 2, 4, "bible_core_values");
  checkCount(values.nonNegotiable, 1, 2, "bible_non_negotiable");

  const events = bible.backstory?.events ?? [];
  if (events.length < 2 || events.length > 4) {
    errors.push(err("bible_backstory_events", `formative events 2-4 required, got ${events.length}`));
  } else {
    let backstoryChars = 0;
    events.forEach((event, i) => {
      for (const key of ["event", "choice", "residue"] as const) {
        if (!nonEmpty(event[key])) errors.push(err("bible_backstory_incomplete", `backstory.events[${i}].${key} is required`));
        else backstoryChars += event[key].length;
      }
    });
    if (backstoryChars > 0 && (backstoryChars < 500 || backstoryChars > 1000)) {
      warnings.push(warn("bible_backstory_band", `backstory ${backstoryChars} chars (target 500-1000)`));
    }
  }

  const abilities = bible.abilities ?? [];
  if (abilities.length < 2 || abilities.length > 6) {
    errors.push(err("bible_ability_count", `abilities 2-6 required, got ${abilities.length}`));
  } else {
    abilities.forEach((ability, i) => {
      if (!nonEmpty(ability.name) || !nonEmpty(ability.scope)) {
        errors.push(err("bible_ability_incomplete", `abilities[${i}] needs name + scope`));
      }
      if (HIGH_POWER_RE.test(`${ability.name} ${ability.scope} ${ability.level}`)) {
        if (!nonEmpty(ability.limit) && !nonEmpty(ability.cost)) {
          errors.push(err("bible_ability_no_limit", `abilities[${i}] high-power without limit or cost`));
        }
      }
    });
  }

  const habits = bible.habits ?? { hobbies: [], habits: [], likes: [], dislikes: [] };
  checkCount(habits.hobbies, 2, 4, "bible_hobbies");
  checkCount(habits.habits, 2, 5, "bible_habit_list");
  checkCount(habits.likes, 3, 6, "bible_likes");
  checkCount(habits.dislikes, 3, 6, "bible_dislikes");

  const daily = bible.dailyLife ?? "";
  if (daily.length < 200) errors.push(err("bible_daily_thin", `dailyLife ${daily.length} chars (< 200)`));
  else if (daily.length > 400) warnings.push(warn("bible_daily_band", `dailyLife ${daily.length} chars (> 400)`));

  const speech = bible.speech ?? ({} as OfficialCharacterBible["speech"]);
  const speechKeywords = speech.keywords ?? [];
  if (speechKeywords.length < 4 || speechKeywords.length > 8) {
    errors.push(err("bible_speech_keywords", `speech.keywords 4-8 required, got ${speechKeywords.length}`));
  }
  if ((speech.description ?? "").length < 250) {
    errors.push(err("bible_speech_thin", "speech.description must be ≥250 chars"));
  } else if (speech.description.length > 500) {
    warnings.push(warn("bible_speech_band", `speech.description ${speech.description.length} chars (> 500)`));
  }
  const exampleCount = (speech.examples ?? "").split("\n").map((s) => s.trim()).filter(Boolean).length;
  if (exampleCount < 4) errors.push(err("bible_speech_examples", `dialogue examples ≥4 required, got ${exampleCount}`));
  if ((speech.examples ?? "").length > 500) {
    errors.push(err("bible_speech_examples_limit", "speech.examples must fit the 500-char canonical limit"));
  }
  if ((speech.forbidden ?? "").length > 500) {
    errors.push(err("bible_speech_forbidden_limit", "speech.forbidden must fit the 500-char canonical limit"));
  }

  const rules = bible.behaviorRules ?? [];
  if (rules.length < 3 || rules.length > 7) {
    errors.push(err("bible_behavior_rules", `behaviorRules 3-7 required, got ${rules.length}`));
  }

  const rel = bible.userRelationship ?? { initialView: "", userRole: "", startingPoint: "", progression: [] };
  if (!nonEmpty(rel.initialView) || !nonEmpty(rel.userRole) || !nonEmpty(rel.startingPoint)) {
    errors.push(err("bible_user_rel_missing", "userRelationship needs initialView + userRole + startingPoint"));
  }
  if (!Array.isArray(rel.progression) || rel.progression.length < 3) {
    errors.push(err("bible_progression_missing", "relationship progression needs ≥3 stages"));
  }

  const engine = bible.rpEngine ?? { immediateHook: "", repeatable: [], mediumConflict: "", longTermChange: "" };
  if (!nonEmpty(engine.immediateHook)) errors.push(err("bible_hook_missing", "rpEngine.immediateHook is required"));
  if (!Array.isArray(engine.repeatable) || engine.repeatable.length < 3) {
    errors.push(err("bible_repeatable_missing", "rpEngine.repeatable needs ≥3 activities"));
  }
  if (!nonEmpty(engine.mediumConflict) || !nonEmpty(engine.longTermChange)) {
    errors.push(err("bible_engine_missing", "rpEngine needs mediumConflict + longTermChange"));
  }

  if (!nonEmpty(bible.greeting)) errors.push(err("bible_greeting_missing", "greeting is required"));
  else if (bible.greeting.length > 2000) errors.push(err("bible_greeting_limit", "greeting must fit the 2000-char canonical limit"));
  else if (bible.greeting.length < 700 || bible.greeting.length > 1400) {
    warnings.push(warn("bible_greeting_band", `greeting ${bible.greeting.length} chars (target 700-1400)`));
  }

  const profile = bible.publicProfile ?? { tagline: "", description: "", tags: [] };
  if (!nonEmpty(profile.tagline)) errors.push(err("bible_tagline_missing", "publicProfile.tagline is required"));
  else if (profile.tagline.length > 50) errors.push(err("bible_tagline_limit", "tagline must fit the 50-char canonical limit"));
  if ((profile.description ?? "").length < 200) {
    errors.push(err("bible_pitch_thin", "publicProfile.description must be ≥200 chars"));
  }
  const tags = profile.tags ?? [];
  if (tags.length < 3 || tags.length > 6) errors.push(err("bible_tags", `publicProfile.tags 3-6 required, got ${tags.length}`));

  const secrets = bible.secrets ?? [];
  if (secrets.length < 1 || secrets.length > 4) {
    errors.push(err("bible_secrets", `secrets 1-4 required, got ${secrets.length}`));
  }
  const npcs = bible.npcs ?? [];
  if (npcs.length > 3) errors.push(err("bible_npc_count", `at most 3 supporting NPCs, got ${npcs.length}`));

  if (opts.adultExpected !== bible.nsfw) {
    errors.push(err("bible_nsfw_mismatch", `nsfw=${bible.nsfw}, manifest expects ${opts.adultExpected}`));
  }
  if (bible.nsfw) {
    const adult = bible.adultSection;
    if (!adult) {
      errors.push(err("bible_adult_missing", "nsfw sheets require adultSection"));
    } else {
      if (!nonEmpty(adult.orientation) || !nonEmpty(adult.hookSummary)) {
        errors.push(err("bible_adult_profile", "adultSection needs orientation + hookSummary"));
      }
      if (!["auto", "none", "suggestive", "explicit_rare", "explicit_frequent"].includes(adult.dialogueProfile)) {
        errors.push(err("bible_adult_profile_invalid", "adultSection.dialogueProfile invalid"));
      }
      const modes = adult.consentModes ?? [];
      if (!Array.isArray(modes) || modes.length === 0 || !modes.every((m) => ["standard", "power_play", "cnc_opt_in"].includes(m))) {
        errors.push(err("bible_adult_consent", "adultSection.consentModes invalid"));
      }
      const prefs = adult.preferenceKeywords ?? [];
      if (prefs.length < 4 || prefs.length > 8) errors.push(err("bible_adult_prefs", `preferenceKeywords 4-8 required, got ${prefs.length}`));
      const boundaries = adult.boundaries ?? [];
      if (boundaries.length < 3 || boundaries.length > 6) {
        errors.push(err("bible_adult_boundaries", `boundaries 3-6 required, got ${boundaries.length}`));
      }
      if ((adult.tone ?? "").length < 150) errors.push(err("bible_adult_tone", "adultSection.tone must be ≥150 chars"));
      if ((adult.consentBehavior ?? "").length < 150) {
        errors.push(err("bible_adult_consent_behavior", "adultSection.consentBehavior must be ≥150 chars"));
      }
      const scenarios = adult.scenarioExamples ?? [];
      if (scenarios.length < 2 || scenarios.length > 3) {
        errors.push(err("bible_adult_scenarios", `scenarioExamples 2-3 required, got ${scenarios.length}`));
      }
    }
  } else if (bible.adultSection && (
    nonEmpty(bible.adultSection.tone) ||
    (bible.adultSection.preferenceKeywords?.length ?? 0) > 0 ||
    (bible.adultSection.boundaries?.length ?? 0) > 0
  )) {
    errors.push(err("bible_sfw_adult_content", "SFW sheets must not carry adult authoring content"));
  }

  return qaResult(errors, warnings);
}

// ── Canonical compiler: bible → OfficialCharacterDraft ───────────────────────

export type CompileKeys = {
  draftKey: string;
  worldKey: string;
  styleKey: string;
  genres: OfficialCharacterDraft["genres"];
  audience: OfficialCharacterDraft["audience"];
  hook: OfficialCharacterDraft["hook"];
};

function joinParagraphs(parts: string[]): string {
  return parts.map((p) => p.trim()).filter(Boolean).join("\n\n");
}

/**
 * Single canonical compiler. Personality keywords stay indexing-only (never
 * dumped into runtime prose); hidden relationship opinions compile into local
 * secrets; FACTION/CHARACTER_LOCAL/AUTHOR_ONLY knowledge never enters.
 */
export function compileOfficialDraftFromBible(
  bible: OfficialCharacterBible,
  keys: CompileKeys
): OfficialCharacterDraft {
  const id = bible.identity;
  const task = "bible_compile";

  const tagline = bible.publicProfile.tagline.trim();
  if (!tagline || tagline.length > 50) {
    throw new OfficialSupplyGateError("author_shape_invalid", `${task}: tagline must fit 50 chars`);
  }
  if (bible.speech.examples.length > 500 || bible.speech.forbidden.length > 500) {
    throw new OfficialSupplyGateError("author_shape_invalid", `${task}: speech fields exceed canonical limits`);
  }
  if (bible.greeting.length > 2000) {
    throw new OfficialSupplyGateError("author_shape_invalid", `${task}: greeting exceeds 2000 chars`);
  }
  if (bible.npcs.length > 3) {
    throw new OfficialSupplyGateError("author_shape_invalid", `${task}: at most 3 supporting NPCs`);
  }

  const identityLine = `${id.name}(${id.age}세, ${id.occupation} · ${id.socialPosition} · ${id.affiliation}). ${id.worldRole}.`;
  const appearanceSummary = [
    `${bible.appearance.faceShape}에 ${bible.appearance.eyes}(${bible.appearance.eyeColor})`,
    `${bible.appearance.hairColor} ${bible.appearance.hairstyle}(${bible.appearance.hairLength})`,
    `${id.heightCm}cm ${bible.appearance.build}, ${bible.appearance.skin} 피부`,
    `특징: ${bible.appearance.distinguishingFeatures}`,
    `평소 ${bible.appearance.usualExpression}. ${bible.appearance.defaultOutfit} 차림, ${bible.appearance.accessories}.`,
    `인상: ${bible.appearance.impression}`,
  ].join(" ");
  const valuesText = [
    `원하는 것: ${bible.values.desires.join(" / ")}`,
    `두려운 것: ${bible.values.fears.join(" / ")}`,
    `가치관: ${bible.values.coreValues.join(" / ")}`,
    `포기 못 하는 것: ${bible.values.nonNegotiable.join(" / ")}`,
  ].join("\n");
  const backstoryText = bible.backstory.events
    .map((event) => `· ${event.event} 당시 선택: ${event.choice} 남은 것: ${event.residue}`)
    .join("\n");
  const abilityText = bible.abilities
    .map((ability) => {
      const limit = [ability.limit, ability.cost].filter(nonEmpty).join(" / ");
      return `· ${ability.name}(${ability.level}): ${ability.scope}${limit ? ` [한계·대가: ${limit}]` : ""} ${ability.usage}`;
    })
    .join("\n");
  const habitsText = [
    `취미: ${bible.habits.hobbies.join(" / ")}`,
    `습관: ${bible.habits.habits.join(" / ")}`,
    `일상: ${bible.dailyLife}`,
  ].join("\n");

  const characterCore = joinParagraphs([
    identityLine,
    appearanceSummary,
    bible.personality.behavioral,
    `내적 모순: ${bible.contradiction}`,
    valuesText,
    backstoryText,
    abilityText,
    habitsText,
  ]);

  const otherPublic = bible.otherRelationships.map((rel) =>
    [`· ${rel.target}(공개): ${rel.public}`, rel.privateOpinion ? `속내: ${rel.privateOpinion}` : ""]
      .filter(Boolean)
      .join(" ")
  );
  const relationshipsAndDrives = joinParagraphs([
    `첫인식: ${bible.userRelationship.initialView}`,
    `유저 역할: ${bible.userRelationship.userRole}`,
    `시작점: ${bible.userRelationship.startingPoint}`,
    `관계 진행: ${bible.userRelationship.progression.join(" → ")}`,
    otherPublic.length ? otherPublic.join("\n") : "",
    `욕망과 두려움: ${bible.values.desires.join(" / ")} vs ${bible.values.fears.join(" / ")}`,
    `중기 갈등: ${bible.rpEngine.mediumConflict}`,
    `장기 변화: ${bible.rpEngine.longTermChange}`,
  ]);

  const extraCanon = joinParagraphs([
    `호불호: 좋아하는 것 ${bible.habits.likes.join(" / ")} / 싫어하는 것 ${bible.habits.dislikes.join(" / ")}`,
  ]);

  const speechTraits = [
    `구어체: ${bible.speech.register} · 문장 ${bible.speech.sentenceLength} · 속도 ${bible.speech.tempo}`,
    `어휘: ${bible.speech.vocabulary}`,
    `자주: ${bible.speech.frequentPhrases.join(" / ")}`,
    `거의 안 씀: ${bible.speech.rarePhrases.join(" / ")}`,
    `욕설: ${bible.speech.profanity}`,
    `농담: ${bible.speech.humorStyle} · 호칭: ${bible.speech.addressStyle}`,
    `감정 은폐: ${bible.speech.hiddenEmotionStyle} · 분노: ${bible.speech.angryStyle} · 친밀: ${bible.speech.intimateStyle}`,
    `행동 규칙: ${bible.behaviorRules.join(" / ")}`,
  ].join("\n");

  const hiddenRels = bible.otherRelationships
    .map((rel) => (nonEmpty(rel.hidden) ? `${rel.target}에 대한 숨김: ${rel.hidden}` : ""))
    .filter(Boolean);

  const eligibleNpcAges = bible.npcs
    .filter((npc) => npc.adultEligible && npc.age != null)
    .map((npc) => npc.age as number);
  const adult = !bible.nsfw
    ? ({ nsfw: false } as const)
    : {
        nsfw: true as const,
        participantMinAge: Math.min(id.age, ...eligibleNpcAges),
        adultDialogueProfile: (bible.adultSection?.dialogueProfile ?? "none") as AdultDialogueProfile,
        adultConsentModesAllowed: (bible.adultSection?.consentModes ?? ["standard"]) as AdultConsentMode[],
        orientation: bible.adultSection?.orientation ?? "",
        adultHookSummary: [
          bible.adultSection?.hookSummary ?? "",
          nonEmpty(bible.adultSection?.tone ?? "") ? `성향: ${bible.adultSection?.tone}` : "",
          nonEmpty(bible.adultSection?.consentBehavior ?? "")
            ? `합의: ${bible.adultSection?.consentBehavior}`
            : "",
        ]
          .filter(Boolean)
          .join("\n"),
      };

  return {
    draftKey: keys.draftKey,
    worldKey: keys.worldKey,
    styleKey: keys.styleKey,
    name: id.name,
    tagline,
    description: bible.publicProfile.description,
    greeting: bible.greeting,
    gender: id.gender as OfficialCharacterDraft["gender"],
    age: id.age,
    genres: keys.genres,
    tags: bible.publicProfile.tags,
    audience: keys.audience,
    sections: {
      worldAndSituation: joinParagraphs([
        bible.situation.worldContext,
        bible.situation.personalSituation,
        bible.situation.userEntry,
      ]),
      characterCore,
      relationshipsAndDrives,
      extraCanon,
    },
    speech: {
      personality: bible.speech.description,
      traits: speechTraits,
      examples: bible.speech.examples,
      forbidden: bible.speech.forbidden,
    },
    supportingNpcs: bible.npcs,
    hook: keys.hook,
    secrets: [...bible.secrets, ...hiddenRels],
    adult: adult as OfficialCharacterDraft["adult"],
  };
}
