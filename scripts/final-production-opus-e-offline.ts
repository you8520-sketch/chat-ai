/**
 * Offline gate: Opus Arm E on PR #250 production assemble path.
 * Fail-closed before any smoke API calls.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const OUT = "docs/audits/final-production-model-smoke";
const FIXTURE =
  process.env.FIXTURE_PATH ??
  "/opt/cursor/artifacts/opus-quality-anchor/fixtures/c9_fixture.json";
const FROZEN_ARM_E_SHA256 =
  "05225756dc2b19abebcf7ae2d5bc01717a6a98fed4494b25108901cca90e28ca";

function save(name: string, content: string | object) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    join(OUT, name),
    typeof content === "string" ? content : JSON.stringify(content, null, 2),
    "utf8"
  );
}
function countOcc(hay: string, needle: string): number {
  let n = 0;
  let i = 0;
  while (true) {
    const j = hay.indexOf(needle, i);
    if (j < 0) break;
    n += 1;
    i = j + needle.length;
  }
  return n;
}

async function assemble(opts: {
  modelId: string;
  contentKind: "character" | "simulation";
  isContinue?: boolean;
  userImpersonation?: boolean;
  party?: boolean;
  userMessage: string;
}) {
  const { loadCharacterChunksForPromptReadOnly } = await import(
    "../src/lib/characterChunks"
  );
  const { formatSelectedPersonaForPrompt } = await import(
    "../src/lib/userPersonas"
  );
  const { OPENING_TURN_USER } = await import("../src/lib/chatGreetingContext");
  const { buildContext } = await import("../src/services/contextBuilder");
  const { assemblePrimaryRpRequest } = await import("../src/lib/openRouterAdult");

  if (!existsSync(FIXTURE)) throw new Error(`missing ${FIXTURE}`);
  const fixture = JSON.parse(readFileSync(FIXTURE, "utf8"));
  const ch = fixture.character;
  const persona = fixture.persona;
  const personaName = String(persona.name ?? "렌");
  const { chunks } = loadCharacterChunksForPromptReadOnly(
    {
      id: Number(ch.id),
      name: String(ch.name),
      gender: String(ch.gender ?? ""),
      system_prompt: String(ch.system_prompt ?? ""),
      world: String(ch.world ?? ""),
      example_dialog: String(ch.example_dialog ?? ""),
      setting_chunks: String(ch.setting_chunks ?? ""),
      speech_profile: String(ch.speech_profile ?? ""),
    },
    personaName,
    String(fixture.user.nickname ?? personaName)
  );
  const userPersona = formatSelectedPersonaForPrompt(
    personaName,
    (persona.gender as "male" | "female" | "other") ?? "other",
    String(persona.description ?? "")
  );
  const built = buildContext({
    charName: String(ch.name),
    chunks,
    userNickname: String(fixture.user.nickname ?? personaName),
    userPersona,
    userNote: "",
    longTermMemory: "",
    shortTermHistory: [
      { role: "user", content: OPENING_TURN_USER },
      { role: "assistant", content: String(ch.greeting ?? "") },
    ],
    currentUserMessage: opts.userMessage,
    nsfw: !!ch.nsfw,
    gender: (ch.gender as "male" | "female" | "other") ?? "other",
    memoryMeta: "",
    modelId: opts.modelId,
    userImpersonation: !!opts.userImpersonation,
    novelModeEnabled: false,
    isContinue: !!opts.isContinue,
    personaDisplayName: personaName,
    targetResponseChars: 3200,
    completedTurns: 0,
    provider: "openrouter",
    contentKind: opts.contentKind,
    exampleDialog: String(ch.example_dialog ?? ""),
    userId: Number(fixture.user.id ?? 4),
    party: opts.party,
  });
  const wire = assemblePrimaryRpRequest({
    system: built.systemPrompt,
    history: built.history ?? [],
    modelId: opts.modelId,
    targetResponseChars: 3200,
    messageOpts: {
      transportProvider: "cheaperinference",
      charName: String(ch.name),
      personaName,
    },
  });
  const messages = (wire.requestBody as { messages: Array<{ role: string; content: string }> })
    .messages;
  const payload = JSON.stringify(messages);
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  return { messages, payload, lastUser: String(lastUser?.content ?? "") };
}

async function main() {
  const reasons: string[] = [];
  const {
    CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
    CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
    CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
  } = await import("../src/lib/chatModels");
  const { COLLABORATIVE_INTERACTIVE_OWNER_TITLE } = await import(
    "../src/lib/noGodmodding"
  );
  const { USER_TAIL_LENGTH_OWNER_SENTENCE } = await import(
    "../src/lib/responseLength"
  );
  const { TERRA_TERMINAL_LENGTH_OWNER_CONTRACT } = await import(
    "../src/lib/terraTerminalLengthOwner"
  );
  const { DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY } = await import(
    "../src/lib/deepseekPromptStructure"
  );
  const {
    DEEPSEEK_COMPACT_FUTURE_INSTRUCTION_BOUNDARY,
    DEEPSEEK_COMPACT_FUTURE_INSTRUCTION_BOUNDARY_MARKER,
    DEEPSEEK_FORBIDDEN_ARM_E_STOP_SENTENCE,
  } = await import("../src/lib/deepseekFutureInstructionBoundary");
  const {
    OPUS_ARM_E_TERMINAL,
    OPUS_ARM_E_TERMINAL_MARKER,
    OPUS_ARM_F_REJECTED_STOP_MARKER,
  } = await import("../src/lib/opusTerminalLengthOwner");

  const FROZEN_TERRA_TERMINAL_SHA256 =
    "6e5b711ffd3b9bee507cc1e1479d940726de43c0b4e4019b3d7d47c12a60350e";
  const FROZEN_DEEPSEEK_STYLE_SHA256 =
    "92c367910f6f9319362e21c04c254478a8ef1e3b6e7ff22535f8c6dae322c9e4";
  const FROZEN_USER_TAIL_SHA256 =
    "122fece4c53d8a71141a279985f42dbdc25cbaceda8bde46bb51596d6ca4b092";

  const armESha = createHash("sha256").update(OPUS_ARM_E_TERMINAL).digest("hex");
  if (armESha !== FROZEN_ARM_E_SHA256) {
    reasons.push(`opus_arm_e_sha_mismatch:${armESha}`);
  }
  if (OPUS_ARM_E_TERMINAL.includes(OPUS_ARM_F_REJECTED_STOP_MARKER)) {
    reasons.push("arm_f_present_in_constant");
  }
  const terraSha = createHash("sha256")
    .update(TERRA_TERMINAL_LENGTH_OWNER_CONTRACT)
    .digest("hex");
  if (terraSha !== FROZEN_TERRA_TERMINAL_SHA256) {
    reasons.push(`terra_terminal_sha_mismatch:${terraSha}`);
  }
  const dsStyleSha = createHash("sha256")
    .update(DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY)
    .digest("hex");
  if (dsStyleSha !== FROZEN_DEEPSEEK_STYLE_SHA256) {
    reasons.push(`deepseek_style_sha_mismatch:${dsStyleSha}`);
  }
  const userTailSha = createHash("sha256")
    .update(USER_TAIL_LENGTH_OWNER_SENTENCE)
    .digest("hex");
  if (userTailSha !== FROZEN_USER_TAIL_SHA256) {
    reasons.push(`user_tail_sha_mismatch:${userTailSha}`);
  }
  if (
    DEEPSEEK_COMPACT_FUTURE_INSTRUCTION_BOUNDARY.includes(
      DEEPSEEK_FORBIDDEN_ARM_E_STOP_SENTENCE
    ) ||
    DEEPSEEK_COMPACT_FUTURE_INSTRUCTION_BOUNDARY.includes(
      OPUS_ARM_F_REJECTED_STOP_MARKER
    ) ||
    DEEPSEEK_COMPACT_FUTURE_INSTRUCTION_BOUNDARY.includes(
      "첫 번째로 새롭게 요구되는 [B]의 행동 직전에 멈춘다"
    )
  ) {
    reasons.push("deepseek_forbidden_stop_sentence");
  }

  const msg = "시키는 대로 할게요. 뭘 하면 돼요?";

  // Opus standard interactive
  const opus = await assemble({
    modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
    contentKind: "character",
    userMessage: msg,
  });
  const opusCollab = countOcc(opus.payload, COLLABORATIVE_INTERACTIVE_OWNER_TITLE);
  const opusArmE = countOcc(opus.lastUser, OPUS_ARM_E_TERMINAL);
  const opusTail = countOcc(opus.lastUser, USER_TAIL_LENGTH_OWNER_SENTENCE);
  const opusF = countOcc(opus.payload, OPUS_ARM_F_REJECTED_STOP_MARKER);
  const opusScene = countOcc(opus.payload, "[SCENE DIRECTIVE]");
  if (opusCollab !== 1) reasons.push(`opus_collab_${opusCollab}`);
  if (opusArmE !== 1) reasons.push(`opus_arm_e_${opusArmE}`);
  if (opusTail !== 0) reasons.push(`opus_numeric_tail_${opusTail}`);
  if (opusF !== 0) reasons.push(`opus_arm_f_${opusF}`);
  if (opusScene !== 0) reasons.push(`opus_scene_${opusScene}`);
  if (!opus.lastUser.trimEnd().endsWith(OPUS_ARM_E_TERMINAL.trim())) {
    reasons.push("opus_arm_e_not_absolute_final");
  }

  // Opus auto progression — must NOT use Arm E
  const opusAuto = await assemble({
    modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
    contentKind: "character",
    isContinue: true,
    userMessage: msg,
  });
  if (countOcc(opusAuto.lastUser, OPUS_ARM_E_TERMINAL_MARKER) !== 0) {
    reasons.push("opus_auto_arm_e_leak");
  }

  // Opus co-narration (OOC) — must NOT use Arm E
  const opusCo = await assemble({
    modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
    contentKind: "character",
    userImpersonation: true,
    userMessage: msg,
  });
  if (countOcc(opusCo.lastUser, OPUS_ARM_E_TERMINAL_MARKER) !== 0) {
    reasons.push("opus_conarration_arm_e_leak");
  }

  // Opus simulation — must NOT use Arm E
  const opusSim = await assemble({
    modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
    contentKind: "simulation",
    userMessage: msg,
  });
  if (countOcc(opusSim.lastUser, OPUS_ARM_E_TERMINAL_MARKER) !== 0) {
    reasons.push("opus_simulation_arm_e_leak");
  }

  // Terra — keep Terra terminal; no Arm E
  const terra = await assemble({
    modelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
    contentKind: "character",
    userMessage: msg,
  });
  const terraTerm = countOcc(terra.lastUser, TERRA_TERMINAL_LENGTH_OWNER_CONTRACT);
  const terraArmE = countOcc(terra.lastUser, OPUS_ARM_E_TERMINAL_MARKER);
  if (terraTerm !== 1) reasons.push(`terra_terminal_${terraTerm}`);
  if (terraArmE !== 0) reasons.push(`terra_arm_e_${terraArmE}`);
  if (countOcc(terra.payload, COLLABORATIVE_INTERACTIVE_OWNER_TITLE) !== 1) {
    reasons.push("terra_collab");
  }

  // DeepSeek — style reminder + compact future boundary + numeric tail; no Arm E
  const ds = await assemble({
    modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
    contentKind: "character",
    userMessage: msg,
  });
  const dsStyle = countOcc(ds.lastUser, DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY);
  const dsBoundary = countOcc(
    ds.lastUser,
    DEEPSEEK_COMPACT_FUTURE_INSTRUCTION_BOUNDARY
  );
  const dsTail = countOcc(ds.lastUser, USER_TAIL_LENGTH_OWNER_SENTENCE);
  const dsArmE = countOcc(ds.lastUser, OPUS_ARM_E_TERMINAL_MARKER);
  const dsForbiddenStop = countOcc(
    ds.payload,
    DEEPSEEK_FORBIDDEN_ARM_E_STOP_SENTENCE
  );
  if (dsStyle !== 1) reasons.push(`deepseek_style_${dsStyle}`);
  if (dsBoundary !== 1) reasons.push(`deepseek_compact_boundary_${dsBoundary}`);
  if (dsTail !== 1) reasons.push(`deepseek_tail_${dsTail}`);
  if (dsArmE !== 0) reasons.push(`deepseek_arm_e_${dsArmE}`);
  if (dsForbiddenStop !== 0) reasons.push(`deepseek_forbidden_stop_${dsForbiddenStop}`);
  if (!ds.lastUser.trimEnd().endsWith(USER_TAIL_LENGTH_OWNER_SENTENCE)) {
    reasons.push("deepseek_tail_not_absolute_final");
  }
  const boundaryIdx = ds.lastUser.indexOf(
    DEEPSEEK_COMPACT_FUTURE_INSTRUCTION_BOUNDARY
  );
  const tailIdx = ds.lastUser.indexOf(USER_TAIL_LENGTH_OWNER_SENTENCE);
  if (!(boundaryIdx >= 0 && tailIdx > boundaryIdx)) {
    reasons.push("deepseek_boundary_not_before_user_tail");
  }

  // DeepSeek leak paths — compact boundary must NOT appear
  const dsAuto = await assemble({
    modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
    contentKind: "character",
    isContinue: true,
    userMessage: msg,
  });
  const dsCo = await assemble({
    modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
    contentKind: "character",
    userImpersonation: true,
    userMessage: msg,
  });
  const dsSim = await assemble({
    modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
    contentKind: "simulation",
    userMessage: msg,
  });
  const dsParty = await assemble({
    modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
    contentKind: "character",
    party: true,
    userMessage: msg,
  });
  const leakAuto = countOcc(
    dsAuto.lastUser,
    DEEPSEEK_COMPACT_FUTURE_INSTRUCTION_BOUNDARY_MARKER
  );
  const leakCo = countOcc(
    dsCo.lastUser,
    DEEPSEEK_COMPACT_FUTURE_INSTRUCTION_BOUNDARY_MARKER
  );
  const leakSim = countOcc(
    dsSim.lastUser,
    DEEPSEEK_COMPACT_FUTURE_INSTRUCTION_BOUNDARY_MARKER
  );
  const leakParty = countOcc(
    dsParty.lastUser,
    DEEPSEEK_COMPACT_FUTURE_INSTRUCTION_BOUNDARY_MARKER
  );
  const leakTerra = countOcc(
    terra.lastUser,
    DEEPSEEK_COMPACT_FUTURE_INSTRUCTION_BOUNDARY_MARKER
  );
  const leakOpus = countOcc(
    opus.lastUser,
    DEEPSEEK_COMPACT_FUTURE_INSTRUCTION_BOUNDARY_MARKER
  );
  if (leakAuto !== 0) reasons.push("auto_progression_boundary_leak");
  if (leakCo !== 0) reasons.push("co_narration_boundary_leak");
  if (leakSim !== 0) reasons.push("simulation_boundary_leak");
  if (leakParty !== 0) reasons.push("party_boundary_leak");
  if (leakTerra !== 0) reasons.push("terra_boundary_leak");
  if (leakOpus !== 0) reasons.push("opus_boundary_leak");

  const results = {
    status: reasons.length === 0 ? "PASS" : "FAIL",
    frozen_arm_e_sha256: armESha,
    expected_arm_e_sha256: FROZEN_ARM_E_SHA256,
    terra_terminal_sha256: terraSha,
    deepseek_style_sha256: dsStyleSha,
    user_tail_sha256: userTailSha,
    arm_f_absent: opusF === 0,
    counts: {
      opus_standard: {
        collaborative: opusCollab,
        arm_e: opusArmE,
        numeric_tail: opusTail,
        scene_directive: opusScene,
      },
      terra: { terminal: terraTerm, arm_e: terraArmE },
      deepseek: {
        style: dsStyle,
        compact_future_boundary: dsBoundary,
        numeric_tail: dsTail,
        arm_e: dsArmE,
      },
    },
    leak_checks: {
      opus_auto_arm_e: countOcc(opusAuto.lastUser, OPUS_ARM_E_TERMINAL_MARKER),
      opus_conarration_arm_e: countOcc(opusCo.lastUser, OPUS_ARM_E_TERMINAL_MARKER),
      opus_simulation_arm_e: countOcc(opusSim.lastUser, OPUS_ARM_E_TERMINAL_MARKER),
      deepseek_auto_boundary: leakAuto,
      deepseek_conarration_boundary: leakCo,
      deepseek_simulation_boundary: leakSim,
      deepseek_party_boundary: leakParty,
      terra_boundary: leakTerra,
      opus_boundary: leakOpus,
    },
    reasons,
  };
  save("OFFLINE_RESULTS.json", results);
  save(
    "PROMPT_OWNER_MATRIX.md",
    `# PROMPT_OWNER_MATRIX — Final production Opus E + DeepSeek compact boundary

| Path | collaborative | numeric USER_TAIL | Arm E | Terra terminal | DeepSeek style | DeepSeek compact future boundary | Arm F |
|---|---|---|---|---|---|---|---|
| Opus standard interactive character | 1 | 0 | 1 | 0 | 0 | 0 | 0 |
| Opus auto progression | 0/mode | 1 | 0 | 0 | 0 | 0 | 0 |
| Opus co-narration | mode | 1 | 0 | 0 | 0 | 0 | 0 |
| Opus simulation | mode | 1 | 0 | 0 | 0 | 0 | 0 |
| Terra single_primary | 1 | 0 | 0 | 1 | 0 | 0 | 0 |
| DeepSeek standard interactive character | 1 | 1 | 0 | 0 | 1 | 1 | 0 |
| DeepSeek auto / co-narration / simulation / party | mode | 1 | 0 | 0 | style? | 0 | 0 |

Frozen Arm E SHA-256: \`${FROZEN_ARM_E_SHA256}\`
Frozen Terra terminal SHA-256: \`${FROZEN_TERRA_TERMINAL_SHA256}\`
Frozen DeepSeek style SHA-256: \`${FROZEN_DEEPSEEK_STYLE_SHA256}\`
`
  );
  console.log(JSON.stringify(results, null, 2));
  if (reasons.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
