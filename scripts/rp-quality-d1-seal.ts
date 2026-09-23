/**
 * Merge D1 live cells + human continuity scores into sealed docs (API=0).
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { computeRpQualityVectorV2 } from "../src/lib/rpQualityVector";

const OUT_ROOT =
  process.env.OUT_ROOT ?? "/opt/cursor/artifacts/rp-quality-d1-g5g6";
const DOCS = process.env.DOCS_DIR ?? "docs/audits/rp-quality-v2-gemini";
const FIXTURE_DIR = join(DOCS, "fixtures");

const G5_USER = "누구세요? …방금 그 소리는 뭐였죠?";
const G6_T2_USER = "알겠어요. …그럼 어디로요?";

function greeting(): string {
  const fix = JSON.parse(
    readFileSync(join(FIXTURE_DIR, "c10_fixture.json"), "utf8")
  ) as { character: { greeting: string } };
  return fix.character.greeting;
}

function save(name: string, content: string | object) {
  mkdirSync(DOCS, { recursive: true });
  writeFileSync(
    join(DOCS, name),
    typeof content === "string" ? content : JSON.stringify(content, null, 2),
    "utf8"
  );
}

/** Human scores from agent spot-read of live openings (seal). */
const HUMAN: Record<
  string,
  {
    INTRO_REPLAY?: number;
    CURRENT_INPUT_REPLAY: number;
    TURN1_REPLAY_ON_TURN2?: number;
    SETTING_RECITAL: number;
    FIRST_TURN_SPECIAL_TREATMENT?: number;
    SCENE_ADVANCEMENT: number;
    ACTIVE_CANON_USE: number;
    CHARACTER_FIDELITY: number;
    notes: string;
  }
> = {
  Gemini_G5: {
    INTRO_REPLAY: 2,
    CURRENT_INPUT_REPLAY: 1,
    SETTING_RECITAL: 2,
    FIRST_TURN_SPECIAL_TREATMENT: 1,
    SCENE_ADVANCEMENT: 1,
    ACTIVE_CANON_USE: 2,
    CHARACTER_FIDELITY: 4,
    notes:
      "Restages greeting shutter/ruins; persona dump (“호기심…직설적”); delayed advance",
  },
  DeepSeek_G5: {
    INTRO_REPLAY: 1,
    CURRENT_INPUT_REPLAY: 0,
    SETTING_RECITAL: 0,
    FIRST_TURN_SPECIAL_TREATMENT: 0,
    SCENE_ADVANCEMENT: 2,
    ACTIVE_CANON_USE: 2,
    CHARACTER_FIDELITY: 4,
    notes: "Short silence→gun→pull; good continuity but DENSITY_COLLAPSE length",
  },
  Gemini_G6_T2: {
    TURN1_REPLAY_ON_TURN2: 1,
    CURRENT_INPUT_REPLAY: 1,
    SETTING_RECITAL: 1,
    SCENE_ADVANCEMENT: 2,
    ACTIVE_CANON_USE: 2,
    CHARACTER_FIDELITY: 4,
    notes: "Continues scope/horror as ongoing STATE; no full turn1 rewind",
  },
  DeepSeek_G6_T2: {
    TURN1_REPLAY_ON_TURN2: 0,
    CURRENT_INPUT_REPLAY: 1,
    SETTING_RECITAL: 0,
    SCENE_ADVANCEMENT: 2,
    ACTIVE_CANON_USE: 2,
    CHARACTER_FIDELITY: 4,
    notes: "Answers where-to without retelling turn1",
  },
  Gemini_G6_T1: {
    CURRENT_INPUT_REPLAY: 2,
    SETTING_RECITAL: 1,
    SCENE_ADVANCEMENT: 2,
    ACTIVE_CANON_USE: 2,
    CHARACTER_FIDELITY: 4,
    notes: "Opening restages user scream/metal-friction beat (cinema)",
  },
  DeepSeek_G6_T1: {
    CURRENT_INPUT_REPLAY: 1,
    SETTING_RECITAL: 0,
    SCENE_ADVANCEMENT: 2,
    ACTIVE_CANON_USE: 2,
    CHARACTER_FIDELITY: 4,
    notes: "Opens on reaction/listen; lighter input restage",
  },
};

