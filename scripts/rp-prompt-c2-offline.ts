/**
 * STEP C2-Micro — offline gates (API calls = 0).
 *
 * Usage:
 *   node --conditions=react-server --import tsx scripts/rp-prompt-c2-offline.ts
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const OUT = process.env.OUT_DIR ?? "docs/audits/rp-prompt-c2";
const FIXTURE_DIR =
  process.env.FIXTURE_DIR ?? "docs/audits/rp-prompt-c2/fixtures";

mkdirSync(OUT, { recursive: true });

function sha256(t: string) {
  return createHash("sha256").update(t).digest("hex");
}
function est(t: string) {
  return Math.max(1, Math.ceil(t.length * 0.9));
}
function save(name: string, content: string | object) {
  writeFileSync(
    join(OUT, name),
    typeof content === "string" ? content : JSON.stringify(content, null, 2),
    "utf8"
  );
}

type ClauseStatus =
  | "PRESERVED_EXACT"
  | "PRESERVED_MERGED"
  | "UNCHANGED"
  | "MISSING"
  | "NEW_MEANING"
  | "WEAKENED";

type Clause = {
  id: string;
  source: string;
  text: string;
  status: ClauseStatus;
  note: string;
  k?: string;
};

async function main() {
  const {
    buildAdvancedProseNsfwGuidelines,
    buildAdvancedProseNsfwGuidelinesC2Micro,
    PROSE_STYLE_SECTION,
    PROSE_STYLE_SECTION_C2_MICRO,
    IMMERSIVE_PROSE_BLOCK,
    IMMERSIVE_PROSE_BLOCK_C2_MICRO,
    SCENE_FLOW_BLOCK_C2_MICRO,
    replaceProseStyleSectionWithC2MicroCandidate,
  } = await import("../src/lib/advancedProseNsfwGuidelines");
  const { SCENE_FLOW_BLOCK } = await import("../src/lib/generationProcessBeatFlow");
  const { buildWebnovelOutputLayoutRecencyBlock } = await import(
    "../src/lib/webnovelOutputFormat"
  );
  const { buildOpenRouterKoreanProseTopBlock } = await import(
    "../src/lib/openRouterProsePolicy"
  );
  const { buildRuntimePromptContaminationGuardBlock } = await import(
    "../src/lib/runtimePromptContaminationGuard"
  );
  const { buildNoGodmoddingBlock } = await import("../src/lib/noGodmodding");
  const { OPUS_ARM_E_TERMINAL } = await import("../src/lib/opusTerminalLengthOwner");
  const { DEEPSEEK_COMPACT_FUTURE_INSTRUCTION_BOUNDARY } = await import(
    "../src/lib/deepseekFutureInstructionBoundary"
  );
  const { TERRA_TERMINAL_LENGTH_OWNER_CONTRACT } = await import(
    "../src/lib/terraTerminalLengthOwner"
  );
  const {
    OPENROUTER_GEMINI_31_PRO_MODEL,
    OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
    CLAUDE_OPUS_MODEL,
    CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
  } = await import("../src/lib/chatModels");

  const aOff = buildAdvancedProseNsfwGuidelines({ nsfwEnabled: false });
  const aOn = buildAdvancedProseNsfwGuidelines({ nsfwEnabled: true });
  const bOff = buildAdvancedProseNsfwGuidelinesC2Micro({ nsfwEnabled: false });
  const bOn = buildAdvancedProseNsfwGuidelinesC2Micro({ nsfwEnabled: true });

  const baseline = {
    measured_at: new Date().toISOString(),
    note: "Re-measured on current main tip for C2 — do not reuse C1 SHA blindly.",
    prose_A: {
      nsfw_off: { sha256: sha256(aOff), est_tokens: est(aOff), chars: aOff.length },
      nsfw_on: { sha256: sha256(aOn), est_tokens: est(aOn), chars: aOn.length },
    },
    prose_B_c2_micro: {
      nsfw_off: { sha256: sha256(bOff), est_tokens: est(bOff), chars: bOff.length },
      nsfw_on: { sha256: sha256(bOn), est_tokens: est(bOn), chars: bOn.length },
    },
    components: {
      PROSE_STYLE_SECTION: {
        sha256: sha256(PROSE_STYLE_SECTION),
        est_tokens: est(PROSE_STYLE_SECTION),
      },
      PROSE_STYLE_SECTION_C2_MICRO: {
        sha256: sha256(PROSE_STYLE_SECTION_C2_MICRO),
        est_tokens: est(PROSE_STYLE_SECTION_C2_MICRO),
      },
      SCENE_FLOW_BLOCK: {
        sha256: sha256(SCENE_FLOW_BLOCK),
        est_tokens: est(SCENE_FLOW_BLOCK),
      },
      SCENE_FLOW_BLOCK_C2_MICRO: {
        sha256: sha256(SCENE_FLOW_BLOCK_C2_MICRO),
        est_tokens: est(SCENE_FLOW_BLOCK_C2_MICRO),
      },
      IMMERSIVE_PROSE_BLOCK: {
        sha256: sha256(IMMERSIVE_PROSE_BLOCK),
        est_tokens: est(IMMERSIVE_PROSE_BLOCK),
      },
      IMMERSIVE_PROSE_BLOCK_C2_MICRO: {
        sha256: sha256(IMMERSIVE_PROSE_BLOCK_C2_MICRO),
        est_tokens: est(IMMERSIVE_PROSE_BLOCK_C2_MICRO),
      },
    },
  };

  const redOn = est(aOn) - est(bOn);
  const pctOn = Number(((redOn / est(aOn)) * 100).toFixed(2));
  const redOff = est(aOff) - est(bOff);
  const pctOff = Number(((redOff / est(aOff)) * 100).toFixed(2));

  const tokenDiff = {
    A_nsfw_on: est(aOn),
    B_nsfw_on: est(bOn),
    reduction_on: redOn,
    percent_on: pctOn,
    A_nsfw_off: est(aOff),
    B_nsfw_off: est(bOff),
    reduction_off: redOff,
    percent_off: pctOff,
    token_gate: {
      target_band: "1450~1550 NSFW ON preferred",
      b_on: est(bOn),
      under_1400_fail_review: est(bOn) < 1400,
      live_allowed_if_exact_dupes:
        est(bOn) >= 1400 || "exact duplicates only documented",
      note:
        "Aggressive stretch to hit 8% by deleting non-duplicates is FORBIDDEN. Exact-dupe-only reduction may be <8%.",
    },
  };

  // --- Clause matrix (production A → C2-Micro B) ---
  const clauses: Clause[] = [
    {
      id: "P01",
      source: "NARRATION REGISTER",
      text: "지문·서술은 해체(-다/-했다/-이었다)만",
      status: "PRESERVED_EXACT",
      note: "byte-identical opening line",
      k: "K1",
    },
    {
      id: "P02",
      source: "NARRATION REGISTER",
      text: "번역투·명사 단편 행·쉼표 나열로 이어 붙인 문장 금지",
      status: "PRESERVED_MERGED",
      note: "M1 — folded into RHYTHM short-sentence owner",
      k: "K2",
    },
    {
      id: "P03",
      source: "NARRATION REGISTER",
      text: "말줄임 ... 은 망설임·끊김·여운이 실제 있을 때만. ...... 금지",
      status: "PRESERVED_EXACT",
      note: "unchanged",
    },
    {
      id: "P04",
      source: "SCENE FLOW",
      text: "장면의 성격에 맞춰 속도를 조절하되 calm/tension/combat는 분량 수준을 의미하지 않는다",
      status: "PRESERVED_EXACT",
      note: "calm != short preserved",
      k: "K13",
    },
    {
      id: "P05",
      source: "SCENE FLOW",
      text: "평온한 장면도 짧게 요약하지 않고 … 변화로 전개한다",
      status: "PRESERVED_MERGED",
      note: "M2 primary owner — merged with IMMERSIVE quiet-scene clause",
      k: "K13",
    },
    {
      id: "P06",
      source: "RHYTHM",
      text: "같은 문장 시작형 반복 금지 / 시작점 변경",
      status: "PRESERVED_EXACT",
      note: "unchanged",
      k: "K3",
    },
    {
      id: "P07",
      source: "RHYTHM",
      text: "짧은 문장·파편은 강조일 때만 / 습관적 연타 금지 / 번역체 단문 연속 금지",
      status: "PRESERVED_MERGED",
      note: "M1 — consolidated with P02 into one concise owner",
      k: "K2,K4",
    },
    {
      id: "P08",
      source: "RHYTHM",
      text: "문장 길이 리듬과 문단 분리는 별개다",
      status: "PRESERVED_EXACT",
      note: "unchanged",
    },
    {
      id: "P09",
      source: "SENSATION",
      text: "1~2채널 깊게 / 구체성 / 질감·공간·온도·소리·대비·방향·거리",
      status: "UNCHANGED",
      note: "FROZEN — sensation block byte-identical",
      k: "K5",
    },
    {
      id: "P10",
      source: "IMMERSIVE",
      text: "초점 인물 체험 밀착 / 생각·연상·기억·오해·감정·판단 연결",
      status: "PRESERVED_EXACT",
      note: "unchanged",
      k: "K6",
    },
    {
      id: "P11",
      source: "IMMERSIVE",
      text: "이미 잡힌 생각·해석·관계 결론을 다른 비유로 반복 증명하지 않음",
      status: "PRESERVED_EXACT",
      note: "M3 KEEP SEPARATE — repetition owner",
      k: "K8-rep",
    },
    {
      id: "P12",
      source: "IMMERSIVE",
      text: "분위기·관계·이해·긴장·결과를 바꾸는 디테일만 / 평범한 이동 압축",
      status: "PRESERVED_EXACT",
      note: "unchanged",
    },
    {
      id: "P13",
      source: "IMMERSIVE",
      text: "대사 = 캐릭터·관계·상황 / 설정 브리핑 금지",
      status: "UNCHANGED",
      note: "FROZEN dialogue quality",
      k: "K9,K10",
    },
    {
      id: "P14",
      source: "IMMERSIVE",
      text: "이유 없는 질문 연타 금지 / 침묵·본업·퇴장 허용",
      status: "UNCHANGED",
      note: "FROZEN",
      k: "K11",
    },
    {
      id: "P15",
      source: "IMMERSIVE",
      text: "이유 없는 첫 만남 특별취급 금지 (정본·친화·사건·명시 인연 예외)",
      status: "UNCHANGED",
      note: "FROZEN",
      k: "K12",
    },
    {
      id: "P16",
      source: "IMMERSIVE",
      text: "이미 드러난 감정/관계 의미를 추상 정답 해설로 다시 쓰지 않음",
      status: "PRESERVED_EXACT",
      note: "M3 KEEP SEPARATE — tell-after-show owner",
      k: "K8-tell",
    },
    {
      id: "P17",
      source: "IMMERSIVE",
      text: "행동 목록·신체 부위 목록·소품 조작 목록처럼 쓰지 않음",
      status: "PRESERVED_EXACT",
      note: "unchanged",
      k: "K7",
    },
    {
      id: "P18",
      source: "IMMERSIVE",
      text: "평온한 장면도 대화·내면·관계·분위기·결과로 전개 / 미세 행동·반복 해설로 분량 채우지 않음",
      status: "PRESERVED_MERGED",
      note: "M2 — removed from IMMERSIVE; meaning folded into SCENE FLOW primary wording (anti-summary + change-driven progress + no padding)",
      k: "K13",
    },
    {
      id: "P19",
      source: "IMMERSIVE",
      text: "최근 서술 문체 참고 / 이전 길이 모방 금지 / 현재 길이 지시 우선",
      status: "PRESERVED_EXACT",
      note: "unchanged",
      k: "K14",
    },
    {
      id: "P20",
      source: "WEBNOVEL BREATH",
      text: "중요 순간 직전 pause / 전환·분기 reset",
      status: "UNCHANGED",
      note: "FROZEN — C2-S NOT_RUN",
    },
    {
      id: "P21",
      source: "19+ INTIMACY",
      text: "NSFW voice / relationship continuity",
      status: "UNCHANGED",
      note: "NSFW block untouched (outside prose style body)",
      k: "K15",
    },
  ];

  // Runtime content checks for merged wording presence
  const bBody = PROSE_STYLE_SECTION_C2_MICRO;
  const checks = {
    m1_owner_present:
      bBody.includes("번역투식 단문·명사 파편") &&
      bBody.includes("습관적 연타") &&
      bBody.includes("실제 강조가 필요할 때만"),
    m1_no_orphan_register_line: !bBody.includes(
      "번역투·명사 단편 행·쉼표 나열로 이어 붙인 문장 금지."
    ),
    m2_primary_in_scene_flow:
      SCENE_FLOW_BLOCK_C2_MICRO.includes("짧게 요약하지 말고") &&
      SCENE_FLOW_BLOCK_C2_MICRO.includes("변화로 실제로 전개") &&
      SCENE_FLOW_BLOCK_C2_MICRO.includes("미세 행동·반복 해설로 분량을 채우지"),
    m2_removed_from_immersive: !IMMERSIVE_PROSE_BLOCK_C2_MICRO.includes(
      "평온한 장면도"
    ),
    m3_rep_kept: IMMERSIVE_PROSE_BLOCK_C2_MICRO.includes(
      "다른 비유·정의·대비로 반복 증명하지"
    ),
    m3_tell_kept: IMMERSIVE_PROSE_BLOCK_C2_MICRO.includes(
      "추상 판정·정답 해설로 다시 쓰지"
    ),
    breath_unchanged: bBody.includes(
      "중요 순간 직전: 지문 한 박 pause(공간·온도·소리)."
    ),
    sensation_unchanged: bBody.includes(
      "장면에 맞게 1~2채널만 깊게 — 질감·공간·온도·소리·대비·방향·거리."
    ),
    no_new_literary_boosters: !(
      bBody.includes("서술 80%") ||
      bBody.includes("더 문학적으로") ||
      bBody.includes("고급 소설") ||
      bBody.includes("비유를 풍부") ||
      bBody.includes("대사는 줄여")
    ),
  };

  const forbiddenStatuses = clauses.filter((c) =>
    ["MISSING", "NEW_MEANING", "WEAKENED"].includes(c.status)
  );
  const matrixPass =
    forbiddenStatuses.length === 0 && Object.values(checks).every(Boolean);

  // Protected owners byte-identity (must be frozen)
  const frozenOwners: Array<[string, string]> = [
    ["OUTPUT LAYOUT", buildWebnovelOutputLayoutRecencyBlock()],
    ["CANON/KOREAN TOP", buildOpenRouterKoreanProseTopBlock()],
    ["AGENCY", buildNoGodmoddingBlock("캐릭터", "렌", "standard")],
    ["OPUS_ARM_E_TERMINAL", OPUS_ARM_E_TERMINAL],
    [
      "DEEPSEEK_COMPACT_FUTURE_INSTRUCTION_BOUNDARY",
      DEEPSEEK_COMPACT_FUTURE_INSTRUCTION_BOUNDARY,
    ],
    ["TERRA_TERMINAL_LENGTH_OWNER_CONTRACT", TERRA_TERMINAL_LENGTH_OWNER_CONTRACT],
    [
      "contamination Gemini",
      buildRuntimePromptContaminationGuardBlock(OPENROUTER_GEMINI_31_PRO_MODEL),
    ],
    [
      "contamination DeepSeek",
      buildRuntimePromptContaminationGuardBlock(OPENROUTER_DEEPSEEK_V4_PRO_MODEL),
    ],
    [
      "contamination Opus",
      buildRuntimePromptContaminationGuardBlock(CLAUDE_OPUS_MODEL),
    ],
    [
      "contamination Terra",
      buildRuntimePromptContaminationGuardBlock(CHEAPER_INFERENCE_GPT_56_TERRA_MODEL),
    ],
  ];
  const frozenHashes = Object.fromEntries(
    frozenOwners.map(([k, v]) => [k, sha256(v)])
  );

  // Swap helper sanity on assembled-like string
  const synthetic = `PREFIX\n${PROSE_STYLE_SECTION}\nSUFFIX`;
  const swapped = replaceProseStyleSectionWithC2MicroCandidate(synthetic);
  const swapOk =
    swapped.includes(PROSE_STYLE_SECTION_C2_MICRO) &&
    !swapped.includes(PROSE_STYLE_SECTION) &&
    swapped.startsWith("PREFIX") &&
    swapped.endsWith("SUFFIX");

  // Fixture presence
  const fixturesOk = [5, 18, 10].every((id) =>
    existsSync(join(FIXTURE_DIR, `c${id}_fixture.json`))
  );

  const gate = {
    semantic_matrix: matrixPass ? "PASS" : "FAIL",
    forbidden_clause_statuses: forbiddenStatuses.map((c) => c.id),
    content_checks: checks,
    swap_helper_ok: swapOk,
    fixtures_present: fixturesOk,
    token_under_1400: est(bOn) < 1400,
    live_entry_allowed:
      matrixPass && swapOk && fixturesOk && est(bOn) >= 1400,
    warning:
      "Semantic parity PASS is a live-entry condition only — NOT proof of behavioral safety (C1 lesson).",
    M1: "APPLIED",
    M2: "APPLIED",
    M3: "KEEP_SEPARATE",
    WEBNOVEL_BREATH: "UNCHANGED",
    SENSATION: "UNCHANGED",
    DIALOGUE_GUARDS: "UNCHANGED",
    C2_S: "NOT_RUN",
    C3: "NOT_RUN",
    production_prose_default: "UNCHANGED",
  };

  save("00_BASELINE.json", baseline);
  save(
    "00_BASELINE.md",
    [
      "# 00_BASELINE — C2 prose freeze",
      "",
      `Measured: ${baseline.measured_at}`,
      "",
      "## Production A",
      "",
      `- NSFW OFF: sha256=\`${baseline.prose_A.nsfw_off.sha256}\` est=${baseline.prose_A.nsfw_off.est_tokens}`,
      `- NSFW ON: sha256=\`${baseline.prose_A.nsfw_on.sha256}\` est=${baseline.prose_A.nsfw_on.est_tokens}`,
      "",
      "## Candidate B (C2-Micro)",
      "",
      `- NSFW OFF: sha256=\`${baseline.prose_B_c2_micro.nsfw_off.sha256}\` est=${baseline.prose_B_c2_micro.nsfw_off.est_tokens}`,
      `- NSFW ON: sha256=\`${baseline.prose_B_c2_micro.nsfw_on.sha256}\` est=${baseline.prose_B_c2_micro.nsfw_on.est_tokens}`,
      "",
      "C1 baseline SHA was **not** reused; hashes re-measured on current main tip.",
      "",
    ].join("\n")
  );

  save("01_PROSE_CLAUSE_MATRIX.json", { clauses, checks, gate: gate.semantic_matrix });
  save(
    "01_PROSE_CLAUSE_MATRIX.md",
    [
      "# 01_PROSE_CLAUSE_MATRIX",
      "",
      "**Allowed statuses only:** PRESERVED_EXACT / PRESERVED_MERGED / UNCHANGED",
      "",
      "**Forbidden:** MISSING / NEW_MEANING / WEAKENED → blocks live test",
      "",
      "| ID | Source | Status | K | Note |",
      "|----|--------|--------|---|------|",
      ...clauses.map(
        (c) =>
          `| ${c.id} | ${c.source} | ${c.status} | ${c.k ?? ""} | ${c.note} |`
      ),
      "",
      `## Matrix: **${gate.semantic_matrix}**`,
      "",
      "### Content checks",
      "",
      "```json",
      JSON.stringify(checks, null, 2),
      "```",
      "",
      "> Behavioral-anchor warning: semantic PASS ≠ behavioral safety (C1).",
      "",
    ].join("\n")
  );

  save(
    "02_CANDIDATE.md",
    [
      "# 02_CANDIDATE — C2-Micro",
      "",
      "## Variable",
      "",
      "COMMON PROSE QUALITY BLOCK only (`PROSE_STYLE_SECTION` → `PROSE_STYLE_SECTION_C2_MICRO`).",
      "",
      "## Allowed merges",
      "",
      "- **M1** short-sentence / translationese / noun-fragment family → one RHYTHM owner",
      "- **M2** quiet-scene anti-summary (SCENE FLOW ↔ IMMERSIVE) → one SCENE FLOW primary wording",
      "",
      "## Explicitly not merged",
      "",
      "- **M3** repetition-of-conclusion vs tell-after-show → KEEP SEPARATE",
      "- WEBNOVEL BREATH / SENSATION / dialogue guards → UNCHANGED",
      "- No new “write more literary” rules",
      "",
      "## Production default",
      "",
      "`buildAdvancedProseNsfwGuidelines()` still uses production `PROSE_STYLE_SECTION`.",
      "Candidate is experiment-only via `buildAdvancedProseNsfwGuidelinesC2Micro` /",
      "`replaceProseStyleSectionWithC2MicroCandidate`.",
      "",
      "## Candidate body SHA",
      "",
      `- PROSE_STYLE_SECTION_C2_MICRO sha256=\`${sha256(PROSE_STYLE_SECTION_C2_MICRO)}\``,
      "",
    ].join("\n")
  );

  save("03_TOKEN_DIFF.json", tokenDiff);
  save(
    "03_TOKEN_DIFF.md",
    [
      "# 03_TOKEN_DIFF",
      "",
      `| Arm | NSFW OFF | NSFW ON |`,
      `|-----|----------|---------|`,
      `| A (prod) | ${tokenDiff.A_nsfw_off} | ${tokenDiff.A_nsfw_on} |`,
      `| B (C2-Micro) | ${tokenDiff.B_nsfw_off} | ${tokenDiff.B_nsfw_on} |`,
      `| Δ | ${tokenDiff.reduction_off} (${tokenDiff.percent_off}%) | ${tokenDiff.reduction_on} (${tokenDiff.percent_on}%) |`,
      "",
      "Preferred band NSFW ON: **1450~1550**. B is above that band because only exact/near-exact duplicates were removed (M1+M2 only).",
      "",
      `- under_1400_fail_review: **${tokenDiff.token_gate.under_1400_fail_review}**`,
      `- live_allowed (exact dupes documented): **yes** if matrix PASS`,
      "",
      "Note: prose lives mainly in `cacheCharacter`; C2 is not primarily per-turn uncached cost reduction.",
      "",
    ].join("\n")
  );

  save("C2_OFFLINE_GATE.json", {
    ...gate,
    frozen_owner_sha256: frozenHashes,
    tokenDiff,
    baseline_A_on_sha: baseline.prose_A.nsfw_on.sha256,
  });

  save(
    "04_FIXTURES.md",
    [
      "# 04_FIXTURES",
      "",
      "| ID | Character | Axis | User input provenance |",
      "|----|-----------|------|------------------------|",
      "| Q | c5 저주받은 북부대공 | quiet / inner / sensory | C1 fixture N |",
      "| D | c18 라이크 | dialogue / multi-speaker | C1 fixture D |",
      "| T | c10 에녹 | action / tension | final-production `terra_action` T1 |",
      "",
      "Fixture JSON under `docs/audits/rp-prompt-c2/fixtures/`.",
      "",
      "This VM lacked `/opt/cursor/artifacts/opus-quality-anchor/fixtures`; cards were reconstructed",
      "from seed DB / Terra canary greeting / d2-enoch summary. **Same A/B character card** is used",
      "within each pair — relative comparison remains the experimental unit.",
      "",
    ].join("\n")
  );

  console.log(JSON.stringify({ gate, tokenDiff }, null, 2));
  if (!gate.live_entry_allowed) {
    console.error("LIVE ENTRY BLOCKED");
    process.exit(2);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
