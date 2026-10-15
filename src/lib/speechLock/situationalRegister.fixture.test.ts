import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadCompiledOfficialCharacterSource } from "@/lib/officialSupply/compiledOfficialSource";
import {
  buildCreatorSpeechProfilePartial,
  composeExampleDialog,
  extractDialogueLinesForProfile,
  extractEndingAnchors,
} from "@/lib/speechCreatorFields";
import { formatSpeechSectionAsMetadata } from "@/lib/speechMetadataPolicy";
import {
  DERIVED_BANMAL_BAN,
  DERIVED_INTRA_TURN_SWITCH_BAN,
  DERIVED_NOBLE_CASUAL_BAN,
  DERIVED_SAME_ADDRESSEE_SWITCH_BAN,
  deriveSpeechProfile,
  parseStoredSpeechProfile,
  resolveCreatorFormalityIntent,
  serializeSpeechProfile,
} from "@/lib/speechLock/deriveProfile";
import { validateSpeechLock } from "@/lib/speechLock/validator";
import { buildCombinedCharacterSettingSource } from "@/utils/characterParser";

const SITUATIONAL_CREATOR = {
  speech_personality:
    "존댓말은 예의라기보다 심문의 틀로 쓰고, 부하나 오랜 동료에게는 군더더기 없는 반말이 섞인다.",
  speech_traits:
    "구어체: 공식 심문·작전 중에는 딱딱한 존댓말과 명령형을 쓴다. 부하와 오래된 동료에게는 짧은 반말이 섞이며, 상대의 지위보다 책임을 먼저 따진다.\n어휘: 보급·경계·증거·책임 같은 실무 어휘를 즐겨 쓴다.",
  speech_examples: [
    "“신원을 확인하겠습니다. 자리에 앉아 주십시오.”",
    "“탄약 수량부터 다시 세. 추측은 보고서에 적지 마.”",
    "“그 판단은 네가 해. 대신 결과가 나면 나한테 숨기지 마.”",
    "“기록하겠습니다.”",
  ].join("\n"),
  speech_forbidden:
    "상황과 무관한 장광설, 시적인 독백, 유행어와 과한 감탄사. 친한 척하는 반말로 성격을 바꾸지 않는다.",
  speech_contextual_registers: [
    {
      label: "공식 심문",
      condition: "공식 심문·외교 상대",
      style: "짧고 단호한 존댓말",
      examples: "신원을 확인하겠습니다.",
    },
    {
      label: "부하",
      condition: "부하에게 지시할 때",
      style: "짧고 단호한 반말",
      examples: "탄약부터 다시 세.",
    },
    {
      label: "오랜 동료",
      condition: "오랜 동료와 실무를 나눌 때",
      style: "짧은 반말",
      examples: "그 판단은 네가 해.",
    },
  ],
};

const INTERROGATION_LINE = '"신원을 확인하겠습니다. 자리에 앉아 주십시오."';
const SUBORDINATE_LINE = '"탄약부터 다시 세. 추측은 보고서에 적지 마."';
const CASUAL_DRIFT_LINE = '"그게 아니야!"';
const SAME_TURN_BOTH = [
  "볼프강이 심문 상대에게 말했다.",
  INTERROGATION_LINE,
  "그는 부하를 돌아보며 짧게 지시했다.",
  SUBORDINATE_LINE,
].join("\n");

function deriveFromCreator(
  input: typeof SITUATIONAL_CREATOR,
  extra?: {
    name?: string;
    world?: string;
    storedProfile?: Parameters<typeof deriveSpeechProfile>[0]["storedProfile"];
  }
) {
  const name = extra?.name ?? "지휘관";
  const exampleDialog = composeExampleDialog(input);
  const storedProfile =
    extra?.storedProfile ?? buildCreatorSpeechProfilePartial(input, name);
  return {
    exampleDialog,
    storedProfile,
    profile: deriveSpeechProfile({
      charName: name,
      chunks: [
        {
          id: "speech",
          characterId: "fixture",
          content: `${input.speech_personality}\n${input.speech_traits}`,
          category: "speech",
          importance: "CONTEXTUAL",
          tokenCount: 20,
          keywords: [],
        },
      ],
      exampleDialog,
      world: extra?.world ?? "북부 귀족 대공이 방벽을 지킨다.",
      storedProfile,
    }),
  };
}