function main() {
  const live = join(OUT_ROOT, "live");
  const greet = greeting();
  const cells = readdirSync(live).filter((d) =>
    existsSync(join(live, d, "provider_raw.txt"))
  );
  const rows: Record<string, unknown>[] = [];
  for (const id of cells.sort()) {
    const raw = readFileSync(join(live, id, "provider_raw.txt"), "utf8");
    const meta = JSON.parse(
      readFileSync(join(live, id, "meta.json"), "utf8")
    ) as Record<string, unknown>;
    let currentUserInput: string | null = null;
    let priorAssistantText: string | null = null;
    let greetingOrIntroText: string | null = greet;
    if (id.endsWith("_G5")) currentUserInput = G5_USER;
    if (id.endsWith("_G6_T1")) currentUserInput =
      "*멀리서 비명과 금속 마찰음이 겹친다. 렌은 에녹 쪽으로 몸을 낮춘다.* 저쪽이에요. 같이 가요?";
    if (id.endsWith("_G6_T2")) {
      currentUserInput = G6_T2_USER;
      const t1 = id.replace("_G6_T2", "_G6_T1");
      priorAssistantText = readFileSync(
        join(live, t1, "provider_raw.txt"),
        "utf8"
      );
    }
    const vector = computeRpQualityVectorV2({
      text: raw,
      providerRaw: raw,
      finishReason: (meta.finish_reason as string) ?? null,
      sawDone: (meta.saw_done as boolean) ?? null,
      incomplete: (meta.incomplete as boolean) ?? null,
      currentUserInput,
      priorAssistantText,
      greetingOrIntroText,
    });
    rows.push({
      cell_id: id,
      modelKey: meta.modelKey,
      length_band: vector.length.length_band,
      visible_chars_no_ws: vector.length.visible_chars_no_whitespace,
      dialogue_char_share: vector.composition.dialogue_char_share,
      continuity_auto: vector.continuity,
      hard_alarms: vector.hard_alarms,
      human: HUMAN[id] ?? null,
    });
  }

  const offline = JSON.parse(
    readFileSync(join(DOCS, "04_RETROACTIVE_VALIDATION.json"), "utf8")
  ) as { summary: { replay_by_model: Record<string, { input: number; total: number }> } };

  const classification = {
    CURRENT_INPUT_REPLAY_ON_FIRST_REACTION:
      "REPLAY_IS_GEMINI_HEAVY (offline T: Gemini 4/10 vs DeepSeek 1/10 auto; live G6_T1 Gemini=2 human)",
    INTRO_REPLAY_G5:
      "REPLAY_IS_GEMINI_HEAVY_THIS_SEED (Gemini_G5 INTRO=2+SETTING=2; DeepSeek_G5 INTRO=1)",
    TURN1_REPLAY_ON_TURN2_G6:
      "NOT_SEVERE_EITHER_MODEL_THIS_SEED (Gemini=1, DeepSeek=0)",
    overall:
      "MIXED — first-turn intro/input restage Gemini-heavier; multi-turn scene rewind not reproduced",
  };

  const adapter = {
    status: "CANDIDATE_TEXT_ONLY_NOT_WIRED",
    reason:
      "Gemini repeatedly elevated on SETTING_RECITAL + CURRENT_INPUT_REPLAY / INTRO_REPLAY on first reaction; TURN1→T2 rewind not severe enough alone. Do not ship without A/B hard gate.",
    block_id: "GEMINI_SCENE_CONTINUITY",
    mnemonic: "REMEMBER IT · DO NOT REPLAY IT · ACT FROM IT",
    must_not_become: ["회상 금지", "과거 언급 금지", "설정 언급 금지"],
    hard_gate:
      "RECITAL/REPLAY ↓ while ACTIVE_CANON_USE / CHARACTER_FIDELITY / SCENE_PROGRESSION / LENGTH ≥ baseline",
  };

  const summary = {
    api_calls_total_d1: 6,
    cells: rows.length,
    classification,
    adapter,
    offline_replay_by_model: offline.summary.replay_by_model,
    rows,
  };

  save("07_D1_G5G6_LIVE.json", summary);
  save(
    "07_D1_G5G6_LIVE.md",
    [
      "# 07_D1_G5G6_LIVE",
      "",
      "API calls (D1 total): **6** (G5×2 + G6×4)",
      "",
      "## Classification",
      "",
      "```json",
      JSON.stringify(classification, null, 2),
      "```",
      "",
      "## Human scores (spot seal)",
      "",
      `| Cell | INTRO | INPUT | T1→T2 | SETTING | SCENE_ADV | notes |`,
      `|------|------:|------:|------:|--------:|----------:|-------|`,
      ...Object.entries(HUMAN).map(
        ([id, h]) =>
          `| ${id} | ${h.INTRO_REPLAY ?? "—"} | ${h.CURRENT_INPUT_REPLAY} | ${h.TURN1_REPLAY_ON_TURN2 ?? "—"} | ${h.SETTING_RECITAL} | ${h.SCENE_ADVANCEMENT} | ${h.notes} |`
      ),
      "",
      "## Adapter",
      "",
      "```json",
      JSON.stringify(adapter, null, 2),
      "```",
      "",
      "Full JSON: `07_D1_G5G6_LIVE.json`",
      "",
    ].join("\n")
  );

  save(
    "08_GEMINI_SCENE_CONTINUITY_CANDIDATE.md",
    [
      "# 08 — Gemini Scene Continuity candidate (NOT WIRED)",
      "",
      "**Status:** `CANDIDATE_TEXT_ONLY_NOT_WIRED`",
      "",
      "Trigger evidence (this phase):",
      "",
      "- Offline CURRENT_INPUT beat restage: Gemini-heavier on fixture T",
      "- Live G5: Gemini INTRO_REPLAY=2 + SETTING_RECITAL=2 vs DeepSeek INTRO=1 / SETTING=0",
      "- Live G6 T2: turn1 rewind **not** severe on either model",
      "",
      "## Proposed block (Gemini 3.1 Pro only, if A/B passes hard gate)",
      "",
      "```text",
      "[GEMINI SCENE CONTINUITY]",
      "",
      "캐릭터·유저·세계관·메모리와 최근 장면은 현재 반응을 결정하는 내부 근거다. 이를 프로필·요약·회상문처럼 다시 출력하지 않는다.",
      "",
      "직전 assistant 장면과 현재 유저 입력에서 이미 발생한 행동·대사·환경 변화는 완료된 사건으로 취급한다. 다음 문장은 그 결과에 대한 NPC·환경의 새로운 반응과 다음 변화에서 시작한다.",
      "",
      "이미 알려진 사실은 현재 장면을 실제로 바꿀 때만 필요한 만큼 짧게 참조하고, 설정이나 이전 장면을 독자에게 다시 소개하지 않는다.",
      "```",
      "",
      "```text",
      "REMEMBER IT",
      "DO NOT REPLAY IT",
      "ACT FROM IT",
      "```",
      "",
      "## Must not become",
      "",
      "- 회상 금지 / 과거 언급 금지 / 설정 언급 금지",
      "",
      "```text",
      "NEW INTERPRETATION OF OLD EVENT = GOOD",
      "OLD EVENT RETOLD WITHOUT NEW VALUE = BAD",
      "```",
      "",
      "## Hard quality gate before any production wire",
      "",
      "```text",
      "SETTING RECITAL ↓",
      "SCENE REPLAY ↓",
      "CURRENT INPUT REPLAY ↓",
      "",
      "while",
      "",
      "ACTIVE CANON USE >= baseline",
      "CHARACTER FIDELITY >= baseline",
      "SCENE PROGRESSION >= baseline",
      "LENGTH/COMPOSITION >= baseline",
      "```",
      "",
      "`RECITAL ↓` with `ACTIVE_CANON_USE ↓` = **FAIL**.",
      "",
    ].join("\n")
  );

  console.log(JSON.stringify({ cells: rows.length, classification, adapter }, null, 2));
}

main();
