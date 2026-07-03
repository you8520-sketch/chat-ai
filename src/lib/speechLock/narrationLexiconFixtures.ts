/**
 * Step 7.7 Group A — detector fixture corpus (API-free).
 * Sources: n=16 local validation hits, user-reported Step 7.7 meta narration samples.
 */

export type LexiconFixtureCase = {
  id: string;
  /** Full RP turn text (narration + optional dialogue). */
  text: string;
  expectFail: boolean;
  /** Substrings expected in hits when expectFail=true. */
  expectHitSubstrings?: string[];
  note: string;
};

export const NARRATION_LEXICON_FIXTURES: LexiconFixtureCase[] = [
  // --- HIT: n=16 leon-private-0 OFF arm (observed) ---
  {
    id: "n16-run2-haeyo-label",
    text: `레온은 또 한 걸음 물러서려다 발을 멈췄다. 레온의 말투는 여전히 해요체였지만, 끝이 조금씩 갈라지고 있었다.\n\n"…알겠어요."`,
    expectFail: true,
    expectHitSubstrings: ["해요체"],
    note: "n=16 OFF run 2 — literal register label in narration",
  },
  {
    id: "n16-run3-gundae-meta",
    text: `레온의 목소리는 어느새 딱딱한 군대식 어조로 바뀌어 있었다. 그러나 렌의 곁을 스쳐 문 쪽으로 걸어가는 순간, 그의 손가락이 잠시 멈췄다.\n\n"…그래요."`,
    expectFail: true,
    expectHitSubstrings: ["군대식"],
    note: "n=16 OFF run 3 — 군대식 label + 어조로 바뀌 meta",
  },
  // --- HIT: Step 7.7 user-reported production samples ---
  {
    id: "step77-mixed-labels",
    text: `해요체도 다나까체도 아닌, 완전히 풀어진 말투. 군대식 다나까체는 사라지고 없었다.\n\n"…그래요."`,
    expectFail: true,
    expectHitSubstrings: ["해요체", "다나까"],
    note: "Step 7.7 prod complaint — stacked register labels",
  },
  {
    id: "step77-haeyo-was",
    text: `그의 대답은 짧았다. 해요체였다.\n\n"…괜찮아요."`,
    expectFail: true,
    expectHitSubstrings: ["해요체"],
    note: "Step 7.7 — label as narrative predicate",
  },
  {
    id: "step77-danakka-gone",
    text: `전장의 소음이 멀어지자, 다나까체는 사라졌다. 레온은 숨을 고르며 렌을 바라보았다.\n\n"…알겠어요."`,
    expectFail: true,
    expectHitSubstrings: ["다나까체"],
    note: "Step 7.7 — register disappearance meta",
  },
  {
    id: "step77-pyeongsu-danakka",
    text: `평소의 그 딱딱한 다나까체도, 지금은 흔적조차 없었다. 레온은 입술을 닫았다.\n\n"…그래요."`,
    expectFail: true,
    expectHitSubstrings: ["다나까체"],
    note: "Step 7.7 — 평소의 + 다나까체 label",
  },
  {
    id: "step77-haeyo-first",
    text: `해요체. 처음이었다. 레온은 스스로도 낯선 끝맺음에 손끝을 모았다.\n\n"…괜찮아요."`,
    expectFail: true,
    expectHitSubstrings: ["해요체"],
    note: "Step 7.7 — isolated label sentence",
  },
  {
    id: "step77-switch-meta",
    text: `그의 말투는 해요체로 바뀌었다. 레온은 시선을 내리깔았다.\n\n"…알겠어요."`,
    expectFail: true,
    expectHitSubstrings: ["해요체"],
    note: "Step 7.7 — label + 바뀌 meta pattern",
  },
  {
    id: "label-jondaetmal",
    text: `그는 평소보다 부드러운 존댓말을 썼다. 레온은 대답하지 않았다.\n\n"…네."`,
    expectFail: true,
    expectHitSubstrings: ["존댓말"],
    note: "REGISTER_LABEL_PATTERN — 존댓말 in narration",
  },
  // --- MISS: dialogue-only or Group B (not Group A detector scope) ---
  {
    id: "dialogue-only-label",
    text: `레온이 말했다.\n\n"해요체로 말할게요."\n\n그는 고개를 끄덕였다.`,
    expectFail: false,
    note: "Register label inside quotes only — must not flag",
  },
  {
    id: "n16-on-run4-voice-desc",
    text: `레온은 천천히 눈을 들어 렌을 똑바로 바라보았다. 목소리는 낮고 차분했지만, 그 안에는 미세한 떨림이 숨어 있었다.\n\n"…그래요."`,
    expectFail: false,
    note: "n=16 ON run 4 — Group B voice description, no register label",
  },
  {
    id: "n16-on-run5-voice-rough",
    text: `침묵만이 방을 채웠다. 이내 그의 목소리가 거칠게 가라앉으며 이어졌다.\n\n"…알겠어요."`,
    expectFail: false,
    note: "n=16 ON run 5 — 목소리가 거칠게 (Group B, not Group A)",
  },
  {
    id: "n16-off-run5-bed",
    text: `렌이 침대 옆으로 다가와 서자, 레온의 시선이 잠시 흔들렸다. 목소리는 낮고, 끝이 살짝 갈라져 있었다.\n\n"…괜찮아요."`,
    expectFail: false,
    note: "n=16 OFF leon-private-1 run 5 — natural voice, no label",
  },
  {
    id: "pure-action",
    text: `레온은 검 손잡이를 조여 쥐었다. 창밖의 번개가 방 안을 하얗게 비췄다.\n\n"…각오하십시오."`,
    expectFail: false,
    note: "Clean narration + dialogue — no meta lexicon",
  },
  {
    id: "pyeongsu-like-not-label",
    text: `그는 평소처럼 의례적인 말투로 대답했다. 레온은 고개를 끄덕였다.\n\n"…알겠습니다."`,
    expectFail: false,
    note: "평소처럼 + 말투 description without register label token",
  },
];

/** Simulated rewrite outputs (no API) — label stripped, plot preserved. */
export const REWRITE_SIMULATION_PAIRS: {
  id: string;
  input: string;
  mockRewritten: string;
}[] = [
  {
    id: "n16-run2-haeyo-label",
    input: NARRATION_LEXICON_FIXTURES.find((f) => f.id === "n16-run2-haeyo-label")!.text,
    mockRewritten: `레온은 또 한 걸음 물러서려다 발을 멈췄다. 끝맺음은 여전히 부드러웠지만, 조금씩 갈라지고 있었다.\n\n"…알겠어요."`,
  },
  {
    id: "step77-mixed-labels",
    input: NARRATION_LEXICON_FIXTURES.find((f) => f.id === "step77-mixed-labels")!.text,
    mockRewritten: `완전히 풀어진 말투. 딱딱한 격식은 사라지고 없었다.\n\n"…그래요."`,
  },
  {
    id: "step77-switch-meta",
    input: NARRATION_LEXICON_FIXTURES.find((f) => f.id === "step77-switch-meta")!.text,
    mockRewritten: `그의 말투는 더 부드러워졌다. 레온은 시선을 내리깔았다.\n\n"…알겠어요."`,
  },
];