describe("situational register owner fixture", () => {
  it("detects interrogation/subordinate/colleague as situational, not a single formal lock", () => {
    const intent = resolveCreatorFormalityIntent(
      `${SITUATIONAL_CREATOR.speech_personality}\n${SITUATIONAL_CREATOR.speech_traits}`,
      SITUATIONAL_CREATOR.speech_contextual_registers
    );
    assert.equal(intent, "situational");
  });

  it("save → profile → metadata → validator keeps intended registers and drops conflicting derived bans", () => {
    const { exampleDialog, profile } = deriveFromCreator(SITUATIONAL_CREATOR);
    const traitsMeta = formatSpeechSectionAsMetadata(
      "[말투 — 특징]",
      SITUATIONAL_CREATOR.speech_traits
    );
    const personalityMeta = formatSpeechSectionAsMetadata(
      "[말투 — 성격]",
      SITUATIONAL_CREATOR.speech_personality
    );
    const wire = buildCombinedCharacterSettingSource({
      characterId: "fixture",
      characterName: "지휘관",
      gender: "male",
      systemPrompt: "북부 방벽 지휘관.",
      world: "귀족 대공이 방벽을 지킨다.",
      exampleDialog,
    });

    assert.notEqual(profile.speech_formality, "formal");
    assert.ok(!profile.forbidden_speech_patterns.includes(DERIVED_BANMAL_BAN));
    assert.ok(!profile.forbidden_speech_patterns.includes(DERIVED_INTRA_TURN_SWITCH_BAN));
    assert.ok(profile.forbidden_speech_patterns.includes(DERIVED_SAME_ADDRESSEE_SWITCH_BAN));
    assert.ok(profile.forbidden_speech_patterns.some((item) => /장광설/.test(item)));

    assert.match(traitsMeta, /공식 심문·작전 중에는 딱딱한 존댓말/);
    assert.match(traitsMeta, /부하와 오래된 동료에게는 짧은 반말/);
    assert.doesNotMatch(traitsMeta, /구어체 → 반말\s*$/m);
    assert.doesNotMatch(personalityMeta, /default_register/);
    assert.match(exampleDialog, /공식 심문·작전 중에는 딱딱한 존댓말/);
    assert.match(exampleDialog, /부하와 오래된 동료에게는 짧은 반말/);
    assert.match(wire, /공식 심문·작전 중에는 딱딱한 존댓말/);
    assert.doesNotMatch(wire, /구어체 → 반말\s*$/m);

    assert.equal(validateSpeechLock(INTERROGATION_LINE, profile).valid, true);
    assert.equal(validateSpeechLock(SUBORDINATE_LINE, profile).valid, true);
    assert.equal(validateSpeechLock(SAME_TURN_BOTH, profile).shouldRewrite, false);
  });

  it("repairs a previously saved formal+banmal-ban profile on the read path", () => {
    const { profile } = deriveFromCreator(SITUATIONAL_CREATOR, {
      storedProfile: {
        speech_formality: "formal",
        social_class: "nobility",
        forbidden_speech_patterns: [
          DERIVED_BANMAL_BAN,
          DERIVED_INTRA_TURN_SWITCH_BAN,
          "상황과 무관한 장광설",
        ],
        creator_personality: SITUATIONAL_CREATOR.speech_personality,
        creator_speech_traits: SITUATIONAL_CREATOR.speech_traits,
        dialogue_examples: [
          "신원을 확인하겠습니다. 자리에 앉아 주십시오.",
          "탄약 수량부터 다시 세. 추측은 보고서에 적지 마.",
        ],
        ending_anchors: ["겠다", "지 마", "했나", "다"],
      },
    });

    assert.notEqual(profile.speech_formality, "formal");
    assert.ok(!profile.forbidden_speech_patterns.includes(DERIVED_BANMAL_BAN));
    assert.ok(!profile.forbidden_speech_patterns.includes(DERIVED_INTRA_TURN_SWITCH_BAN));
    assert.ok(profile.forbidden_speech_patterns.some((item) => /장광설/.test(item)));
    assert.deepEqual(extractEndingAnchors(profile.dialogue_examples), profile.ending_anchors ?? []);
    assert.ok(!(profile.ending_anchors ?? []).includes("겠다"));
    assert.ok(!(profile.ending_anchors ?? []).includes("지 마"));
  });

  it("keeps an explicit always-formal noble lock, including same-addressee drift", () => {
    const creator = {
      speech_personality: "항상 존댓말만 쓴다. 반말은 하지 않는다.",
      speech_traits: "공적인 자리와 사적인 자리 모두 격식 있는 존댓말.",
      speech_examples: "“알겠습니다. 바로 확인하겠습니다.”",
      speech_forbidden: "",
      speech_contextual_registers: [],
    };
    const { profile } = deriveFromCreator(creator, { name: "귀족", world: "왕국 공작" });
    assert.equal(profile.speech_formality, "formal");
    assert.ok(profile.forbidden_speech_patterns.includes(DERIVED_BANMAL_BAN));
    assert.equal(validateSpeechLock(CASUAL_DRIFT_LINE, profile).shouldRewrite, true);
    assert.equal(validateSpeechLock('"바로 확인하겠습니다."', profile).valid, true);
  });

  it("keeps an explicit always-informal intent even when the world is noble", () => {
    const creator = {
      speech_personality: "항상 반말만 쓴다. 존댓말은 쓰지 않는다.",
      speech_traits: "짧고 거친 반말.",
      speech_examples: "“앉아. 설명은 나중에 해.”",
      speech_forbidden: "",
      speech_contextual_registers: [],
    };
    const { profile } = deriveFromCreator(creator, { name: "귀족", world: "왕국 공작" });
    assert.equal(profile.speech_formality, "informal");
    assert.ok(!profile.forbidden_speech_patterns.includes(DERIVED_BANMAL_BAN));
    assert.equal(validateSpeechLock(CASUAL_DRIFT_LINE, profile).valid, true);
  });

  it("does not invent a private-banmal rule from empty or blank creator speech", () => {
    const { profile } = deriveFromCreator(
      {
        speech_personality: "",
        speech_traits: "",
        speech_examples: "",
        speech_forbidden: "",
        speech_contextual_registers: [],
      },
      { world: "" }
    );
    assert.ok(profile.charName);
    assert.equal(profile.dialogue_examples.length, 0);
    assert.ok(!profile.forbidden_speech_patterns.includes(DERIVED_BANMAL_BAN));
  });

  it("preserves Wolfgang and Lucian public speech conditions through compile → example dialog", () => {
    const wolfgang = loadCompiledOfficialCharacterSource("pilot-rf-02");
    const lucian = loadCompiledOfficialCharacterSource("pilot-rf-03");
    const wolfgangDialog = composeExampleDialog({
      speech_personality: wolfgang.draft.speech.personality,
      speech_traits: wolfgang.draft.speech.traits,
      speech_examples: wolfgang.draft.speech.examples,
      speech_forbidden: wolfgang.draft.speech.forbidden,
    });
    const lucianDialog = composeExampleDialog({
      speech_personality: lucian.draft.speech.personality,
      speech_traits: lucian.draft.speech.traits,
      speech_examples: lucian.draft.speech.examples,
      speech_forbidden: lucian.draft.speech.forbidden,
    });
    const wolfgangProfile = deriveSpeechProfile({
      charName: wolfgang.draft.name,
      chunks: [],
      exampleDialog: wolfgangDialog,
      world: "발켄하임 가주 대공",
      storedProfile: buildCreatorSpeechProfilePartial(
        {
          speech_personality: wolfgang.draft.speech.personality,
          speech_traits: wolfgang.draft.speech.traits,
          speech_examples: wolfgang.draft.speech.examples,
          speech_forbidden: wolfgang.draft.speech.forbidden,
        },
        wolfgang.draft.name
      ),
    });
    const lucianProfile = deriveSpeechProfile({
      charName: lucian.draft.name,
      chunks: [],
      exampleDialog: lucianDialog,
      world: "황실 서기관",
      storedProfile: buildCreatorSpeechProfilePartial(
        {
          speech_personality: lucian.draft.speech.personality,
          speech_traits: lucian.draft.speech.traits,
          speech_examples: lucian.draft.speech.examples,
          speech_forbidden: lucian.draft.speech.forbidden,
        },
        lucian.draft.name
      ),
    });

    assert.match(wolfgangDialog, /공식 심문·작전 중에는 딱딱한 존댓말/);
    assert.match(wolfgangDialog, /부하와 오래된 동료에게는 짧은 반말/);
    assert.doesNotMatch(wolfgangDialog, /구어체 → 반말\s*$/m);
    assert.ok(!wolfgangProfile.forbidden_speech_patterns.includes(DERIVED_BANMAL_BAN));
    assert.notEqual(wolfgangProfile.speech_formality, "formal");

    assert.match(lucianDialog, /기본은 경쾌한 존댓말/);
    assert.doesNotMatch(lucianDialog, /구어체 → 반말\s*$/m);
    assert.ok(!lucianProfile.forbidden_speech_patterns.includes(DERIVED_BANMAL_BAN));
  });
});

