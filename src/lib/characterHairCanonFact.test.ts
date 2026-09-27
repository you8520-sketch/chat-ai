/**
 * Facial/body-hair presence is owned by the AI character's appearance canon.
 * Deterministic prompt-assembly checks only (no provider calls).
 */
import Module from "module";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import { buildContext } from "@/services/contextBuilder";
import { parseCharacterSetting } from "@/utils/characterParser";
import { formatSelectedPersonaForPrompt } from "@/lib/userPersonas";
import {
  applyCharacterHairCanonFact,
  buildCharacterHairCanonFact,
  resolveHairDescriptionPolicy,
} from "@/lib/bodyHairRules";
import { COMMON_PROSE_BLOCK, NSFW_EXPLICIT_SENSORY_WRITING_BLOCK } from "@/lib/advancedProseNsfwGuidelines";
import type { CharacterGender } from "@/lib/characterGender";

const NO_BEARD_FACT = "외형의 털: 머리카락·눈썹뿐이다.";
const HAIR_FACT_PREFIX = "외형의 털:";

function assemble(opts: {
  gender: CharacterGender;
  appearance: string;
  persona?: { gender: CharacterGender; description: string };
  modelId?: string;
  nsfw?: boolean;
}) {
  const chunks = parseCharacterSetting({
    characterId: "hair-canon",
    characterName: "하율",
    gender: opts.gender,
    systemPrompt: `# 성격\n차분하다.\n\n# 외형\n${opts.appearance}`,
    world: "",
    exampleDialog: "",
    statusWindowPrompt: "",
  });
  const built = buildContext({
    charName: "하율",
    chunks,
    userNickname: "렌",
    userPersona: opts.persona
      ? formatSelectedPersonaForPrompt("렌", opts.persona.gender, opts.persona.description)
      : "",
    userNote: "",
    longTermMemory: "",
    shortTermHistory: [],
    currentUserMessage: "…밤새 한숨도 못 잤지?",
    nsfw: opts.nsfw ?? false,
    gender: opts.gender,
    userPersonaGender: opts.persona?.gender ?? null,
    modelId: opts.modelId ?? "gemini-3.1-pro-preview",
    provider: "cheaperinference",
    personaDisplayName: "렌",
    targetResponseChars: 3200,
    completedTurns: 1,
  });
  return built.systemPrompt ?? "";
}

function appearanceSection(system: string): string {
  const start = system.indexOf("[외형]");
  assert.ok(start >= 0, "appearance section present");
  const next = system.indexOf("\n\n[", start);
  return system.slice(start, next < 0 ? undefined : next);
}

describe("character hair canon fact", () => {
  it("male without beard in setting: beard + body-hair fact inside [외형] once", () => {
    const system = assemble({ gender: "male", appearance: "키 178cm, 검은 머리." });
    const appearance = appearanceSection(system);
    assert.ok(appearance.includes(NO_BEARD_FACT));
    assert.equal(system.split(HAIR_FACT_PREFIX).length - 1, 1);
    // Positive fact only — no stubble vocabulary that the model could echo.
    assert.doesNotMatch(appearance, /수염|자국|까칠/);
  });

  it("male with canonical beard: beard canon kept, no beard-absence fact", () => {
    const system = assemble({ gender: "male", appearance: "키 178cm, 짧게 다듬은 턱수염." });
    const appearance = appearanceSection(system);
    assert.match(appearance, /짧게 다듬은 턱수염/);
    assert.ok(appearance.includes("외형의 털: 머리카락·눈썹·설정의 수염뿐이다."));
  });

  it("female character: no beard fact, body-hair fact only", () => {
    const system = assemble({ gender: "female", appearance: "키 168cm, 단발." });
    const appearance = appearanceSection(system);
    assert.doesNotMatch(appearance, /수염/);
    assert.ok(appearance.includes(NO_BEARD_FACT));
  });

  it("fact is scoped to the character canon, not the user persona", () => {
    const system = assemble({
      gender: "male",
      appearance: "키 178cm, 검은 머리.",
      persona: { gender: "male", description: "30대 남성 형사. 짧게 기른 턱수염." },
    });
    assert.match(system, /짧게 기른 턱수염/);
    assert.equal(system.split(HAIR_FACT_PREFIX).length - 1, 1);
    assert.ok(appearanceSection(system).includes(NO_BEARD_FACT));
  });

  it("DeepSeek keeps its appearance variation rule alongside the fact", () => {
    const system = assemble({
      gender: "male",
      appearance: "키 178cm, 검은 머리.",
      modelId: "deepseek-v4-pro-0813",
    });
    assert.match(system, /외형·복식의 설명형 키워드/);
    assert.equal(system.split(HAIR_FACT_PREFIX).length - 1, 1);
  });

  it("hair presence stays out of the prose and adult style owners", () => {
    assert.doesNotMatch(COMMON_PROSE_BLOCK, /수염|체모/);
    assert.doesNotMatch(NSFW_EXPLICIT_SENSORY_WRITING_BLOCK, /수염|체모/);
    const adultSystem = assemble({ gender: "male", appearance: "키 178cm.", nsfw: true });
    assert.equal(adultSystem.split(HAIR_FACT_PREFIX).length - 1, 1);
  });

  it("builder returns null when every hair type the character can have is specified", () => {
    const policy = resolveHairDescriptionPolicy("male", "턱수염과 짙은 체모", "other");
    assert.equal(buildCharacterHairCanonFact(policy), null);
    assert.equal(
      buildCharacterHairCanonFact(resolveHairDescriptionPolicy("female", "짙은 체모", "other")),
      null
    );
    assert.equal(
      buildCharacterHairCanonFact(resolveHairDescriptionPolicy("male", "짙은 체모", "other")),
      "외형의 털: 머리카락·눈썹·설정의 체모뿐이다."
    );
    assert.equal(applyCharacterHairCanonFact("[외형]\n키 180cm", null), "[외형]\n키 180cm");
  });

  it("appends an appearance section when the canon has none", () => {
    const out = applyCharacterHairCanonFact("[성격]\n차분하다.", NO_BEARD_FACT);
    assert.ok(out.endsWith(`[외형]\n${NO_BEARD_FACT}`));
  });
});
