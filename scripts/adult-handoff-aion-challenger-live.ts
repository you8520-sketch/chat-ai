/**
 * Adult Handoff — Aion Challenger Add-on (exactly 3 API calls).
 *
 * Reuses the same Opus / Terra / Gemini source anchors as the Muse vs DeepSeek
 * fidelity audit. Does NOT re-call DeepSeek or Muse.
 *
 * comparison_unit: PRODUCTION_CONFIG_BUNDLE_COMPARISON
 * model: aion-labs.aion-2-0 (past production Aion adult handoff primary)
 * retry / continuation / recovery / fallback = 0
 * Aion Length V2 / two-chunk / recovery / reasoning = NOT_RUN
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const FIXTURE_DIR =
  process.env.FIXTURE_DIR ?? "/opt/cursor/artifacts/opus-quality-anchor/fixtures";
const OUT_ROOT =
  process.env.OUT_ROOT ??
  "/opt/cursor/artifacts/adult-handoff-aion-challenger";
const DOCS =
  process.env.DOCS_DIR ?? "docs/audits/adult-handoff-aion-challenger";
const PRIOR_FIDELITY_ROOT =
  process.env.PRIOR_FIDELITY_ROOT ??
  "/opt/cursor/artifacts/adult-handoff-style-fidelity";

const AION_CANDIDATE = "aion-labs.aion-2-0";

const ADULT_ENTRY_USER_TURN =
  "*그의 손이 내 허리를 감싸 안는다. 눈이 마주치고 거리가 사라진다.* \n\n“이대로 있어도 돼?”\n\n*곁에서 숨소리가 가까워진다. 더 가까이 닿아도 좋다는 허락이 눈빛에 묻어 있다.*";

type ChatMsg = { role: "user" | "assistant" | "system"; content: string };

type SourceDef = {
  id: "opus" | "terra" | "gemini";
  label: string;
  characterId: number;
  anchorPath: string;
  priorTurns: Array<{ user: string; assistantPath: string }>;
  existingWinner: "muse" | "deepseek";
  existingWinnerModel: string;
  humanApproved: boolean;
  humanApprovalNote: string;
};

const SOURCES: SourceDef[] = [
  {
    id: "opus",
    label: "Claude Opus 5 (Arm E)",
    characterId: 5,
    anchorPath:
      "/opt/cursor/artifacts/opus-instruction-boundary/live/s5_relationship_hand/arm-E/run1/turn2-provider-raw.txt",
    priorTurns: [
      {
        user: "*렌은 내민 손을 잡는다.* 그다음에는 어떻게 할까요?",
        assistantPath:
          "/opt/cursor/artifacts/opus-instruction-boundary/live/s5_relationship_hand/arm-E/run1/turn1-provider-raw.txt",
      },
    ],
    existingWinner: "muse",
    existingWinnerModel: "meta/muse-spark-1.2",
    humanApproved: true,
    humanApprovalNote:
      "docs/audits/OPUS_AUDIT_57_59_FINAL_FREEZE.md — ARM_E_ACCEPTED / FINAL_HUMAN_REVIEW_PASS",
  },
  {
    id: "terra",
    label: "GPT-5.6 Terra",
    characterId: 10,
    anchorPath:
      "/opt/cursor/artifacts/final-production-model-smoke/live/terra_action/run1/turn1-provider-raw.txt",
    priorTurns: [],
    existingWinner: "deepseek",
    existingWinnerModel: "deepseek-v4-pro-0813",
    humanApproved: true,
    humanApprovalNote:
      "docs/audits/final-production-model-smoke/STATUS.md — TERRA_PROSE_PASS / FINAL_HUMAN_REVIEW_PASS",
  },
  {
    id: "gemini",
    label: "Gemini 3.1 Pro",
    characterId: 18,
    anchorPath:
      "/opt/cursor/artifacts/gemini31-opus5-minimal-screen/gemini31/relationship/run1/turn2-provider-raw.txt",
    priorTurns: [
      {
        user: "난 본기억없는데.... 나는 렌이라고 부르면 돼. *고개끄덕임* 신입 맞아.",
        assistantPath:
          "/opt/cursor/artifacts/gemini31-opus5-minimal-screen/gemini31/relationship/run1/turn1-provider-raw.txt",
      },
    ],
    existingWinner: "muse",
    existingWinnerModel: "meta/muse-spark-1.2",
    humanApproved: false,
    humanApprovalNote:
      "No formal human PASS / PRODUCTION_READY document in repo for Audit 55 Gemini relationship outputs.",
  },
];

function sha256(t: string): string {
  return createHash("sha256").update(t).digest("hex");
}

function save(dir: string, name: string, content: string | object) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, name),
    typeof content === "string" ? content : JSON.stringify(content, null, 2),
    "utf8"
  );
}

function hashMsgs(msgs: ChatMsg[]): string {
  return sha256(msgs.map((m) => `${m.role}\u0000${m.content}`).join("\u0001"));
}

type StreamState = {
  text: string;
  finish: string | null;
  usage: Record<string, unknown> | null;
  resolved: string | null;
  sawDone: boolean;
};

function processSseLine(line: string, state: StreamState): void {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return;
  const data = trimmed.slice(5).trim();
  if (!data) return;
  if (data === "[DONE]") {
    state.sawDone = true;
    return;
  }
  let ev: Record<string, unknown>;
  try {
    ev = JSON.parse(data) as Record<string, unknown>;
  } catch {
    return;
  }
  if (typeof ev.model === "string") state.resolved = ev.model;
  const choices = ev.choices as Array<Record<string, unknown>> | undefined;
  const choice0 = choices?.[0];
  const delta = choice0?.delta as Record<string, unknown> | undefined;
  const content =
    typeof delta?.content === "string"
      ? delta.content
      : typeof (choice0?.message as Record<string, unknown> | undefined)?.content ===
          "string"
        ? String((choice0!.message as Record<string, unknown>).content)
        : "";
  if (content) state.text += content;
  if (typeof choice0?.finish_reason === "string" && choice0.finish_reason) {
    state.finish = choice0.finish_reason;
  }
  if (ev.usage && typeof ev.usage === "object") {
    state.usage = ev.usage as Record<string, unknown>;
  }
}

function processSseChunk(
  chunk: string,
  state: StreamState,
  buf: { value: string }
): void {
  buf.value += chunk;
  const parts = buf.value.split("\n");
  buf.value = parts.pop() ?? "";
  for (const line of parts) processSseLine(line, state);
}

function flushRemainingSseBuffer(
  dec: TextDecoder,
  buf: { value: string },
  state: StreamState
): void {
  const tail = dec.decode();
  if (tail) buf.value += tail;
  if (buf.value.trim()) {
    processSseLine(buf.value, state);
    buf.value = "";
  }
}

async function streamProvider(
  endpoint: string,
  headers: Record<string, string>,
  body: Record<string, unknown>
) {
  const started = Date.now();
  const state: StreamState = {
    text: "",
    finish: null,
    usage: null,
    resolved: null,
    sawDone: false,
  };
  try {
    const { Agent } = await import("undici");
    const dispatcher = new Agent({
      headersTimeout: 10 * 60_000,
      bodyTimeout: 0,
      connectTimeout: 60_000,
    });
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      // @ts-expect-error Node fetch undici dispatcher
      dispatcher,
    });
    if (!res.ok) {
      return {
        text: "",
        latency_s: (Date.now() - started) / 1000,
        finish_reason: null as string | null,
        usage: null as Record<string, unknown> | null,
        resolved_model: null as string | null,
        saw_done: false,
        error: (await res.text()).slice(0, 2000),
        http_status: res.status,
      };
    }
    const reader = res.body?.getReader();
    if (!reader) throw new Error("no body");
    const dec = new TextDecoder();
    const buf = { value: "" };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      processSseChunk(dec.decode(value, { stream: true }), state, buf);
    }
    flushRemainingSseBuffer(dec, buf, state);
    return {
      text: state.text,
      latency_s: (Date.now() - started) / 1000,
      finish_reason: state.finish,
      usage: state.usage,
      resolved_model: state.resolved,
      saw_done: state.sawDone,
      error: null as string | null,
      http_status: 200,
    };
  } catch (e) {
    return {
      text: state.text,
      latency_s: (Date.now() - started) / 1000,
      finish_reason: state.finish,
      usage: state.usage,
      resolved_model: state.resolved,
      saw_done: state.sawDone,
      error: String(e),
      http_status: 0,
    };
  }
}

function extractUsage(usage: Record<string, unknown> | null) {
  if (!usage) {
    return {
      input_tokens: null as number | null,
      cached_input_tokens: null as number | null,
      visible_output_tokens: null as number | null,
      reasoning_tokens: null as number | null,
      usage_cost_usd: null as number | null,
    };
  }
  const details =
    (usage.completion_tokens_details as Record<string, unknown> | undefined) ??
    {};
  const promptDetails =
    (usage.prompt_tokens_details as Record<string, unknown> | undefined) ?? {};
  return {
    input_tokens:
      typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : null,
    cached_input_tokens:
      typeof promptDetails.cached_tokens === "number"
        ? promptDetails.cached_tokens
        : null,
    visible_output_tokens:
      typeof usage.completion_tokens === "number"
        ? usage.completion_tokens
        : null,
    reasoning_tokens:
      typeof details.reasoning_tokens === "number"
        ? details.reasoning_tokens
        : null,
    usage_cost_usd: typeof usage.cost === "number" ? usage.cost : null,
  };
}

async function loadFixture(characterId: number) {
  const path = join(FIXTURE_DIR, `c${characterId}_fixture.json`);
  if (!existsSync(path)) throw new Error(`missing ${path}`);
  return JSON.parse(readFileSync(path, "utf8")) as {
    character: Record<string, unknown>;
    persona: Record<string, unknown>;
    user: Record<string, unknown>;
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

/** Production Aion adult handoff bundle via current assemble path (no new tuning). */
async function assembleBundle(opts: {
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
    ...opts.sourceHistory,
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
    provider:
      transportProvider === "cheaperinference" ? "cheaperinference" : "openrouter",
    contentKind: "character",
    exampleDialog: String(ch.example_dialog ?? ""),
    userId: Number(opts.fixture.user.id ?? 4),
    narrativePov,
    preserveAdultHandoffRawHistory: true,
  });

  const systemPrompt = appendAdultHandoffPrompt(
    built.systemPrompt,
    continuityPacket
  );

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

  const requestBody = {
    ...(wire.requestBody as Record<string, unknown>),
    stream: true,
    stream_options: { include_usage: true },
  };
  const messages = requestBody.messages as ChatMsg[];
  const userTail = messages[messages.length - 1]?.content ?? "";

  return {
    requestBody,
    messages,
    systemPrompt,
    handoffVariants,
    continuityInput,
    continuityPacket,
    transportProvider,
    chunksFingerprint: sha256(JSON.stringify(chunks)),
    userPersona,
    personaName,
    charName: String(ch.name),
    adapters: detectAdapters(systemPrompt, userTail),
    sharedGen: {
      stream: requestBody.stream === true,
      targetResponseChars: 3200,
      max_tokens: requestBody.max_tokens ?? null,
      stop: requestBody.stop ?? null,
    },
  };
}

