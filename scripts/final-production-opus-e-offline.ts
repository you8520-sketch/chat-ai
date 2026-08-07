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
    OPUS_ARM_E_TERMINAL,
    OPUS_ARM_E_TERMINAL_MARKER,
    OPUS_ARM_F_REJECTED_STOP_MARKER,
  } = await import("../src/lib/opusTerminalLengthOwner");

  const armESha = createHash("sha256").update(OPUS_ARM_E_TERMINAL).digest("hex");
  if (armESha !== FROZEN_ARM_E_SHA256) {
    reasons.push(`opus_arm_e_sha_mismatch:${armESha}`);
  }
  if (OPUS_ARM_E_TERMINAL.includes(OPUS_ARM_F_REJECTED_STOP_MARKER)) {
    reasons.push("arm_f_present_in_constant");
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

  // DeepSeek — style reminder + numeric tail; no Arm E
  const ds = await assemble({
    modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
    contentKind: "character",
    userMessage: msg,
  });
  const dsStyle = countOcc(ds.lastUser, DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY);
  const dsTail = countOcc(ds.lastUser, USER_TAIL_LENGTH_OWNER_SENTENCE);
  const dsArmE = countOcc(ds.lastUser, OPUS_ARM_E_TERMINAL_MARKER);
  if (dsStyle < 1) reasons.push(`deepseek_style_${dsStyle}`);
  if (dsTail !== 1) reasons.push(`deepseek_tail_${dsTail}`);
  if (dsArmE !== 0) reasons.push(`deepseek_arm_e_${dsArmE}`);

  const results = {
    status: reasons.length === 0 ? "PASS" : "FAIL",
    frozen_arm_e_sha256: armESha,
    expected_arm_e_sha256: FROZEN_ARM_E_SHA256,
    arm_f_absent: opusF === 0,
    counts: {
      opus_standard: {
        collaborative: opusCollab,
        arm_e: opusArmE,
        numeric_tail: opusTail,
        scene_directive: opusScene,
      },
      terra: { terminal: terraTerm, arm_e: terraArmE },
      deepseek: { style: dsStyle, numeric_tail: dsTail, arm_e: dsArmE },
    },
    leak_checks: {
      opus_auto_arm_e: countOcc(opusAuto.lastUser, OPUS_ARM_E_TERMINAL_MARKER),
      opus_conarration_arm_e: countOcc(opusCo.lastUser, OPUS_ARM_E_TERMINAL_MARKER),
      opus_simulation_arm_e: countOcc(opusSim.lastUser, OPUS_ARM_E_TERMINAL_MARKER),
    },
    reasons,
  };
  save("OFFLINE_RESULTS.json", results);
  save(
    "PROMPT_OWNER_MATRIX.md",
    `# PROMPT_OWNER_MATRIX — Final production Opus E integration

| Path | collaborative | numeric USER_TAIL | Arm E | Terra terminal | DeepSeek style | Arm F |
|---|---|---|---|---|---|---|
| Opus standard interactive character | 1 | 0 | 1 | 0 | 0 | 0 |
| Opus auto progression | 0/mode | 1 | 0 | 0 | 0 | 0 |
| Opus co-narration | mode | 1 | 0 | 0 | 0 | 0 |
| Opus simulation | mode | 1 | 0 | 0 | 0 | 0 |
| Terra single_primary | 1 | 0 | 0 | 1 | 0 | 0 |
| DeepSeek standard | 1 | 1 | 0 | 0 | 1 | 0 |

Frozen Arm E SHA-256: \`${FROZEN_ARM_E_SHA256}\`
`
  );
  console.log(JSON.stringify(results, null, 2));
  if (reasons.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
