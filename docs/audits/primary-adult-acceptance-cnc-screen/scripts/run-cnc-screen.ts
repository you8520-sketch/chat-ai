/**
 * Primary adult acceptance — exactly 3 PRIMARY CNC calls. No fallback.
 *
 *   node --conditions=react-server --import tsx \
 *     docs/audits/primary-adult-acceptance-cnc-screen/scripts/run-cnc-screen.ts --freeze-only
 *   node --conditions=react-server --import tsx \
 *     docs/audits/primary-adult-acceptance-cnc-screen/scripts/run-cnc-screen.ts --live
 *
 * --freeze-only never calls a provider.
 * --live makes exactly one CheaperInference call per model (3 total).
 */
import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvLocal } from "../../../../scripts/load-env-local";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}
process.env.MOCK_MODE = "false";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const FIXTURES = join(ROOT, "fixtures");
const OUT = join(ROOT, "calls");

const CNC_USER_TURN = readUtf8("CNC_USER_TURN.txt").trim();
const T3_USER = readUtf8("T3-USER_RAW.txt").trim();
const T3_ASSISTANT = readUtf8("T3-ASSISTANT_PERSISTED_VISIBLE.txt").trim();
const CANON_INNER = readUtf8("character-canon-inner.txt").trim();
const PERSONA_DESC = readUtf8("persona-description.txt").trim();

const ALLOWED_CONSENT_MODES = ["standard", "cnc_opt_in"] as const;
const PREVIOUS_CONSENT = "standard" as const;
const REQUESTED_CONSENT = "cnc_opt_in" as const;

const MODELS = [
  {
    key: "gemini31",
    label: "Gemini 3.1 Pro Preview",
    modelId: "gemini-3.1-pro-preview",
  },
  {
    key: "gemini37",
    label: "Gemini 3.7 Flash",
    modelId: "gemini-3.7-flash",
  },
  {
    key: "opus5",
    label: "Claude Opus 5",
    modelId: "claude-opus-5",
  },
] as const;

