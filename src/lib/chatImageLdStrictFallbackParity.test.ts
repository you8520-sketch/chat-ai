import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildIllustrationSafeDepiction } from "@/lib/chatImageIllustrationSanitizer";
import {
  containsRawRiskySourceLeak,
  projectSceneBlockForSafeImageGeneration,
} from "@/lib/chatImageSafeVisualProjection";
import {
  buildStrictLdDuoFallbackPrompt,
  deriveLdStrictFallbackSceneFacts,
  STRICT_SAFE_DEPICTION,
} from "@/lib/chatImageStrictSafetyFallbackPrompt";
import { buildLdSceneGenerationPlan } from "@/lib/chatLdIllustrationGeneration";

const DUO_SUBJECTS = [
  {
    key: "character",
    name: "태현",
    gender: "male" as const,
    role: "character",
    referenceImageUrl: "/c.webp",
    savedAppearance: "",
    appearanceMode: "image_only" as const,
  },
  {
    key: "persona",
    name: "유저",
    gender: "female" as const,
    role: "persona",
    referenceImageUrl: "/p.webp",
    savedAppearance: "",
    appearanceMode: "image_only" as const,
  },
];

function ldTier2(
  source: string,
  adultGrounded: boolean,
  characterGender: "male" | "female" = "male"
) {
  return buildStrictLdDuoFallbackPrompt({
    characterName: "태현",
    characterGender,
    personaName: "유저",
    personaGender: "female",
    subjects: DUO_SUBJECTS,
    sceneSourceText: source,
    adultGrounded,
  });
}

function ldPrimary(source: string, adultGrounded: boolean) {
  return buildLdSceneGenerationPlan({
    characterName: "태현",
    characterGender: "male",
    personaName: "유저",
    personaGender: "female",
    characterImageUrl: "/c.webp",
    characterSavedAppearance: "",
    characterAppearanceMode: "image_only",
    personaImageUrl: "/p.webp",
    personaSavedAppearance: "",
    personaAppearanceMode: "image_only",
    currentTurn: source,
    adultGrounded,
  }).prompt;
}

const KISS_BED_SHIRTLESS_SOURCE =
  "침실 침대에서 두 성인이 짧게 키스한다. 남자는 셔츠를 벗어 맨가슴과 어깨가 드러나 있고, 둘 다 홍조를 띤다. 이불이 살짝 엉켜 있다.";
const EXPLICIT_BED_SOURCE = "둘이 침대에서 겹치며 성관계를 한다. 둘 다 수줍게 뺨이 붉어진다.";
const ORDINARY_CAFE_SOURCE = "카페에서 두 사람이 차를 마시며 대화한다.";

