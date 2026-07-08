/**
 * Style mechanism patterns — structure/flow only.
 * NO content nouns, NO example sentences, NO sensory lexicon.
 * Harness/design use only.
 */

/** Beat phase in a micro-turn */
export type BeatPhase =
  | "establish"
  | "compress"
  | "exchange"
  | "withhold"
  | "reveal"
  | "pause"
  | "hook"
  | "handoff";

/** Abstract flow edge — what follows what, not what is said */
export type FlowEdge = {
  from: BeatPhase | "turn_start" | "turn_end";
  to: BeatPhase | "turn_end";
  condition?: string;
};

/** Sentence-length regime at a phase */
export type LengthRegime = "long" | "mid" | "short" | "micro";

/** One mechanism definition */
export type StyleMechanism = {
  id: string;
  title: string;
  /** When / trigger — structural, no content */
  triggers: string[];
  /** Flow pattern */
  flow: FlowEdge[];
  /** Length regime per phase */
  lengthByPhase: Partial<Record<BeatPhase, LengthRegime>>;
  /** Production prompt injection surface (design only) */
  promptSurface: (
    | "fewshot_flow"
    | "prose_rhythm"
    | "dnr"
    | "length"
    | "output_layout"
    | "turn_handoff"
    | "genre_tone"
    | "cross_turn"
  )[];
};

/** Universal micro-turn flow — genre-neutral rhythm skeleton */
export const MICRO_TURN_FLOW: FlowEdge[] = [
  { from: "turn_start", to: "establish" },
  { from: "establish", to: "exchange" },
  { from: "exchange", to: "withhold", condition: "before peak" },
  { from: "withhold", to: "reveal", condition: "after reaction beat" },
  { from: "reveal", to: "pause" },
  { from: "pause", to: "hook" },
  { from: "hook", to: "handoff" },
  { from: "handoff", to: "turn_end" },
];

export const STYLE_MECHANISMS: StyleMechanism[] = [
  {
    id: "M01",
    title: "문장 길이 — 짧아지는 시점",
    triggers: [
      "tension delta ↑ (beat 내 압력 상승)",
      "quoted speech 직전·직후",
      "question mark 직전",
      "action beat (단일 동작)",
      "연속 long 이후 1회 decompress",
    ],
    flow: [
      { from: "establish", to: "compress", condition: "tension↑" },
      { from: "compress", to: "exchange" },
    ],
    lengthByPhase: { establish: "mid", compress: "short", exchange: "micro", hook: "micro" },
    promptSurface: ["prose_rhythm", "fewshot_flow"],
  },
  {
    id: "M02",
    title: "문장 길이 — 긴 문장 시점",
    triggers: [
      "turn/beat opening (orient)",
      "tension delta ↓ (aftermath)",
      "connect two beats (bridge)",
      "low-stakes dialogue gap",
    ],
    flow: [{ from: "turn_start", to: "establish" }],
    lengthByPhase: { establish: "long", pause: "mid", handoff: "mid" },
    promptSurface: ["prose_rhythm", "length"],
  },
  {
    id: "M03",
    title: "정보 — withhold / reveal 타이밍",
    triggers: [
      "withhold: peak 직전, question 받은 직후, emotional beat 시작",
      "reveal: physical reaction 1 beat 후, dialogue pressure 후, cliff 직전 partial only",
    ],
    flow: [
      { from: "exchange", to: "withhold" },
      { from: "withhold", to: "reveal" },
      { from: "reveal", to: "hook" },
    ],
    lengthByPhase: { withhold: "short", reveal: "mid" },
    promptSurface: ["dnr", "fewshot_flow", "turn_handoff"],
  },
  {
    id: "M04",
    title: "감정 — 직접 vs 간접",
    triggers: [
      "direct: inside quotes only, or single-word utterance",
      "indirect: narration contrast (X but Y), behavior without label, environment shift as mirror",
      "never: emotion label + narration same beat",
    ],
    flow: [
      { from: "establish", to: "exchange" },
      { from: "exchange", to: "pause" },
    ],
    lengthByPhase: { exchange: "micro", pause: "mid" },
    promptSurface: ["prose_rhythm", "genre_tone"],
  },
  {
    id: "M05",
    title: "독자 시선 끊기 (cognitive break)",
    triggers: [
      "paragraph break after quoted line",
      "paragraph break before reveal",
      "single-line block at compress phase",
      "turn_end on unresolved hook",
    ],
    flow: [
      { from: "exchange", to: "pause" },
      { from: "hook", to: "turn_end" },
    ],
    lengthByPhase: { pause: "micro", hook: "micro" },
    promptSurface: ["output_layout", "dnr"],
  },
  {
    id: "M06",
    title: "문단 분할 지점",
    triggers: [
      "speaker change",
      "narration → quote transition",
      "beat phase change (establish→compress→exchange)",
      "withhold ↔ reveal boundary",
    ],
    flow: MICRO_TURN_FLOW,
    lengthByPhase: {},
    promptSurface: ["output_layout", "dnr"],
  },
  {
    id: "M07",
    title: "장면 전환 순서",
    triggers: [
      "1 close current beat (handoff or pause)",
      "2 reset vector (time/space marker — abstract, not fixed noun)",
      "3 new establish (long→mid)",
      "4 re-enter exchange",
    ],
    flow: [
      { from: "handoff", to: "turn_end" },
      { from: "turn_start", to: "establish" },
    ],
    lengthByPhase: { handoff: "short", establish: "long" },
    promptSurface: ["turn_handoff", "prose_rhythm", "cross_turn"],
  },
  {
    id: "M08",
    title: "긴장감 리듬",
    triggers: [
      "alternation period ↓ (nar↔dlg faster)",
      "length regime → short/micro dominant",
      "withhold cycle shortened",
      "hook every 2–3 beats",
    ],
    flow: [
      { from: "establish", to: "compress" },
      { from: "compress", to: "exchange" },
      { from: "exchange", to: "hook" },
    ],
    lengthByPhase: {
      establish: "mid",
      compress: "short",
      exchange: "micro",
      withhold: "micro",
      hook: "micro",
    },
    promptSurface: ["prose_rhythm", "dnr", "length"],
  },
  {
    id: "M09",
    title: "평온 장면 리듬",
    triggers: [
      "alternation period ↑ (allow 2–3 nar before dlg)",
      "length regime mid/long mix",
      "withhold cycle elongated or absent",
      "hook soft (statement not question)",
    ],
    flow: [
      { from: "turn_start", to: "establish" },
      { from: "establish", to: "exchange" },
      { from: "exchange", to: "pause" },
      { from: "pause", to: "handoff" },
    ],
    lengthByPhase: {
      establish: "long",
      exchange: "mid",
      pause: "mid",
      handoff: "mid",
    },
    promptSurface: ["prose_rhythm", "genre_tone", "length"],
  },
  {
    id: "M10",
    title: "전투 리듬",
    triggers: [
      "micro sentence dominant",
      "withhold minimal — reveal immediate",
      "alternation: action line ↔ single-word dlg",
      "no pause phase — compress→exchange loop",
      "paragraph = 1 sentence common",
    ],
    flow: [
      { from: "compress", to: "exchange" },
      { from: "exchange", to: "compress" },
      { from: "exchange", to: "hook" },
    ],
    lengthByPhase: {
      compress: "micro",
      exchange: "micro",
      hook: "micro",
    },
    promptSurface: ["prose_rhythm", "genre_tone", "length"],
  },
];