function buildSourceHistory(source: SourceDef): {
  sourceHistory: ChatMsg[];
  sourceAssistantOutput: string;
} {
  const sourceAssistantOutput = readFileSync(source.anchorPath, "utf8");
  const sourceHistory: ChatMsg[] = [];
  for (const t of source.priorTurns) {
    sourceHistory.push({ role: "user", content: t.user });
    sourceHistory.push({
      role: "assistant",
      content: readFileSync(t.assistantPath, "utf8"),
    });
  }
  if (source.id === "terra") {
    sourceHistory.push({
      role: "user",
      content:
        "*멀리서 비명과 금속 마찰음이 겹친다. 렌은 에녹 쪽으로 몸을 낮춘다.* 저쪽이에요. 같이 가요?",
    });
  } else if (source.id === "opus") {
    sourceHistory.push({
      role: "user",
      content: "…알겠어요. 그다음에 어떻게 하면 좋을지 말해 주세요.",
    });
  } else if (source.id === "gemini") {
    sourceHistory.push({
      role: "user",
      content: "너는 이름이뭐야? 뭐하는 중이었어?",
    });
  }
  return { sourceHistory, sourceAssistantOutput };
}

async function main() {
  mkdirSync(OUT_ROOT, { recursive: true });
  mkdirSync(DOCS, { recursive: true });

  const {
    CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
    buildCheaperInferenceHeaders,
  } = await import("../src/lib/cheaperInferenceConfig");
  const { visibleAssistantDisplayCharCount } = await import(
    "../src/lib/chatDisplayLength"
  );

  let apiCalls = 0;
  const maxCalls = 3;
  const callRows: Record<string, unknown>[] = [];
  const adapterBySource: Record<string, unknown> = {};

  for (const source of SOURCES) {
    const fixture = await loadFixture(source.characterId);
    const { sourceHistory, sourceAssistantOutput } = buildSourceHistory(source);

    const winnerRawPath = join(
      PRIOR_FIDELITY_ROOT,
      "live",
      source.id,
      source.existingWinner,
      "run1",
      "provider-raw.txt"
    );
    const winnerMetaPath = join(
      PRIOR_FIDELITY_ROOT,
      "live",
      source.id,
      source.existingWinner,
      "run1",
      "meta.json"
    );
    if (!existsSync(winnerRawPath) || !existsSync(winnerMetaPath)) {
      throw new Error(`missing prior winner artifacts for ${source.id}`);
    }

    const aion = await assembleBundle({
      candidateModelId: AION_CANDIDATE,
      fixture,
      sourceHistory,
      sourceAssistantOutput,
      currentUserMessage: ADULT_ENTRY_USER_TURN,
    });

    adapterBySource[source.id] = {
      ...aion.adapters,
      provider_route: aion.transportProvider,
      temperature: aion.requestBody.temperature ?? null,
      top_p: aion.requestBody.top_p ?? null,
      reasoning: aion.requestBody.reasoning ?? null,
      model: AION_CANDIDATE,
      existing_winner: source.existingWinner,
      existing_winner_model: source.existingWinnerModel,
      continuity_packet_hash: sha256(JSON.stringify(aion.continuityPacket)),
      handoff_history_hash: hashMsgs(
        aion.handoffVariants.handoff.history as ChatMsg[]
      ),
      CURRENT_USER_INPUT_PARITY:
        ADULT_ENTRY_USER_TURN.length > 0 ? "PASS" : "FAIL",
      FINAL_PROMPT_HASH_AION: hashMsgs(aion.messages),
      SYSTEM_HASH_AION: sha256(aion.systemPrompt),
    };
    save(join(OUT_ROOT, "parity", source.id), "aion-adapters.json", adapterBySource[source.id]);
    save(join(OUT_ROOT, "parity", source.id), "continuity-packet.json", aion.continuityPacket);
    save(join(OUT_ROOT, "parity", source.id), "aion-messages.json", aion.messages);

    const dir = join(OUT_ROOT, "live", source.id, "aion", "run1");
    const rawPath = join(dir, "provider-raw.txt");

    if (existsSync(rawPath)) {
      console.log(`reuse existing ${source.id}/aion`);
      const meta = JSON.parse(
        readFileSync(join(dir, "meta.json"), "utf8")
      ) as Record<string, unknown>;
      callRows.push({ ...meta, reused: true });
      continue;
    }

    if (apiCalls >= maxCalls) {
      throw new Error(`API_CALL_BUDGET_EXCEEDED:${apiCalls}/${maxCalls}`);
    }
    if (aion.transportProvider !== "cheaperinference") {
      throw new Error(`AION_EXPECTED_CHEAPERINFERENCE:${aion.transportProvider}`);
    }

    console.log(`\n=== ${source.id} → aion (call ${apiCalls + 1}/${maxCalls}) ===`);
    apiCalls += 1;
    const resp = await streamProvider(
      CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
      buildCheaperInferenceHeaders(),
      aion.requestBody
    );

    if (resp.http_status !== 200 || resp.error || !resp.text.trim()) {
      save(dir, "FAIL.json", resp);
      throw new Error(
        `CALL_FAIL ${source.id}/aion: ${resp.error ?? resp.http_status}`
      );
    }

    const chars = visibleAssistantDisplayCharCount(resp.text);
    const uf = extractUsage(resp.usage);
    const row = {
      attempt_id: `${source.id.toUpperCase()}_AION`,
      source_id: source.id,
      source_label: source.label,
      source_human_approved: source.humanApproved,
      candidate: "aion",
      model: AION_CANDIDATE,
      resolved_model: resp.resolved_model,
      provider_route: aion.transportProvider,
      character_id: source.characterId,
      existing_winner: source.existingWinner,
      existing_winner_model: source.existingWinnerModel,
      http_status: resp.http_status,
      finish_reason: resp.finish_reason,
      saw_done: resp.saw_done,
      total_visible_chars: chars,
      ...uf,
      latency_s: resp.latency_s,
      retry: 0,
      continuation: 0,
      recovery: 0,
      provider_fallback: 0,
      raw_hash: sha256(resp.text),
      final_prompt_hash: hashMsgs(aion.messages),
      temperature: aion.requestBody.temperature ?? null,
      top_p: aion.requestBody.top_p ?? null,
      reasoning: aion.requestBody.reasoning ?? null,
      length_v2: "NOT_RUN",
      two_chunk: "NOT_RUN",
      recovery_continuation: "NOT_RUN",
      reasoning_experiment: "NOT_RUN",
    };

    save(dir, "provider-raw.txt", resp.text);
    save(dir, "meta.json", row);
    save(dir, "messages.json", aion.messages);
    save(dir, "request-body-sanitized.json", {
      model: aion.requestBody.model,
      temperature: aion.requestBody.temperature ?? null,
      top_p: aion.requestBody.top_p ?? null,
      max_tokens: aion.requestBody.max_tokens ?? null,
      stream: aion.requestBody.stream,
      reasoning: aion.requestBody.reasoning ?? null,
      provider_route: aion.transportProvider,
      message_count: aion.messages.length,
    });
    // Winner reference pointers only (no re-call).
    save(dir, "existing-winner-ref.json", {
      winner: source.existingWinner,
      model: source.existingWinnerModel,
      raw_path: winnerRawPath,
      meta_path: winnerMetaPath,
      winner_chars: (
        JSON.parse(readFileSync(winnerMetaPath, "utf8")) as {
          total_visible_chars?: number;
        }
      ).total_visible_chars,
    });

    callRows.push(row);
    console.log({
      id: row.attempt_id,
      chars,
      finish: resp.finish_reason,
      latency_s: resp.latency_s,
      cost: uf.usage_cost_usd,
    });
  }

  const runtime = {
    status: "AION_CHALLENGER_CAPTURE_COMPLETE",
    comparison_unit: "PRODUCTION_CONFIG_BUNDLE_COMPARISON",
    claim_scope:
      "Aion production adult handoff bundle fidelity vs prior Muse/DeepSeek winners — NOT pure raw-model performance",
    timestamp: new Date().toISOString(),
    api_calls: apiCalls,
    max_calls: maxCalls,
    new_calls_this_addon: apiCalls,
    deepseek_muse_recalls: 0,
    retry: 0,
    continuation: 0,
    recovery: 0,
    provider_fallback: 0,
    aion_length_v2: "NOT_RUN",
    two_chunk: "NOT_RUN",
    recovery_continuation: "NOT_RUN",
    reasoning_experiment: "NOT_RUN",
    model: AION_CANDIDATE,
    adapters_by_source: adapterBySource,
    calls: callRows,
    existing_winners: {
      opus: "muse",
      terra: "deepseek",
      gemini: "muse",
    },
    production_change: false,
    merge: "NOT_RUN",
    ADULT_SCENE_HANDOFF_READY: "PENDING_AION_CHALLENGER",
  };

  save(OUT_ROOT, "RUNTIME_RESULTS.json", runtime);
  save(DOCS, "RUNTIME_CAPTURE.json", runtime);

  console.log(
    JSON.stringify(
      {
        status: runtime.status,
        api_calls: apiCalls,
        max_calls: maxCalls,
        model: AION_CANDIDATE,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