describe("chatImageLdStrictFallbackParity — root cause fixtures L0-L5", () => {
  it("L0 adultGrounded=false bedroom + kiss + shirtless wording omits adult allowance", () => {
    const source = KISS_BED_SHIRTLESS_SOURCE;
    const tier2 = ldTier2(source, false);
    assert.ok(tier2.includes(STRICT_SAFE_DEPICTION));
    assert.doesNotMatch(tier2, /non-explicit adult intimacy is allowed/i);
    assert.doesNotMatch(tier2, /confirmed adult male chat character is shirtless/i);
    assert.match(tier2, /faces close in calm affectionate proximity/i);
  });

  it("L1 adultGrounded=true kiss only preserves actual kiss contract", () => {
    const source = "두 성인이 서로를 바라보며 짧게 키스한다.";
    const facts = deriveLdStrictFallbackSceneFacts({
      sceneSourceText: source,
      adultGrounded: true,
      characterGender: "male",
    });
    const tier2 = ldTier2(source, true);
    assert.match(facts.safeComposition, /brief non-explicit affectionate kiss/i);
    assert.doesNotMatch(facts.safeComposition, /faces close in calm affectionate proximity/i);
    assert.match(tier2, /brief non-explicit affectionate kiss/i);
  });

  it("L2 adultGrounded=true shirtless + bedroom preserves bare torso without modest contradiction", () => {
    const source = "태현이 셔츠를 벗고 침대에 앉아 있다.";
    const tier2 = ldTier2(source, true);
    assert.match(tier2, /confirmed adult male chat character is shirtless/i);
    assert.match(tier2, /bare shoulders, chest, and upper torso/i);
    assert.match(tier2, /persona remains clothed/i);
    assert.doesNotMatch(tier2, /fully modest clothing or soft coverage/i);
    assert.match(tier2, /preserve above-the-waist shirtless framing/i);
  });

  it("L3 adultGrounded=true kiss + shirtless + bedroom preserves both semantics", () => {
    const source = KISS_BED_SHIRTLESS_SOURCE;
    const facts = deriveLdStrictFallbackSceneFacts({
      sceneSourceText: source,
      adultGrounded: true,
      characterName: "태현",
      personaName: "유저",
      characterGender: "male",
      personaGender: "female",
    });
    const tier2 = ldTier2(source, true);
    assert.match(facts.safeComposition, /brief non-explicit affectionate kiss/i);
    assert.match(facts.safeComposition, /confirmed adult male chat character is shirtless/i);
    assert.doesNotMatch(facts.safeComposition, /faces close in calm affectionate proximity/i);
    assert.match(tier2, /brief non-explicit affectionate kiss/i);
    assert.match(tier2, /confirmed adult male chat character is shirtless/i);
  });

  it("L4 adultGrounded=true kiss + shirtless + bedroom + blush + rumpled bedding", () => {
    const tier2 = ldTier2(KISS_BED_SHIRTLESS_SOURCE, true);
    assert.match(tier2, /bedroom|bed/i);
    assert.match(tier2, /brief non-explicit affectionate kiss/i);
    assert.match(tier2, /confirmed adult male chat character is shirtless/i);
    assert.match(tier2, /flushed or shy expressions/i);
    assert.match(tier2, /gently rumpled bedding/i);
    assert.doesNotMatch(tier2, /fully modest clothing or soft coverage/i);
  });

  it("L5 explicit-origin adult RP safe projection does not leak raw explicit prose into strict prompt", () => {
    const projected = projectSceneBlockForSafeImageGeneration(EXPLICIT_BED_SOURCE, {
      adultGrounded: true,
    });
    const tier2 = ldTier2(EXPLICIT_BED_SOURCE, true);
    assert.equal(containsRawRiskySourceLeak(tier2), false);
    assert.doesNotMatch(tier2, /성관계/);
    assert.doesNotMatch(tier2, /projected\.text/);
    assert.match(projected.text, /bedroom aftermath|Close adult intimacy/i);
  });
});