/** Flow notation for prompts — no sentences */
export const UNIVERSAL_FLOW_NOTATION = `
[BEAT FLOW — structure only, no fixed vocabulary]
turn_start → establish(mid|long) → exchange(micro dlg + short nar) → withhold(short) → reveal(mid) → pause(micro) → hook(micro|?) → handoff → turn_end

[PHASE RULES]
• establish: orient; max 2 sentences before first quote
• exchange: alternation; no narration block >3 without quote or phase shift
• withhold: 1 beat delay before key fact
• reveal: 1 fact only; no stack
• pause: 1 line cognitive break
• hook: unresolved; next input invited
`.trim();

/** Scene-mode overlays — rhythm params only */
export const SCENE_MODE_OVERLAYS = {
  calm: {
    maxNarWithoutDlg: 3,
    dominantLength: "mid" as LengthRegime,
    withholdCycle: "long" as const,
    hookType: "statement" as const,
  },
  tension: {
    maxNarWithoutDlg: 2,
    dominantLength: "short" as LengthRegime,
    withholdCycle: "short" as const,
    hookType: "question_or_ellipsis" as const,
  },
  combat: {
    maxNarWithoutDlg: 1,
    dominantLength: "micro" as LengthRegime,
    withholdCycle: "none" as const,
    hookType: "action_cliff" as const,
  },
} as const;

export type ProductionPromptSurface = StyleMechanism["promptSurface"][number];

export const PROMPT_INJECTION_FEASIBILITY: {
  surface: ProductionPromptSurface;
  currentState: string;
  canInduceMechanism: "yes" | "partial" | "no";
  mechanismIds: string[];
  designNote: string;
}[] = [
  {
    surface: "fewshot_flow",
    currentState: "[예시 대화] = content sentences (space/hand/sound)",
    canInduceMechanism: "partial",
    mechanismIds: ["M01", "M03", "M05", "M06", "M08"],
    designNote:
      "Replace content few-shot with FLOW NOTATION only (phase arrows). Model imitates rhythm, not vocabulary.",
  },
  {
    surface: "prose_rhythm",
    currentState: "[RHYTHM][EMOTION] negation bullets",
    canInduceMechanism: "yes",
    mechanismIds: ["M01", "M02", "M04", "M08", "M09", "M10"],
    designNote:
      "Swap bullets for phase→length regime map + scene-mode overlay pointer. No exemplar sentences.",
  },
  {
    surface: "dnr",
    currentState: "2 lines quote integrity",
    canInduceMechanism: "yes",
    mechanismIds: ["M03", "M05", "M06", "M08"],
    designNote: "Add BEAT FLOW + maxNarWithoutDlg per mode — semantic rhythm SoT.",
  },
  {
    surface: "length",
    currentState: "expand via pre/post dialogue sensation",
    canInduceMechanism: "partial",
    mechanismIds: ["M02", "M07", "M08", "M09", "M10"],
    designNote:
      "Expansion = repeat beat flow (establish→exchange loops), not contiguous narration.",
  },
  {
    surface: "output_layout",
    currentState: "quote=new paragraph (format)",
    canInduceMechanism: "yes",
    mechanismIds: ["M05", "M06"],
    designNote: "Already induces paragraph split at dlg; add phase-boundary reminder.",
  },
  {
    surface: "turn_handoff",
    currentState: "continue aftermath/body/atmosphere",
    canInduceMechanism: "partial",
    mechanismIds: ["M03", "M07", "M10"],
    designNote: "Reframe as handoff→hook phase; forbid closing all withhold cycles.",
  },
  {
    surface: "genre_tone",
    currentState: "genre hint 1 line",
    canInduceMechanism: "yes",
    mechanismIds: ["M09", "M10"],
    designNote: "Map genre→scene_mode overlay (calm/tension/combat params only).",
  },
  {
    surface: "cross_turn",
    currentState: "no same pattern reuse",
    canInduceMechanism: "partial",
    mechanismIds: ["M07"],
    designNote: "Cross-turn = vary phase order, not vocabulary.",
  },
];
