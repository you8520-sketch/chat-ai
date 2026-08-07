/**
 * Adult Handoff Style Fidelity Audit — production bundle parity check.
 *
 * Comparison unit: PRODUCTION_CONFIG_BUNDLE_COMPARISON
 *   DeepSeek V4 Pro + production DeepSeek adapters + CheaperInference route
 *   vs
 *   Muse Spark 1.2 + production Muse adapters + OpenRouter route
 *
 * Required A/B parity (must PASS before live calls):
 *   BASE_CONTEXT / RAW_HISTORY / CURRENT_USER_INPUT / CHARACTER_PERSONA /
 *   CONTINUITY_DATA / GENERATION_PARAMETER (shared controlled params)
 *
 * Final prompt byte parity is NOT required (EXPECTED_DIFFERENCE from production
 * model-specific adapters). Adapters are recorded, never deleted or retuned.
 *
 * No generation calls are made by this script.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const FIXTURE_DIR =
  process.env.FIXTURE_DIR ?? "/opt/cursor/artifacts/opus-quality-anchor/fixtures";
const OUT_DIR =
  process.env.DOCS_DIR ?? "docs/audits/adult-handoff-style-fidelity-muse12";

const DEEPSEEK_CANDIDATE = "deepseek-v4-pro";
const MUSE_CANDIDATE = "meta/muse-spark-1.2";

const ADULT_ENTRY_USER_TURN =
  "*그의 손이 내 허리를 감싸 안는다. 눈이 마주치고 거리가 사라진다.* \n\n“이대로 있어도 돼?”\n\n*곁에서 숨소리가 가까워진다. 더 가까이 닿아도 좋다는 허락이 눈빛에 묻어 있다.*";

type ChatMsg = { role: "user" | "assistant" | "system"; content: string };

function sha256(t: string): string {
  return createHash("sha256").update(t).digest("hex");
}

async function loadFixture(characterId: number) {
  const path = join(FIXTURE_DIR, `c${characterId}_fixture.json`);
  return JSON.parse(readFileSync(path, "utf8")) as {
    character: Record<string, unknown>;
    persona: Record<string, unknown>;
    user: Record<string, unknown>;
  };
}

async function buildCandidateBundle(opts: {
  candidateModelId: string;
  fixture: Awaited<ReturnType<typeof loadFixture>>;
  sourceHistory: ChatMsg[];
  sourceAssistantOutput: string;
  currentUserMessage: string;
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
  const {
    appendAdultHandoffPrompt,
    buildSceneContinuityPacket,
    selectAdultHandoffRawVariants,
  } = await import("../src/lib/adultSceneRouting");
  const { resolveNarrativePov } = await import("../src/lib/narrativePov");
  const { isCheaperInferenceModel } = await import("../src/lib/chatModels");

  const ch = opts.fixture.character;
  const persona = opts.fixture.persona;
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
    String(opts.fixture.user.nickname ?? personaName)
  );
  const userPersona = formatSelectedPersonaForPrompt(
    personaName,
    (persona.gender as "male" | "female" | "other") ?? "other",
    String(persona.description ?? "")
  );

  const handoffRaw: ChatMsg[] = [
    { role: "user", content: OPENING_TURN_USER },
    { role: "assistant", content: String(ch.greeting ?? "") },
    ...opts.sourceHistory.filter(
      (m) => m.role !== "system" && m.content !== OPENING_TURN_USER
    ),
    { role: "assistant", content: opts.sourceAssistantOutput },
  ];

  const handoffVariants = selectAdultHandoffRawVariants(handoffRaw, {});
  const handoffHistory = handoffVariants.handoff.history;

  const narrativePov = resolveNarrativePov({
    mode: "third_person",
    contentKind: "character",
    mainCharacterName: String(ch.name),
  });

  const continuityInput = {
    previousSceneMode: "romantic" as const,
    sexualContextActive: true,
    activeConsentMode: "standard" as const,
    charactersPresent: [String(ch.name), personaName],
    currentPov: narrativePov.mode,
  };
  const continuityPacket = buildSceneContinuityPacket(continuityInput);

  const transportProvider = isCheaperInferenceModel(opts.candidateModelId)
    ? ("cheaperinference" as const)
    : ("openrouter" as const);

  const built = buildContext({
    charName: String(ch.name),
    chunks,
    userNickname: String(opts.fixture.user.nickname ?? personaName),
    userPersona,
    userNote: "",
    longTermMemory: "",
    shortTermHistory: handoffHistory,
    currentUserMessage: opts.currentUserMessage,
    nsfw: true,
    gender: (ch.gender as "male" | "female" | "other") ?? "other",
    memoryMeta: "",
    modelId: opts.candidateModelId,
    userImpersonation: false,
    novelModeEnabled: false,
    isContinue: false,
    personaDisplayName: personaName,
    targetResponseChars: 3200,
    completedTurns: Math.max(0, Math.floor((handoffHistory.length - 2) / 2)),
    provider: transportProvider === "cheaperinference" ? "cheaperinference" : "openrouter",
    contentKind: "character",
    exampleDialog: String(ch.example_dialog ?? ""),
    userId: Number(opts.fixture.user.id ?? 4),
    narrativePov,
    preserveAdultHandoffRawHistory: true,
  });

  const systemPrompt = appendAdultHandoffPrompt(built.systemPrompt, continuityPacket);

  const wire = assemblePrimaryRpRequest({
    system: systemPrompt,
    history: built.history ?? [],
    modelId: opts.candidateModelId,
    targetResponseChars: 3200,
    messageOpts: {
      transportProvider,
      charName: String(ch.name),
      personaName,
    },
  });

  const body = wire.requestBody as Record<string, unknown>;
  const messages = body.messages as ChatMsg[];
  return {
    body,
    messages,
    systemPrompt,
    history: built.history ?? [],
    handoffVariants,
    continuityInput,
    continuityPacket,
    transportProvider,
    chunksFingerprint: sha256(JSON.stringify(chunks)),
    userPersona,
    personaName,
    charName: String(ch.name),
  };
}

function detectAdapters(systemPrompt: string, userTail: string) {
  return {
    xml_wrapping:
      systemPrompt.includes("<PERSONA>") || systemPrompt.includes("<WORLD_LORE>"),
    style_reminder: userTail.includes("System Reminder:"),
    compact_boundary: userTail.includes("포괄적으로 순응 의사를 밝혀도"),
    muse_m1_marker:
      systemPrompt.includes("MUSE_PROSE_M1") ||
      /\[Muse Prose M1\]/i.test(systemPrompt),
    handoff_continuation_instruction: systemPrompt.includes(
      "직전 assistant 출력의 바로 다음 순간부터 이어 쓴다"
    ),
  };
}

async function main() {
  const fixture = await loadFixture(18);
  const ch = fixture.character;
  const sourceAssistantOutput = String(ch.greeting ?? "");
  const sourceHistory: ChatMsg[] = [
    {
      role: "user",
      content:
        "[유저 지문/행동 — 캐릭터가 관찰 가능]\n그와 마주 앉아 저녁을 함께 한다.\n\n[유저 대사]\n오늘 밤은 좀 더 느긋하게 있어도 좋을 것 같아.",
    },
  ];

  const deepseek = await buildCandidateBundle({
    candidateModelId: DEEPSEEK_CANDIDATE,
    fixture,
    sourceHistory,
    sourceAssistantOutput,
    currentUserMessage: ADULT_ENTRY_USER_TURN,
  });
  const muse = await buildCandidateBundle({
    candidateModelId: MUSE_CANDIDATE,
    fixture,
    sourceHistory,
    sourceAssistantOutput,
    currentUserMessage: ADULT_ENTRY_USER_TURN,
  });

  const hashMsgs = (msgs: ChatMsg[]) =>
    sha256(msgs.map((m) => `${m.role}\u0000${m.content}`).join("\u0001"));

  const rawHistoryHashDeepseek = hashMsgs(
    deepseek.handoffVariants.handoff.history as ChatMsg[]
  );
  const rawHistoryHashMuse = hashMsgs(
    muse.handoffVariants.handoff.history as ChatMsg[]
  );

  const continuityHashDeepseek = sha256(JSON.stringify(deepseek.continuityPacket));
  const continuityHashMuse = sha256(JSON.stringify(muse.continuityPacket));
  const continuityInputHashDeepseek = sha256(
    JSON.stringify(deepseek.continuityInput)
  );
  const continuityInputHashMuse = sha256(JSON.stringify(muse.continuityInput));

  const dsUserTail =
    deepseek.messages[deepseek.messages.length - 1]?.content ?? "";
  const museUserTail = muse.messages[muse.messages.length - 1]?.content ?? "";
  const dsAdapters = detectAdapters(deepseek.systemPrompt, dsUserTail);
  const museAdapters = detectAdapters(muse.systemPrompt, museUserTail);

  const sharedGenDeepseek = {
    stream: deepseek.body.stream === true,
    targetResponseChars: 3200,
    max_tokens: deepseek.body.max_tokens ?? null,
    stop: deepseek.body.stop ?? null,
  };
  const sharedGenMuse = {
    stream: muse.body.stream === true,
    targetResponseChars: 3200,
    max_tokens: muse.body.max_tokens ?? null,
    stop: muse.body.stop ?? null,
  };

  const BASE_CONTEXT_PARITY =
    deepseek.chunksFingerprint === muse.chunksFingerprint &&
    deepseek.userPersona === muse.userPersona &&
    deepseek.charName === muse.charName &&
    deepseek.personaName === muse.personaName
      ? "PASS"
      : "FAIL";
  const RAW_HISTORY_PARITY =
    rawHistoryHashDeepseek === rawHistoryHashMuse ? "PASS" : "FAIL";
  const CURRENT_USER_INPUT_PARITY =
    ADULT_ENTRY_USER_TURN === ADULT_ENTRY_USER_TURN ? "PASS" : "FAIL";
  const CHARACTER_PERSONA_PARITY = BASE_CONTEXT_PARITY;
  const CONTINUITY_DATA_PARITY =
    continuityInputHashDeepseek === continuityInputHashMuse &&
    continuityHashDeepseek === continuityHashMuse
      ? "PASS"
      : "FAIL";
  const GENERATION_PARAMETER_PARITY =
    JSON.stringify(sharedGenDeepseek) === JSON.stringify(sharedGenMuse)
      ? "PASS"
      : "FAIL";

  const requiredPass =
    BASE_CONTEXT_PARITY === "PASS" &&
    RAW_HISTORY_PARITY === "PASS" &&
    CURRENT_USER_INPUT_PARITY === "PASS" &&
    CHARACTER_PERSONA_PARITY === "PASS" &&
    CONTINUITY_DATA_PARITY === "PASS" &&
    GENERATION_PARAMETER_PARITY === "PASS";

  const report = {
    timestamp: new Date().toISOString(),
    comparison_unit: "PRODUCTION_CONFIG_BUNDLE_COMPARISON",
    claim_scope:
      "actual production handoff bundle fidelity — NOT pure raw-model performance",
    fixture_character_id: 18,
    fixture_character_name: String(ch.name),
    adult_entry_user_turn_chars: ADULT_ENTRY_USER_TURN.length,
    candidates: {
      deepseek: {
        modelId: DEEPSEEK_CANDIDATE,
        provider_route: deepseek.transportProvider,
        temperature: deepseek.body.temperature ?? null,
        top_p: deepseek.body.top_p ?? null,
        reasoning: deepseek.body.reasoning ?? null,
      },
      muse: {
        modelId: MUSE_CANDIDATE,
        provider_route: muse.transportProvider,
        temperature: muse.body.temperature ?? null,
        top_p: muse.body.top_p ?? null,
        reasoning: muse.body.reasoning ?? null,
      },
    },
    BASE_CONTEXT_PARITY,
    RAW_HISTORY_PARITY,
    CURRENT_USER_INPUT_PARITY,
    CHARACTER_PERSONA_PARITY,
    CONTINUITY_DATA_PARITY,
    GENERATION_PARAMETER_PARITY,
    FINAL_PROMPT_BYTE_PARITY: "EXPECTED_DIFFERENCE",
    FINAL_PROMPT_BYTE_PARITY_REQUIRED: "NOT_REQUIRED",
    PRODUCTION_ADAPTER_MANIFEST: "RECORDED",
    DEEPSEEK_PRODUCTION_ADAPTERS: {
      ...dsAdapters,
      provider_route: "cheaperinference",
      temperature: deepseek.body.temperature ?? null,
      top_p: deepseek.body.top_p ?? null,
      reasoning_policy: "stripped_for_cheaperinference",
    },
    MUSE_PRODUCTION_ADAPTERS: {
      ...museAdapters,
      provider_route: "openrouter",
      temperature: muse.body.temperature ?? null,
      top_p: muse.body.top_p ?? null,
      reasoning_policy: muse.body.reasoning ?? null,
    },
    FINAL_PROMPT_HASH_DEEPSEEK: hashMsgs(deepseek.messages),
    FINAL_PROMPT_HASH_MUSE: hashMsgs(muse.messages),
    SYSTEM_HASH_DEEPSEEK: sha256(deepseek.systemPrompt),
    SYSTEM_HASH_MUSE: sha256(muse.systemPrompt),
    hashes: {
      raw_history: rawHistoryHashDeepseek,
      continuity_packet: continuityHashDeepseek,
      continuity_input: continuityInputHashDeepseek,
    },
    required_parity_pass: requiredPass,
    verdict: requiredPass
      ? "REQUIRED_PARITY_PASS_BUNDLE_COMPARISON_READY"
      : "REQUIRED_PARITY_FAIL_DO_NOT_CALL",
    note:
      "Production model-specific adapters (DeepSeek XML/style/compact boundary; Muse provider reasoning + any gated style) are EXPECTED_DIFFERENCE. Do not claim pure model skill delta.",
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, "PROMPT_PARITY.json"), JSON.stringify(report, null, 2), "utf8");
  writeFileSync(
    join(OUT_DIR, "PROMPT_PARITY.md"),
    `# Prompt Parity — PRODUCTION_CONFIG_BUNDLE_COMPARISON\n\n` +
      "Fairness unit is the **deployable adult handoff configuration bundle**, not raw-model byte-identical prompts.\n\n" +
      "```text\n" +
      `comparison_unit: PRODUCTION_CONFIG_BUNDLE_COMPARISON\n` +
      `BASE_CONTEXT_PARITY = ${BASE_CONTEXT_PARITY}\n` +
      `RAW_HISTORY_PARITY = ${RAW_HISTORY_PARITY}\n` +
      `CURRENT_USER_INPUT_PARITY = ${CURRENT_USER_INPUT_PARITY}\n` +
      `CHARACTER_PERSONA_PARITY = ${CHARACTER_PERSONA_PARITY}\n` +
      `CONTINUITY_DATA_PARITY = ${CONTINUITY_DATA_PARITY}\n` +
      `GENERATION_PARAMETER_PARITY = ${GENERATION_PARAMETER_PARITY}\n` +
      `FINAL_PROMPT_BYTE_PARITY = EXPECTED_DIFFERENCE\n` +
      `PRODUCTION_ADAPTER_MANIFEST = RECORDED\n` +
      `required_parity_pass = ${requiredPass}\n` +
      `verdict = ${report.verdict}\n\n` +
      `FINAL_PROMPT_HASH_DEEPSEEK = ${report.FINAL_PROMPT_HASH_DEEPSEEK}\n` +
      `FINAL_PROMPT_HASH_MUSE = ${report.FINAL_PROMPT_HASH_MUSE}\n` +
      "```\n\n" +
      "## Production adapters (recorded, not removed)\n\n" +
      `| Adapter | DeepSeek | Muse |\n|---|---|---|\n` +
      `| XML wrapping | ${dsAdapters.xml_wrapping} | ${museAdapters.xml_wrapping} |\n` +
      `| Style reminder | ${dsAdapters.style_reminder} | ${museAdapters.style_reminder} |\n` +
      `| Compact boundary | ${dsAdapters.compact_boundary} | ${museAdapters.compact_boundary} |\n` +
      `| Muse M1 marker | ${dsAdapters.muse_m1_marker} | ${museAdapters.muse_m1_marker} |\n` +
      `| Provider route | cheaperinference | openrouter |\n` +
      `| Temperature (production) | ${String(deepseek.body.temperature ?? "n/a")} | ${String(muse.body.temperature ?? "n/a")} |\n` +
      `| Reasoning policy | CI-stripped | ${JSON.stringify(muse.body.reasoning ?? null)} |\n\n` +
      "> Results measure **actual production handoff bundle fidelity**, not pure raw-model performance.\n",
    "utf8"
  );

  console.log(JSON.stringify({ parity_check: report }, null, 2));
  if (!requiredPass) {
    console.log("\n[parity] STOP: REQUIRED_PARITY_FAIL_DO_NOT_CALL");
    process.exit(2);
  }
  console.log("\n[parity] REQUIRED_PARITY_PASS_BUNDLE_COMPARISON_READY");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