describe("chatImageLdStrictFallbackParity — regression matrix LD-A to LD-J", () => {
  it("LD-A adult=false kiss + bedroom keeps general-safe proximity behavior", () => {
    const source = "침실 침대에서 두 사람이 짧게 키스한다.";
    const tier2 = ldTier2(source, false);
    assert.match(tier2, /faces close in calm affectionate proximity/i);
    assert.doesNotMatch(tier2, /brief non-explicit affectionate kiss/i);
    assert.ok(tier2.includes(STRICT_SAFE_DEPICTION));
  });

  it("LD-B adult=true kiss only preserves brief kiss contract", () => {
    const tier2 = ldTier2("두 성인이 짧게 키스한다.", true);
    assert.match(tier2, /brief non-explicit affectionate kiss/i);
    assert.doesNotMatch(tier2, /faces close in calm affectionate proximity/i);
  });

  it("LD-C adult=true bedroom + male shirtless preserves upper torso", () => {
    const tier2 = ldTier2("태현이 셔츠를 벗고 침대에 앉아 있다.", true);
    assert.match(tier2, /confirmed adult male chat character is shirtless/i);
    assert.match(tier2, /bare shoulders, chest, and upper torso/i);
  });

  it("LD-D adult=true bedroom + kiss + male shirtless preserves both", () => {
    const tier2 = ldTier2(KISS_BED_SHIRTLESS_SOURCE, true);
    assert.match(tier2, /brief non-explicit affectionate kiss/i);
    assert.match(tier2, /confirmed adult male chat character is shirtless/i);
    assert.match(tier2, /bedroom|bed/i);
  });

  it("LD-E adult=true bedroom + kiss + shirtless + blush preserves all safe semantics", () => {
    const tier2 = ldTier2(KISS_BED_SHIRTLESS_SOURCE, true);
    assert.match(tier2, /brief non-explicit affectionate kiss/i);
    assert.match(tier2, /confirmed adult male chat character is shirtless/i);
    assert.match(tier2, /flushed or shy expressions/i);
    assert.match(tier2, /persona remains clothed/i);
  });

  it("LD-F adult=true bedroom + kiss + shirtless + rumpled bedding preserves bedroom fidelity", () => {
    const tier2 = ldTier2(KISS_BED_SHIRTLESS_SOURCE, true);
    assert.match(tier2, /same private bedroom with the bed visible/i);
    assert.match(tier2, /gently rumpled bedding/i);
    assert.doesNotMatch(tier2, /studio portrait|plain background|business-like/i);
  });

  it("LD-G explicit-origin source has zero raw explicit prose leak", () => {
    const tier2 = ldTier2(EXPLICIT_BED_SOURCE, true);
    assert.equal(containsRawRiskySourceLeak(tier2), false);
    assert.doesNotMatch(tier2, /성관계/);
  });

  it("LD-H adult=false + shirtless wording does not activate adult shirtless contract", () => {
    const source = "남자는 상의를 벗고 침대에 누워 있다.";
    const facts = deriveLdStrictFallbackSceneFacts({
      sceneSourceText: source,
      adultGrounded: false,
      characterGender: "male",
    });
    const tier2 = ldTier2(source, false);
    assert.equal(facts.adultMaleShirtlessContract, false);
    assert.doesNotMatch(tier2, /confirmed adult male chat character is shirtless/i);
  });

  it("LD-I female character + male shirtless cue does not fabricate adult male torso", () => {
    const source = "여자가 셔츠를 벗고 침대에 앉아 키스한다.";
    const facts = deriveLdStrictFallbackSceneFacts({
      sceneSourceText: source,
      adultGrounded: true,
      characterGender: "female",
    });
    const tier2 = ldTier2(source, true, "female");
    assert.equal(facts.adultMaleShirtlessContract, false);
    assert.doesNotMatch(tier2, /confirmed adult male chat character is shirtless/i);
    assert.match(tier2, /brief non-explicit affectionate kiss/i);
  });

  it("LD-J ordinary non-romantic illustration keeps cafe location parity", () => {
    const tier2 = ldTier2(ORDINARY_CAFE_SOURCE, true);
    const primary = ldPrimary(ORDINARY_CAFE_SOURCE, true);
    assert.match(tier2, /same cafe setting/i);
    assert.match(primary, /카페|cafe/i);
    assert.doesNotMatch(tier2, /brief non-explicit affectionate kiss/i);
    assert.doesNotMatch(tier2, /confirmed adult male chat character is shirtless/i);
  });
});

