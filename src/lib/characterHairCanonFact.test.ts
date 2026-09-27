/**
 * Structured character hair canon fact in prompt assembly.
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
import { buildCharacterHairCanonFactFromAppearanceText } from "@/lib/bodyHairRules";
import type { CharacterGender } from "@/lib/characterGender";

const HAIR_FACT = "facial_hair=none; body_hair=none";

function assemble(opts: {
  gender: CharacterGender;
  appearance: string;
  persona?: { gender: CharacterGender; description: string };
  world?: string;
}) {
  const chunks = parseCharacterSetting({
    characterId: "hair-canon",
    characterName: "하율",
    gender: opts.gender,
    systemPrompt: `# 성격\n차분하다.\n\n# 외형\n${opts.appearance}`,
    world: opts.world ?? "",
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
    nsfw: false,
    gender: opts.gender,
    userPersonaGender: opts.persona?.gender ?? null,
    modelId: "gemini-3.1-pro-preview",
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
  it("male without beard: compact structured fact in [외형] once", () => {
    const system = assemble({ gender: "male", appearance: "키 178cm, 검은 머리." });
    const appearance = appearanceSection(system);
    assert.ok(appearance.includes(HAIR_FACT));
    assert.equal(system.split("facial_hair=").length - 1, 1);
    assert.doesNotMatch(appearance, /수염|까칠|자국/);
  });

  it("male with canonical beard preserves beard while keeping body-hair absence", () => {
    const system = assemble({ gender: "male", appearance: "키 178cm, 짧게 다듬은 턱수염." });
    assert.equal(
      buildCharacterHairCanonFactFromAppearanceText("male", "짧게 다듬은 턱수염."),
      "facial_hair=canon; body_hair=none"
    );
    assert.match(appearanceSection(system), /facial_hair=canon; body_hair=none/);
    assert.doesNotMatch(appearanceSection(system), /facial_hair=none/);
  });

  it("수염 없음 setting yields absence fact, not allow-beard", () => {
    assert.equal(
      buildCharacterHairCanonFactFromAppearanceText("male", "수염 없음. 깔끔한 턱."),
      HAIR_FACT
    );
  });

  it("persona beard stays in persona block; fact only on character", () => {
    const system = assemble({
      gender: "male",
      appearance: "키 178cm.",
      persona: { gender: "male", description: "30대 남성. 짧게 기른 턱수염." },
    });
    assert.match(system, /턱수염/);
    assert.equal(system.split("facial_hair=").length - 1, 1);
  });

  it("NPC beard in world lore does not contaminate main character hair policy", () => {
    const system = assemble({
      gender: "male",
      appearance: "키 178cm, 검은 머리.",
      world: "[NPC]\n김 형사는 짙은 턱수염을 기르고 있다.",
    });
    assert.match(appearanceSection(system), /facial_hair=none/);
  });

  it("explicit facial hair canon is preserved regardless of gender default", () => {
    const system = assemble({
      gender: "female",
      appearance: "키 175cm, 짧게 다듬은 턱수염.",
    });
    assert.match(appearanceSection(system), /facial_hair=canon; body_hair=none/);
    assert.doesNotMatch(appearanceSection(system), /facial_hair=none/);
  });
});