const toStraightQuotes = (text: string) => text.replace(/[“”]/g, '"');
const toCurlyQuotes = (text: string) => {
  let open = true;
  return text.replace(/"/g, () => {
    const mark = open ? "“" : "”";
    open = !open;
    return mark;
  });
};

const STRAIGHT_CREATOR = {
  ...SITUATIONAL_CREATOR,
  speech_examples: toStraightQuotes(SITUATIONAL_CREATOR.speech_examples),
};
const CURLY_CREATOR = {
  ...SITUATIONAL_CREATOR,
  speech_examples: toCurlyQuotes(toStraightQuotes(SITUATIONAL_CREATOR.speech_examples)),
};

const ALWAYS_FORMAL_CREATOR = {
  speech_personality: "항상 존댓말만 쓴다. 반말은 하지 않는다.",
  speech_traits: "공적인 자리와 사적인 자리 모두 격식 있는 존댓말.",
  speech_examples: "“알겠습니다. 바로 확인하겠습니다.”",
  speech_forbidden: "",
  speech_contextual_registers: [],
};

describe("quote style parity (straight vs curly)", () => {
  const variants = [
    { name: "straight", creator: STRAIGHT_CREATOR, wrap: toStraightQuotes },
    { name: "curly", creator: CURLY_CREATOR, wrap: toCurlyQuotes },
  ];

  for (const { name, creator, wrap } of variants) {
    it(`${name}: extraction and anchors are produced (check ran, not skipped)`, () => {
      assert.ok(creator.speech_examples.includes(name === "curly" ? "“" : '"'));
      const lines = extractDialogueLinesForProfile(creator.speech_examples);
      assert.equal(lines.length, 4);
      assert.ok(lines.every((line) => !/["“”]/.test(line)));
      assert.deepEqual(extractEndingAnchors(lines), ["십시오", "습니다"]);
      const { profile } = deriveFromCreator(creator);
      assert.deepEqual(profile.ending_anchors, ["십시오", "습니다"]);
      assert.equal(profile.dialogue_examples.length, 4);
    });

    it(`${name}: normal subordinate 반말 is not a violation, alone or in the same turn`, () => {
      const { profile } = deriveFromCreator(creator);
      for (const text of [
        wrap(INTERROGATION_LINE),
        wrap(SUBORDINATE_LINE),
        wrap(SAME_TURN_BOTH),
      ]) {
        const result = validateSpeechLock(text, profile);
        assert.deepEqual(result.violations, [], text);
        assert.equal(result.valid, true, text);
        assert.equal(result.shouldRewrite, false, text);
      }
    });

    it(`${name}: an always-formal profile still catches a clear 반말 violation`, () => {
      const { profile } = deriveFromCreator(ALWAYS_FORMAL_CREATOR, { name: "귀족", world: "왕국 공작" });
      assert.equal(profile.speech_formality, "formal");
      const result = validateSpeechLock(wrap(CASUAL_DRIFT_LINE), profile);
      assert.equal(result.shouldRewrite, true);
      assert.ok(result.violations.some((v) => v.type === "formality_drift"));
      assert.equal(validateSpeechLock(wrap('"바로 확인하겠습니다."'), profile).shouldRewrite, false);
    });

    it(`${name}: hybrid honorific in a quoted line is caught`, () => {
      const { profile } = deriveFromCreator(creator);
      const result = validateSpeechLock(wrap('"확인했습니다요."'), profile);
      assert.equal(result.shouldRewrite, true);
      assert.ok(result.violations.some((v) => v.type === "hybrid_honorific"));
    });
  }

  it("produces identical dialogue, anchors, formality and forbidden list for both quote styles", () => {
    const straight = deriveFromCreator(STRAIGHT_CREATOR).profile;
    const curly = deriveFromCreator(CURLY_CREATOR).profile;
    assert.deepEqual(curly.dialogue_examples, straight.dialogue_examples);
    assert.deepEqual(curly.ending_anchors, straight.ending_anchors);
    assert.equal(curly.speech_formality, straight.speech_formality);
    assert.deepEqual(curly.forbidden_speech_patterns, straight.forbidden_speech_patterns);
  });

  it("does not treat a representative-anchor mismatch as a violation", () => {
    const { profile } = deriveFromCreator(ALWAYS_FORMAL_CREATOR, { name: "귀족", world: "왕국 공작" });
    assert.deepEqual(profile.ending_anchors, ["습니다"]);
    const result = validateSpeechLock('"보고서는 내일 아침까지 올리시오."', profile);
    assert.equal(result.shouldRewrite, false);
  });

  it("reads old stored curly-quoted examples on the reload path", () => {
    const { profile } = deriveFromCreator(SITUATIONAL_CREATOR, {
      storedProfile: {
        dialogue_examples: ["“신원을 확인하겠습니다. 자리에 앉아 주십시오.”"],
      },
    });
    assert.ok(profile.dialogue_examples.every((line) => !/[“”]/.test(line)));
  });
});

describe("formality intent scope", () => {
  it("keeps conditions for 'ban in one place, use in another' without a global ban", () => {
    const text = "공식 심문에서는 반말 금지. 부하에게는 반말을 쓴다.";
    assert.equal(resolveCreatorFormalityIntent(text), "situational");
    const { profile } = deriveFromCreator({
      ...SITUATIONAL_CREATOR,
      speech_personality: text,
      speech_traits: "",
      speech_contextual_registers: [],
    });
    assert.ok(!profile.forbidden_speech_patterns.includes(DERIVED_BANMAL_BAN));
    assert.notEqual(profile.speech_formality, "formal");
  });

  it("treats 친근한 존댓말 as formal, not as 반말", () => {
    assert.equal(resolveCreatorFormalityIntent("친근한 존댓말을 쓴다."), "always_formal");
    assert.equal(resolveCreatorFormalityIntent("캐주얼한 존댓말을 쓴다."), "always_formal");
    assert.equal(resolveCreatorFormalityIntent("친근하게 말한다."), "unspecified");
  });

  it("treats base style plus a stated exception as situational", () => {
    assert.equal(
      resolveCreatorFormalityIntent("평소에는 존댓말을 쓴다. 화가 나면 반말이 튀어나온다."),
      "situational"
    );
    assert.equal(
      resolveCreatorFormalityIntent("항상 존댓말을 쓴다. 단 가족에게는 반말을 쓴다."),
      "situational"
    );
  });

  it("does not promote conditional-only text to a global lock", () => {
    assert.equal(resolveCreatorFormalityIntent("공식 심문에서는 존댓말을 쓴다."), "situational");
    assert.equal(
      resolveCreatorFormalityIntent("", [
        { label: "공식", condition: "공식 심문", style: "존댓말", examples: "" },
      ]),
      "situational"
    );
  });

  it("keeps confirmed global statements global", () => {
    assert.equal(resolveCreatorFormalityIntent("항상 존댓말만 쓴다. 반말은 하지 않는다."), "always_formal");
    assert.equal(resolveCreatorFormalityIntent("누구에게나 존댓말을 쓴다."), "always_formal");
    assert.equal(resolveCreatorFormalityIntent("존댓말은 쓰지 않는다. 반말만 쓴다."), "always_informal");
    assert.equal(resolveCreatorFormalityIntent("구어체: 정중한 존댓말."), "always_formal");
    assert.equal(resolveCreatorFormalityIntent(""), "unspecified");
  });
});

describe("explicit forbidden provenance", () => {
  const EXPLICIT_BAN = { ...ALWAYS_FORMAL_CREATOR, speech_forbidden: `${DERIVED_BANMAL_BAN}, 장광설` };

  it("keeps an explicit forbidden entry equal to an auto-ban string (formal intent)", () => {
    const { profile } = deriveFromCreator(EXPLICIT_BAN, { name: "귀족", world: "왕국 공작" });
    assert.ok(profile.forbidden_speech_patterns.includes(DERIVED_BANMAL_BAN));
    assert.ok(profile.forbidden_speech_patterns.includes("장광설"));
    assert.equal(profile.register_conflicts, undefined);
  });

  it("keeps an explicit ban that contradicts situational registers and surfaces the contradiction", () => {
    const { profile } = deriveFromCreator({
      ...SITUATIONAL_CREATOR,
      speech_forbidden: DERIVED_BANMAL_BAN,
    });
    assert.ok(profile.forbidden_speech_patterns.includes(DERIVED_BANMAL_BAN));
    assert.ok(profile.register_conflicts?.some((item) => item.includes(DERIVED_BANMAL_BAN)));
  });

  it("surfaces an explicit 반말 ban that contradicts the creator's own casual examples", () => {
    const { profile } = deriveFromCreator({
      ...ALWAYS_FORMAL_CREATOR,
      speech_examples: "“그건 아니야!”\n“알겠습니다.”",
      speech_forbidden: "반말",
    });
    assert.ok(profile.forbidden_speech_patterns.includes("반말"));
    assert.ok(profile.register_conflicts?.some((item) => item.includes("반말")));
  });

  it("drops only provably-derived stored labels and keeps unknown or explicit ones", () => {
    const { profile } = deriveFromCreator(SITUATIONAL_CREATOR, {
      storedProfile: {
        forbidden_speech_patterns: [DERIVED_BANMAL_BAN, DERIVED_NOBLE_CASUAL_BAN, "출처 불명 금지 문구"],
      },
    });
    assert.ok(!profile.forbidden_speech_patterns.includes(DERIVED_BANMAL_BAN));
    assert.ok(!profile.forbidden_speech_patterns.includes(DERIVED_NOBLE_CASUAL_BAN));
    assert.ok(profile.forbidden_speech_patterns.includes("출처 불명 금지 문구"));
  });

  it("edit → save → reload follows the latest creator input and is stable on reload", () => {
    const first = deriveFromCreator(ALWAYS_FORMAL_CREATOR, { name: "귀족", world: "왕국 공작" }).profile;
    assert.equal(first.speech_formality, "formal");
    assert.ok(first.forbidden_speech_patterns.includes(DERIVED_BANMAL_BAN));

    const edited = { ...SITUATIONAL_CREATOR, speech_forbidden: "과한 감탄사" };
    const exampleDialog = composeExampleDialog(edited);
    const saved = deriveSpeechProfile({
      charName: "귀족",
      chunks: [],
      exampleDialog,
      world: "왕국 공작",
      storedProfile: {
        ...parseStoredSpeechProfile(serializeSpeechProfile(first)),
        ...buildCreatorSpeechProfilePartial(edited, "귀족"),
      },
    });
    assert.notEqual(saved.speech_formality, "formal");
    assert.ok(!saved.forbidden_speech_patterns.includes(DERIVED_BANMAL_BAN));
    assert.ok(saved.forbidden_speech_patterns.includes("과한 감탄사"));

    const reloaded = deriveSpeechProfile({
      charName: "귀족",
      chunks: [],
      exampleDialog,
      world: "왕국 공작",
      storedProfile: parseStoredSpeechProfile(serializeSpeechProfile(saved)),
    });
    assert.equal(reloaded.speech_formality, saved.speech_formality);
    assert.deepEqual(reloaded.forbidden_speech_patterns, saved.forbidden_speech_patterns);
    assert.deepEqual(reloaded.dialogue_examples, saved.dialogue_examples);
    assert.deepEqual(reloaded.ending_anchors, saved.ending_anchors);
  });
});

describe("example_dialog wire keeps the creator's quote glyphs", () => {
  it("curly-quoted examples are written to example_dialog unchanged while the profile derives from normalized lines", () => {
    const exampleDialog = composeExampleDialog(CURLY_CREATOR);
    assert.match(exampleDialog, /“신원을 확인하겠습니다\. 자리에 앉아 주십시오\.”/);
    const { profile } = deriveFromCreator(CURLY_CREATOR);
    assert.ok(profile.dialogue_examples.every((line) => !/[“”]/.test(line)));
  });
});