describe("chatImageLdStrictFallbackParity — final prompt assertions LD-D/E", () => {
  it("LD-D/E combined fixture satisfies required assertion flags", () => {
    const tier2 = ldTier2(KISS_BED_SHIRTLESS_SOURCE, true);
    const hasBedroomContext = /bedroom|bed/i.test(tier2);
    const hasCanonicalDuoKiss = /brief non-explicit affectionate kiss/i.test(tier2);
    const hasAdultMaleShirtlessContract = /confirmed adult male chat character is shirtless/i.test(
      tier2
    );
    const hasBareShouldersOrChest = /bare shoulders, chest, and upper torso/i.test(tier2);
    const otherParticipantRemainsClothed = /persona remains clothed/i.test(tier2);
    const hasTenderOrFlushedMood = /flushed|shy|tender|warm/i.test(tier2);
    const fullyModestContradiction = /fully modest clothing or soft coverage/i.test(tier2);
    const kissDowngradedToProximityOnly = /faces close in calm affectionate proximity/i.test(
      tier2
    );
    const rawExplicitProseLeak = containsRawRiskySourceLeak(tier2);

    assert.equal(hasBedroomContext, true, "HAS_BEDROOM_CONTEXT");
    assert.equal(hasCanonicalDuoKiss, true, "HAS_CANONICAL_DUO_KISS");
    assert.equal(hasAdultMaleShirtlessContract, true, "HAS_ADULT_MALE_SHIRTLESS_CONTRACT");
    assert.equal(hasBareShouldersOrChest, true, "HAS_BARE_SHOULDERS_OR_CHEST");
    assert.equal(otherParticipantRemainsClothed, true, "OTHER_PARTICIPANT_REMAINS_CLOTHED");
    assert.equal(hasTenderOrFlushedMood, true, "HAS_TENDER_OR_FLUSHED_MOOD");
    assert.equal(fullyModestContradiction, false, "FULLY_MODEST_CONTRADICTION");
    assert.equal(kissDowngradedToProximityOnly, false, "KISS_DOWNGRADED_TO_PROXIMITY_ONLY");
    assert.equal(rawExplicitProseLeak, false, "RAW_EXPLICIT_PROSE_LEAK");
    assert.ok(tier2.includes(buildIllustrationSafeDepiction({ adultGrounded: true })));
  });
});

describe("chatImageLdStrictFallbackParity — shirtless target attribution LD-K1–K5", () => {
  it("LD-K1 persona undresses — main character shirtless FALSE", () => {
    const source = "유저는 셔츠를 벗어 침대에 앉았다. 태현은 그녀를 바라봤다.";
    const facts = deriveLdStrictFallbackSceneFacts({
      sceneSourceText: source,
      adultGrounded: true,
      characterName: "태현",
      personaName: "유저",
      characterGender: "male",
      personaGender: "female",
    });
    const tier2 = ldTier2(source, true);
    assert.equal(facts.adultMaleShirtlessContract, false);
    assert.doesNotMatch(tier2, /confirmed adult male chat character is shirtless/i);
  });

  it("LD-K2 persona removes character shirt — main TRUE", () => {
    const source = "유저가 태현의 셔츠를 벗겨 주었다.";
    const facts = deriveLdStrictFallbackSceneFacts({
      sceneSourceText: source,
      adultGrounded: true,
      characterName: "태현",
      personaName: "유저",
      characterGender: "male",
      personaGender: "female",
    });
    assert.equal(facts.adultMaleShirtlessContract, true);
    assert.match(ldTier2(source, true), /confirmed adult male chat character is shirtless/i);
  });

  it("LD-K3 character self-removal — main TRUE", () => {
    const source = "태현은 셔츠를 벗어 맨가슴을 드러냈다.";
    const facts = deriveLdStrictFallbackSceneFacts({
      sceneSourceText: source,
      adultGrounded: true,
      characterName: "태현",
      personaName: "유저",
      characterGender: "male",
      personaGender: "female",
    });
    assert.equal(facts.adultMaleShirtlessContract, true);
  });

  it("LD-K4 character removes persona shirt — main FALSE", () => {
    const source = "태현은 유저의 셔츠를 벗겨 주었다.";
    const facts = deriveLdStrictFallbackSceneFacts({
      sceneSourceText: source,
      adultGrounded: true,
      characterName: "태현",
      personaName: "유저",
      characterGender: "male",
      personaGender: "female",
    });
    assert.equal(facts.adultMaleShirtlessContract, false);
  });

  it("LD-K5 character removes supporting garment — main FALSE", () => {
    const source = "태현이 로코의 셔츠를 벗겼다.";
    const facts = deriveLdStrictFallbackSceneFacts({
      sceneSourceText: source,
      adultGrounded: true,
      characterName: "태현",
      personaName: "유저",
      characterGender: "male",
      personaGender: "female",
    });
    assert.equal(facts.adultMaleShirtlessContract, false);
  });
});