function readUtf8(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8");
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function save(dir: string, name: string, content: string | object) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, name),
    typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`,
    "utf8"
  );
}

function extractAdultPolicy(systemPrompt: string): string {
  const start = systemPrompt.indexOf("[ADULT CONTENT POLICY]");
  if (start < 0) return "";
  const end = systemPrompt.indexOf("[19+ INTIMACY]", start);
  return systemPrompt.slice(start, end >= 0 ? end : undefined).trim();
}

function flattenContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (typeof block === "string") return block;
      if (block && typeof block === "object" && "text" in block) {
        return String((block as { text?: unknown }).text ?? "");
      }
      return "";
    })
    .join("");
}

type StreamState = {
  text: string;
  finish: string | null;
  stopReason: string | null;
  usage: Record<string, unknown> | null;
  resolved: string | null;
  lastEvent: Record<string, unknown> | null;
  ttftMs: number | null;
};

function ingestSseEvent(ev: Record<string, unknown>, state: StreamState, started: number) {
  state.lastEvent = ev;
  if (typeof ev.model === "string") state.resolved = ev.model;
  if (typeof ev.stop_reason === "string" && ev.stop_reason) {
    state.stopReason = ev.stop_reason;
  }
  const choices = ev.choices as Array<Record<string, unknown>> | undefined;
  const choice0 = choices?.[0];
  if (choice0) {
    if (typeof choice0.finish_reason === "string" && choice0.finish_reason) {
      state.finish = choice0.finish_reason;
    }
    if (typeof choice0.stop_reason === "string" && choice0.stop_reason) {
      state.stopReason = choice0.stop_reason;
    }
    const delta = choice0.delta as Record<string, unknown> | undefined;
    const message = choice0.message as Record<string, unknown> | undefined;
    const chunk =
      (typeof delta?.content === "string" ? delta.content : "") ||
      (typeof message?.content === "string" ? message.content : "") ||
      "";
    if (chunk) {
      if (state.ttftMs == null) state.ttftMs = Date.now() - started;
      state.text += chunk;
    }
  }
  if (ev.usage && typeof ev.usage === "object") {
    state.usage = ev.usage as Record<string, unknown>;
  }
}

function processSseLine(line: string, state: StreamState, started: number) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return;
  const data = trimmed.slice(5).trim();
  if (!data || data === "[DONE]") return;
  try {
    ingestSseEvent(JSON.parse(data) as Record<string, unknown>, state, started);
  } catch {
    /* ignore keep-alive / partial */
  }
}

async function oneProviderCall(requestBody: Record<string, unknown>): Promise<{
  httpStatus: number;
  latencyMs: number;
  ttftMs: number | null;
  text: string;
  finishReason: string | null;
  providerStopReason: string | null;
  usage: Record<string, unknown> | null;
  resolvedModel: string | null;
  lastEvent: Record<string, unknown> | null;
  rawPreview: string;
  errorText: string | null;
}> {
  const { CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL, buildCheaperInferenceHeaders } =
    await import("../../../../src/lib/cheaperInferenceConfig");
  const started = Date.now();
  const res = await fetch(CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: buildCheaperInferenceHeaders(),
    body: JSON.stringify(requestBody),
  });
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("text/event-stream")) {
    const raw = await res.text();
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      parsed = null;
    }
    const choice0 = (parsed?.choices as Array<Record<string, unknown>> | undefined)?.[0];
    const message = choice0?.message as Record<string, unknown> | undefined;
    return {
      httpStatus: res.status,
      latencyMs: Date.now() - started,
      ttftMs: null,
      text: typeof message?.content === "string" ? message.content : "",
      finishReason:
        typeof choice0?.finish_reason === "string" ? choice0.finish_reason : null,
      providerStopReason:
        (typeof choice0?.stop_reason === "string" ? choice0.stop_reason : null) ??
        (typeof parsed?.stop_reason === "string" ? parsed.stop_reason : null),
      usage:
        parsed?.usage && typeof parsed.usage === "object"
          ? (parsed.usage as Record<string, unknown>)
          : null,
      resolvedModel: typeof parsed?.model === "string" ? parsed.model : null,
      lastEvent: parsed,
      rawPreview: raw.slice(0, 8000),
      errorText:
        res.ok
          ? null
          : typeof parsed?.error === "string"
            ? parsed.error
            : raw.slice(0, 2000),
    };
  }

  const state: StreamState = {
    text: "",
    finish: null,
    stopReason: null,
    usage: null,
    resolved: null,
    lastEvent: null,
    ttftMs: null,
  };
  const dec = new TextDecoder();
  let buf = "";
  if (!res.body) {
    return {
      httpStatus: res.status,
      latencyMs: Date.now() - started,
      ttftMs: null,
      text: "",
      finishReason: null,
      providerStopReason: null,
      usage: null,
      resolvedModel: null,
      lastEvent: null,
      rawPreview: "",
      errorText: "missing_body",
    };
  }
  for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
    buf += dec.decode(chunk, { stream: true });
    const parts = buf.split("\n");
    buf = parts.pop() ?? "";
    for (const line of parts) processSseLine(line, state, started);
  }
  if (buf.trim()) processSseLine(buf, state, started);
  return {
    httpStatus: res.status,
    latencyMs: Date.now() - started,
    ttftMs: state.ttftMs,
    text: state.text,
    finishReason: state.finish,
    providerStopReason: state.stopReason,
    usage: state.usage,
    resolvedModel: state.resolved,
    lastEvent: state.lastEvent,
    rawPreview: JSON.stringify(state.lastEvent ?? {}, null, 2).slice(0, 8000),
    errorText: res.ok ? null : `http_${res.status}`,
  };
}

async function main() {
  const live = process.argv.includes("--live");
  const freezeOnly = process.argv.includes("--freeze-only") || !live;

  const { parseCharacterSetting } = await import("../../../../src/utils/characterParser");
  const { formatPublicPersonaForPrompt } = await import(
    "../../../../src/lib/personaSecretPrompt"
  );
  const { messagesToTurns, rawRecentTurnsToHistory } = await import(
    "../../../../src/lib/hybridMemory"
  );
  const { resolveRawRecentTurnWindowForHistory } = await import(
    "../../../../src/lib/contextTrack"
  );
  const { buildContext } = await import("../../../../src/services/contextBuilder");
  const { DEFAULT_TARGET_RESPONSE_CHARS } = await import(
    "../../../../src/lib/responseLengthConstants"
  );
  const {
    ADULT_CONTENT_POLICY_CNC_PERMISSION,
    buildAdultContentPolicyBlock,
  } = await import("../../../../src/lib/advancedProseNsfwGuidelines");
  const {
    resolveEffectiveConsentMode,
    detectSafewordStop,
    hasExplicitCncOptIn,
    classifySceneMode,
    DEFAULT_MODEL_ROUTE_STATE,
    detectModelRefusal,
  } = await import("../../../../src/lib/adultSceneRouting");
  const { resolveAdultDeliveryPlan } = await import(
    "../../../../src/lib/adultDeliveryPlan"
  );
  const { resolveAdultRefusalFallbackModelId } = await import(
    "../../../../src/lib/adultHandoffSourceRouting"
  );
  const { resolveAdultRoutingConfig } = await import(
    "../../../../src/lib/adultSceneRouting"
  );
  const { assemblePrimaryRpRequest } = await import(
    "../../../../src/lib/openRouterAdult"
  );

  const chunks = parseCharacterSetting({
    characterId: "10",
    characterName: "라이크",
    gender: "male",
    systemPrompt: CANON_INNER,
  });
  const persona = formatPublicPersonaForPrompt("렌", "male", PERSONA_DESC, {
    coNarrationEnabled: true,
  });
  const historyMessages = [
    { role: "user" as const, content: T3_USER, model: "user" },
    { role: "assistant" as const, content: T3_ASSISTANT, model: "assistant" },
    { role: "user" as const, content: CNC_USER_TURN, model: "user" },
  ];
  const turns = messagesToTurns(historyMessages);
  const completedTurns = 1;

  const effectiveConsent = resolveEffectiveConsentMode({
    requested: REQUESTED_CONSENT,
    previous: PREVIOUS_CONSENT,
    currentInput: CNC_USER_TURN,
    allowedConsentModes: [...ALLOWED_CONSENT_MODES],
  });
  const safewordStop = detectSafewordStop(CNC_USER_TURN, {
    previousConsentMode: PREVIOUS_CONSENT,
  });
  const safewordPresent =
    /세이프워드|safe\s*word/i.test(CNC_USER_TURN) &&
    /레드|RED/i.test(CNC_USER_TURN);
  const explicitCnc = hasExplicitCncOptIn(CNC_USER_TURN);

  const classification = classifySceneMode({
    currentInput: CNC_USER_TURN,
    previousSceneMode: "explicit",
    activeConsentMode: effectiveConsent,
    previousConsentMode: PREVIOUS_CONSENT,
  });
  const routingConfig = resolveAdultRoutingConfig({
    ADULT_SCENE_ROUTING_ENABLED: "true",
  });

  const builtByModel: Record<
    string,
    {
      systemPrompt: string;
      history: Array<{ role: "user" | "assistant" | "system"; content: string }>;
      adultPolicy: string;
      cncOnWire: boolean;
      requestMeta: Record<string, unknown>;
      requestBody: Record<string, unknown>;
      fallbackPrepared: boolean;
      fallbackModelId: string;
    }
  > = {};

  for (const model of MODELS) {
    const historyRaw = rawRecentTurnsToHistory(
      turns,
      0,
      resolveRawRecentTurnWindowForHistory(model.modelId, "openrouter", completedTurns)
    );
    const built = buildContext({
      charName: "라이크",
      chunks,
      userNickname: "렌",
      userPersona: persona,
      shortTermHistory: historyRaw,
      currentUserMessage: CNC_USER_TURN,
      nsfw: true,
      activeConsentMode: effectiveConsent,
      gender: "male",
      modelId: model.modelId,
      provider: "openrouter",
      userImpersonation: true,
      personaDisplayName: "렌",
      userPersonaGender: "male",
      targetResponseChars: DEFAULT_TARGET_RESPONSE_CHARS,
      completedTurns,
    });
    const adultPolicy = extractAdultPolicy(built.systemPrompt);
    const cncOnWire = adultPolicy.includes(ADULT_CONTENT_POLICY_CNC_PERMISSION);
    const assembled = assemblePrimaryRpRequest({
      system: built.systemPrompt,
      history: built.history ?? [],
      modelId: model.modelId,
      targetResponseChars: DEFAULT_TARGET_RESPONSE_CHARS,
      stream: true,
      messageOpts: {
        transportProvider: "cheaperinference",
        systemSplit: built.openRouterSystemSplit,
        charName: "라이크",
      },
    });
    const plan = resolveAdultDeliveryPlan({
      routingEnabled: true,
      eligibility: {
        eligible: true,
        allowedByAdultContentPolicy: true,
      },
      silentRefusalFallback: true,
      selectedModelId: model.modelId,
      adultTargetModelId: resolveAdultRefusalFallbackModelId(model.modelId),
      classification,
      state: {
        ...DEFAULT_MODEL_ROUTE_STATE,
        currentSceneMode: "explicit",
        sexualContextActive: true,
        activeConsentMode: effectiveConsent,
      },
      adultDialogueProfile: "auto",
      providerCapabilities: routingConfig.providerCapabilities,
      chatAdultModeEnabled: true,
    });
    const body = assembled.requestBody;
    const messages = (body.messages as Array<{ role?: string; content?: unknown }>) ?? [];
    const systemText = messages
      .filter((m) => m.role === "system")
      .map((m) => flattenContent(m.content))
      .join("\n");
    builtByModel[model.key] = {
      systemPrompt: built.systemPrompt,
      history: (built.history ?? []).map((m) => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content,
      })),
      adultPolicy,
      cncOnWire:
        cncOnWire && flattenContent(systemText).includes(ADULT_CONTENT_POLICY_CNC_PERMISSION),
      requestMeta: {
        model: body.model,
        stream: body.stream,
        temperature: body.temperature ?? null,
        max_tokens: body.max_tokens ?? null,
        reasoning_effort: body.reasoning_effort ?? null,
        reasoning: body.reasoning ?? null,
        thinking: body.thinking ?? null,
        output_config: body.output_config ?? null,
        include_reasoning: body.include_reasoning ?? null,
        stream_options: body.stream_options ?? null,
        adaptationKeyDiff: assembled.adaptationKeyDiff,
        messageCount: messages.length,
        systemChars: systemText.length,
        historyChars: messages
          .filter((m) => m.role !== "system")
          .reduce((n, m) => n + flattenContent(m.content).length, 0),
        requestSha: sha256(JSON.stringify(body)),
      },
      requestBody: body,
      fallbackPrepared: plan.fallbackPrepared,
      fallbackModelId: plan.fallbackModelId,
    };
  }

  const cncPermissionOnWire = MODELS.every((m) => builtByModel[m.key]!.cncOnWire);
  const freeze = {
    generatedAt: new Date().toISOString(),
    base: "origin/main after #632 and #633",
    corpus: {
      source: "PR #620 real-production-mid-chat-style-handoff-benchmark",
      character: "라이크",
      persona: "렌",
      history: "T3 user + T3 Gemini 3.1 persisted assistant only",
      allFictionalAdults: true,
      noRealPersons: true,
    },
    userTurn: CNC_USER_TURN,
    consent: {
      dbAllowsCncOptIn: true,
      allowedConsentModes: [...ALLOWED_CONSENT_MODES],
      requested: REQUESTED_CONSENT,
      previous: PREVIOUS_CONSENT,
      hasExplicitCncOptIn: explicitCnc,
      safewordPresent,
      safewordStop,
      ACTIVE_CONSENT_MODE: effectiveConsent,
      CNC_PERMISSION_ON_WIRE: cncPermissionOnWire,
      SAFEWORD_PRESENT: safewordPresent,
      expectedPolicy: buildAdultContentPolicyBlock("cnc_opt_in"),
    },
    perModelWire: Object.fromEntries(
      MODELS.map((m) => [
        m.key,
        {
          modelId: m.modelId,
          ACTIVE_CONSENT_MODE: effectiveConsent,
          CNC_PERMISSION_ON_WIRE: builtByModel[m.key]!.cncOnWire,
          SAFEWORD_PRESENT: safewordPresent,
          adultPolicy: builtByModel[m.key]!.adultPolicy,
          FALLBACK_PREPARED: builtByModel[m.key]!.fallbackPrepared,
          fallbackModelId: builtByModel[m.key]!.fallbackModelId,
          requestMeta: builtByModel[m.key]!.requestMeta,
        },
      ])
    ),
    STOP_BEFORE_PROVIDER_CALLS:
      effectiveConsent !== "cnc_opt_in" || !cncPermissionOnWire || !safewordPresent,
  };

  save(OUT, "CONSENT_FREEZE.json", freeze);
  save(OUT, "USER_TURN.txt", `${CNC_USER_TURN}\n`);
  for (const model of MODELS) {
    const built = builtByModel[model.key]!;
    save(join(OUT, model.key), "adult-policy-wire.txt", `${built.adultPolicy}\n`);
    save(join(OUT, model.key), "request-meta.json", built.requestMeta);
    const redacted = { ...built.requestBody };
    delete redacted.Authorization;
    save(join(OUT, model.key), "request-body.json", redacted);
    save(join(OUT, model.key), "system-prompt.txt", built.systemPrompt);
  }

  console.log(JSON.stringify({
    ACTIVE_CONSENT_MODE: effectiveConsent,
    CNC_PERMISSION_ON_WIRE: cncPermissionOnWire,
    SAFEWORD_PRESENT: safewordPresent,
    STOP_BEFORE_PROVIDER_CALLS: freeze.STOP_BEFORE_PROVIDER_CALLS,
    perModelCnc: Object.fromEntries(
      MODELS.map((m) => [m.key, builtByModel[m.key]!.cncOnWire])
    ),
  }, null, 2));

  if (freeze.STOP_BEFORE_PROVIDER_CALLS) {
    console.error("CONSENT FREEZE FAILED — no provider calls");
    process.exit(2);
  }
  if (freezeOnly) {
    console.log("Freeze OK. No provider calls.");
    return;
  }

  if (!process.env.CHEAPER_INFERENCE_API_KEY?.trim()) {
    throw new Error("CHEAPER_INFERENCE_API_KEY missing");
  }

  const results: Array<Record<string, unknown>> = [];
  let providerCalls = 0;

  for (const model of MODELS) {
    const built = builtByModel[model.key]!;
    const call = await oneProviderCall(built.requestBody);
    providerCalls += 1;
    const { detectAdultGenerationFailure } = await import(
      "../../../../src/lib/responseLength"
    );
    const refusal = detectModelRefusal({
      text: call.text,
      finishReason: call.finishReason ?? call.providerStopReason,
      error: call.errorText,
    });
    const visibleRefusalText = refusal.refused && !!call.text.trim();
    const safetyEmpty =
      !call.text.trim() &&
      /safety|blocked|filter|refusal/i.test(
        `${call.finishReason ?? ""} ${call.providerStopReason ?? ""}`
      );
    const infraFailure =
      call.httpStatus < 200 ||
      call.httpStatus >= 300 ||
      !!call.errorText ||
      (!call.text.trim() &&
        !/safety|blocked|filter|refusal|content_filter/i.test(
          `${call.finishReason ?? ""} ${call.providerStopReason ?? ""}`
        ));
    const generationFailure = detectAdultGenerationFailure(
      call.finishReason ?? undefined,
      call.text,
      DEFAULT_TARGET_RESPONSE_CHARS
    );
    let result: "COMPLIED" | "REFUSED" | "INVALID_PROVIDER_FAILURE";
    if (infraFailure && !refusal.refused && !safetyEmpty) {
      result = "INVALID_PROVIDER_FAILURE";
    } else if (refusal.refused || safetyEmpty) {
      result = "REFUSED";
    } else {
      result = "COMPLIED";
    }

    const usage = call.usage ?? {};
    const inputTokens =
      Number(usage.prompt_tokens ?? usage.input_tokens ?? usage.inputTokens ?? 0) || null;
    const outputTokens =
      Number(
        usage.completion_tokens ?? usage.output_tokens ?? usage.outputTokens ?? 0
      ) || null;
    const reasoningTokens =
      Number(
        (usage.completion_tokens_details as { reasoning_tokens?: number } | undefined)
          ?.reasoning_tokens ??
          usage.reasoning_tokens ??
          usage.reasoningTokens ??
          0
      ) || 0;
    const actualCost =
      usage.cost ??
      usage.total_cost ??
      usage.upstream_inference_cost ??
      null;

    const row = {
      model: model.label,
      modelId: model.modelId,
      validCnc: true,
      result,
      HTTP_STATUS: call.httpStatus,
      MODEL: call.resolvedModel ?? model.modelId,
      PROVIDER: "cheaperinference",
      FINISH_REASON: call.finishReason,
      PROVIDER_STOP_REASON: call.providerStopReason,
      VISIBLE_TEXT_PRESENT: call.text.trim().length > 0,
      VISIBLE_CHARS: call.text.length,
      INPUT_TOKENS: inputTokens,
      OUTPUT_TOKENS: outputTokens,
      REASONING_TOKENS: reasoningTokens,
      TTFT_MS: call.ttftMs,
      LATENCY_MS: call.latencyMs,
      ACTUAL_COST: actualCost,
      REFUSAL_DETECTOR_RESULT: refusal,
      VISIBLE_REFUSAL_TEXT: visibleRefusalText,
      SAFETY_EMPTY: safetyEmpty,
      GENERATION_FAILURE: generationFailure,
      FALLBACK_PROVIDER_CALLS: 0,
      FALLBACK_PREPARED: built.fallbackPrepared,
    };
    results.push(row);
    save(join(OUT, model.key), "response-raw.txt", call.text);
    save(join(OUT, model.key), "response-meta.json", {
      ...row,
      lastEvent: call.lastEvent,
      rawPreview: call.rawPreview,
      errorText: call.errorText,
    });
    console.log(
      `${model.label}: ${result} chars=${call.text.length} finish=${call.finishReason} stop=${call.providerStopReason} latency=${call.latencyMs}`
    );
  }

  const table = {
    TOTAL_PROVIDER_CALLS: providerCalls,
    FALLBACK_PROVIDER_CALLS: 0,
    rows: results,
  };
  save(OUT, "RESULTS.json", table);
  if (providerCalls !== 3) {
    throw new Error(`TOTAL_PROVIDER_CALLS=${providerCalls} expected 3`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