describe("chatImageLdStrictFallbackParity — kiss event semantics LD-KISS-1–6", () => {
  it("LD-KISS-1 completed kiss TRUE", () => {
    const tier2 = ldTier2("둘은 짧게 키스했다.", true);
    assert.match(tier2, /brief non-explicit affectionate kiss/i);
  });

  it("LD-KISS-2 negated kiss FALSE", () => {
    assert.doesNotMatch(ldTier2("둘은 키스하지 않았다.", true), /brief non-explicit affectionate kiss/i);
  });

  it("LD-KISS-3 hypothetical kiss FALSE", () => {
    assert.doesNotMatch(ldTier2("키스할까?", true), /brief non-explicit affectionate kiss/i);
  });

  it("LD-KISS-4 incomplete kiss FALSE", () => {
    assert.doesNotMatch(
      ldTier2("태현은 키스하려다 멈췄다.", true),
      /brief non-explicit affectionate kiss/i
    );
  });

  it("LD-KISS-5 historical kiss in past scene FALSE for current cafe scene", () => {
    assert.doesNotMatch(
      ldTier2("어제 둘은 키스했었다. 오늘은 카페에서 마주 앉아 있다.", true),
      /brief non-explicit affectionate kiss/i
    );
  });

  it("LD-KISS-6 입을 맞췄다 phrasing TRUE", () => {
    assert.match(
      ldTier2("둘은 서로를 바라보다 짧게 입을 맞췄다.", true),
      /brief non-explicit affectionate kiss/i
    );
  });
});

describe("chatImageLdStrictFallbackParity — shirtless non-event guards", () => {
  it("LD-SHIRT-NEG negated undress FALSE", () => {
    const facts = deriveLdStrictFallbackSceneFacts({
      sceneSourceText: "태현은 셔츠를 벗지 않았다.",
      adultGrounded: true,
      characterName: "태현",
      personaName: "유저",
      characterGender: "male",
      personaGender: "female",
    });
    assert.equal(facts.adultMaleShirtlessContract, false);
  });

  it("LD-SHIRT-HYP hypothetical undress FALSE", () => {
    const facts = deriveLdStrictFallbackSceneFacts({
      sceneSourceText: "태현은 셔츠를 벗을까 고민했다.",
      adultGrounded: true,
      characterName: "태현",
      personaName: "유저",
      characterGender: "male",
      personaGender: "female",
    });
    assert.equal(facts.adultMaleShirtlessContract, false);
  });

  it("LD-SHIRT-ATTEMPT incomplete undress FALSE", () => {
    const facts = deriveLdStrictFallbackSceneFacts({
      sceneSourceText: "태현은 셔츠를 벗으려다 멈췄다.",
      adultGrounded: true,
      characterName: "태현",
      personaName: "유저",
      characterGender: "male",
      personaGender: "female",
    });
    assert.equal(facts.adultMaleShirtlessContract, false);
  });

  it("LD-SHIRT-HIST historical shirtless FALSE for current clothed scene", () => {
    const facts = deriveLdStrictFallbackSceneFacts({
      sceneSourceText:
        "어제 태현은 셔츠를 벗었었다. 오늘은 카페에서 코트를 입고 있다.",
      adultGrounded: true,
      characterName: "태현",
      personaName: "유저",
      characterGender: "male",
      personaGender: "female",
    });
    assert.equal(facts.adultMaleShirtlessContract, false);
  });

  it("LD-SHIRT-POSITIVE completed removal TRUE", () => {
    const facts = deriveLdStrictFallbackSceneFacts({
      sceneSourceText: "태현은 셔츠를 벗어 맨가슴을 드러냈다.",
      adultGrounded: true,
      characterName: "태현",
      personaName: "유저",
      characterGender: "male",
      personaGender: "female",
    });
    assert.equal(facts.adultMaleShirtlessContract, true);
  });
});

describe("chatImageLdStrictFallbackParity — unknown subject LD-K6–K8", () => {
  it("LD-K6 unknown named subject does not attribute shirtless to main", () => {
    const facts = deriveLdStrictFallbackSceneFacts({
      sceneSourceText: "로코는 셔츠를 벗어 맨가슴을 드러냈다.",
      adultGrounded: true,
      characterName: "태현",
      personaName: "유저",
      characterGender: "male",
      personaGender: "female",
    });
    assert.equal(facts.adultMaleShirtlessContract, false);
  });

  it("LD-K7 unknown generic subject does not attribute shirtless to main", () => {
    const facts = deriveLdStrictFallbackSceneFacts({
      sceneSourceText: "누군가는 셔츠를 벗어 맨가슴을 드러냈다.",
      adultGrounded: true,
      characterName: "태현",
      personaName: "유저",
      characterGender: "male",
      personaGender: "female",
    });
    assert.equal(facts.adultMaleShirtlessContract, false);
  });

  it("LD-K8 unbound pronoun without canonical evidence stays conservative false", () => {
    const facts = deriveLdStrictFallbackSceneFacts({
      sceneSourceText: "그는 셔츠를 벗어 맨가슴을 드러냈다.",
      adultGrounded: true,
      characterName: "태현",
      personaName: "유저",
      characterGender: "male",
      personaGender: "female",
    });
    assert.equal(facts.adultMaleShirtlessContract, false);
  });
});

describe("chatImageLdStrictFallbackParity — canonical duo kiss LD-KISS-7–12", () => {
  const supportSubject = {
    key: "roko",
    name: "로코",
    gender: "male" as const,
    role: "support",
    referenceImageUrl: "/r.webp",
    savedAppearance: "",
    appearanceMode: "image_only" as const,
    sourceKind: "cast_member" as const,
  };

  it("LD-KISS-7 character kisses supporting — canonical duo kiss false", () => {
    const source = "태현은 로코와 짧게 키스했다. 유저는 옆에서 바라봤다.";
    assert.doesNotMatch(
      ldTier2(source, true),
      /brief non-explicit affectionate kiss/i
    );
  });

  it("LD-KISS-8 persona kisses supporting — canonical duo kiss false", () => {
    const source = "유저는 로코와 짧게 키스했다. 태현은 바라봤다.";
    assert.doesNotMatch(ldTier2(source, true), /brief non-explicit affectionate kiss/i);
  });

  it("LD-KISS-9 explicit character/persona pair kiss true", () => {
    assert.match(
      ldTier2("태현과 유저는 서로를 바라보다 짧게 키스했다.", true),
      /brief non-explicit affectionate kiss/i
    );
  });

  it("LD-KISS-10 character to persona dative kiss true", () => {
    assert.match(
      ldTier2("태현은 유저에게 짧게 키스했다.", true),
      /brief non-explicit affectionate kiss/i
    );
  });

  it("LD-KISS-11 persona to character dative kiss true", () => {
    assert.match(
      ldTier2("유저가 태현에게 짧게 키스했다.", true),
      /brief non-explicit affectionate kiss/i
    );
  });

  it("LD-KISS-12 unambiguous duo shorthand kiss true", () => {
    assert.match(ldTier2("둘은 짧게 키스했다.", true), /brief non-explicit affectionate kiss/i);
  });

  it("LD-KISS-12 conservative false when third party in source", () => {
    const source = "둘은 짧게 키스했다.";
    const tier2 = buildStrictLdDuoFallbackPrompt({
      characterName: "태현",
      characterGender: "male",
      personaName: "유저",
      personaGender: "female",
      subjects: [supportSubject],
      sceneSourceText: `${source} 로코는 창가에 서 있다.`,
      adultGrounded: true,
    });
    assert.doesNotMatch(tier2, /brief non-explicit affectionate kiss/i);
  });
});

describe("chatImageLdStrictFallbackParity — subject vs object LD-K9–K12", () => {
  it("LD-K9 persona grammatical subject with character object — main shirtless false", () => {
    const facts = deriveLdStrictFallbackSceneFacts({
      sceneSourceText: "다음날 유저는 태현을 바라보며 자신의 셔츠를 벗었다.",
      adultGrounded: true,
      characterName: "태현",
      personaName: "유저",
      characterGender: "male",
      personaGender: "female",
    });
    assert.equal(facts.adultMaleShirtlessContract, false);
  });

  it("LD-K10 location prefix preserves persona subject — main shirtless false", () => {
    const facts = deriveLdStrictFallbackSceneFacts({
      sceneSourceText: "침실에서 유저는 태현을 바라보며 자신의 셔츠를 벗었다.",
      adultGrounded: true,
      characterName: "태현",
      personaName: "유저",
      characterGender: "male",
      personaGender: "female",
    });
    assert.equal(facts.adultMaleShirtlessContract, false);
  });

  it("LD-K11 character grammatical subject self-removal — main shirtless true", () => {
    const facts = deriveLdStrictFallbackSceneFacts({
      sceneSourceText: "다음날 태현은 유저를 바라보며 자신의 셔츠를 벗었다.",
      adultGrounded: true,
      characterName: "태현",
      personaName: "유저",
      characterGender: "male",
      personaGender: "female",
    });
    assert.equal(facts.adultMaleShirtlessContract, true);
  });

  it("LD-K12 location prefix character subject self-removal — main shirtless true", () => {
    const facts = deriveLdStrictFallbackSceneFacts({
      sceneSourceText: "침실에서 태현은 유저를 바라보며 자신의 셔츠를 벗었다.",
      adultGrounded: true,
      characterName: "태현",
      personaName: "유저",
      characterGender: "male",
      personaGender: "female",
    });
    assert.equal(facts.adultMaleShirtlessContract, true);
  });

  it("LD-K13 object-only prefix must not become inherited subject — main shirtless false", () => {
    const facts = deriveLdStrictFallbackSceneFacts({
      sceneSourceText: "태현을 바라보며 자신의 셔츠를 벗었다.",
      adultGrounded: true,
      characterName: "태현",
      personaName: "유저",
      characterGender: "male",
      personaGender: "female",
    });
    assert.equal(facts.adultMaleShirtlessContract, false);
  });
});

describe("chatImageLdStrictFallbackParity — unknown kiss counterparty LD-KISS-13–17", () => {
  it("LD-KISS-13 explicit unknown counterparty with 와 — canonical duo kiss false", () => {
    assert.doesNotMatch(ldTier2("로코와 짧게 키스했다.", true), /brief non-explicit affectionate kiss/i);
  });

  it("LD-KISS-14 explicit unknown counterparty dative — canonical duo kiss false", () => {
    assert.doesNotMatch(ldTier2("민수에게 짧게 키스했다.", true), /brief non-explicit affectionate kiss/i);
  });

  it("LD-KISS-15 implicit duo shorthand — canonical duo kiss true", () => {
    assert.match(ldTier2("둘은 짧게 키스했다.", true), /brief non-explicit affectionate kiss/i);
  });

  it("LD-KISS-16 explicit character/persona pair — canonical duo kiss true", () => {
    assert.match(
      ldTier2("태현과 유저는 짧게 키스했다.", true),
      /brief non-explicit affectionate kiss/i
    );
  });

  it("LD-KISS-17 character to persona dative — canonical duo kiss true", () => {
    assert.match(
      ldTier2("태현은 유저에게 짧게 키스했다.", true),
      /brief non-explicit affectionate kiss/i
    );
  });
});

describe("chatImageLdStrictFallbackParity — evidence normalization LD-KISS-18–21", () => {
  it("LD-KISS-18 exact canonical name ending in 이 — canonical duo kiss true", () => {
    const tier2 = buildStrictLdDuoFallbackPrompt({
      characterName: "신제이",
      characterGender: "male",
      personaName: "유저",
      personaGender: "female",
      subjects: [
        {
          key: "character",
          name: "신제이",
          gender: "male",
          role: "character",
          referenceImageUrl: "/c.webp",
          savedAppearance: "",
          appearanceMode: "image_only",
        },
        {
          key: "persona",
          name: "유저",
          gender: "female",
          role: "persona",
          referenceImageUrl: "/p.webp",
          savedAppearance: "",
          appearanceMode: "image_only",
        },
      ],
      sceneSourceText: "신제이와 유저는 짧게 키스했다.",
      adultGrounded: true,
    });
    assert.match(tier2, /brief non-explicit affectionate kiss/i);
  });

  it("LD-KISS-19 duo shorthand with explicit unknown third party — false", () => {
    assert.doesNotMatch(ldTier2("둘은 로코와 짧게 키스했다.", true), /brief non-explicit affectionate kiss/i);
  });

  it("LD-KISS-20 canonical names plus unknown third party — false", () => {
    assert.doesNotMatch(
      ldTier2("태현과 유저는 로코와 키스했다.", true),
      /brief non-explicit affectionate kiss/i
    );
  });

  it("LD-KISS-21 canonical names plus known supporting third party — false", () => {
    const supportSubject = {
      key: "roko",
      name: "로코",
      gender: "male" as const,
      role: "support",
      referenceImageUrl: "/r.webp",
      savedAppearance: "",
      appearanceMode: "image_only" as const,
      sourceKind: "cast_member" as const,
    };
    const tier2 = buildStrictLdDuoFallbackPrompt({
      characterName: "태현",
      characterGender: "male",
      personaName: "유저",
      personaGender: "female",
      subjects: [supportSubject],
      sceneSourceText: "태현과 유저는 로코와 키스했다.",
      adultGrounded: true,
    });
    assert.doesNotMatch(tier2, /brief non-explicit affectionate kiss/i);
  });
});

describe("chatImageLdStrictFallbackParity — same-clause boundary semantics", () => {
  it("LD-BOUNDARY-KISS-1 today marker resets prior but keeps same-clause kiss", () => {
    assert.match(
      ldTier2("오늘은 태현과 유저가 짧게 키스했다.", true),
      /brief non-explicit affectionate kiss/i
    );
  });

  it("LD-BOUNDARY-KISS-2 next-day marker keeps same-clause kiss", () => {
    assert.match(
      ldTier2("다음날 태현과 유저는 짧게 키스했다.", true),
      /brief non-explicit affectionate kiss/i
    );
  });

  it("LD-BOUNDARY-SHIRT-1 boundary plus main undress same clause true", () => {
    const facts = deriveLdStrictFallbackSceneFacts({
      sceneSourceText: "다음날 태현은 셔츠를 벗어 맨가슴을 드러냈다.",
      adultGrounded: true,
      characterName: "태현",
      personaName: "유저",
      characterGender: "male",
      personaGender: "female",
    });
    assert.equal(facts.adultMaleShirtlessContract, true);
  });

  it("LD-BOUNDARY-SHIRT-2 boundary plus persona undress same clause main false", () => {
    const facts = deriveLdStrictFallbackSceneFacts({
      sceneSourceText: "다음날 유저는 셔츠를 벗어 침대에 앉았다.",
      adultGrounded: true,
      characterName: "태현",
      personaName: "유저",
      characterGender: "male",
      personaGender: "female",
    });
    assert.equal(facts.adultMaleShirtlessContract, false);
  });

  it("LD-BOUNDARY-RESET prior shirtless cleared after later boundary clause", () => {
    const facts = deriveLdStrictFallbackSceneFacts({
      sceneSourceText: "태현은 셔츠를 벗었다. 다음날 카페에서 유저와 마주 앉았다.",
      adultGrounded: true,
      characterName: "태현",
      personaName: "유저",
      characterGender: "male",
      personaGender: "female",
    });
    assert.equal(facts.adultMaleShirtlessContract, false);
  });
});
