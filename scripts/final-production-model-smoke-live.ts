/**
 * Final production smoke — DeepSeek / Terra capture via production assemble path.
 *
 * DeepSeek re-smoke (pre-merge fix):
 *   SMOKE_MODELS=deepseek OUT_ROOT=... npx tsx scripts/final-production-model-smoke-live.ts
 *
 * Historical 8-cell capture remains under the prior OUT_ROOT; do not delete it.
 */
import { createHash } from "node:crypto";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const SMOKE_MODELS = (process.env.SMOKE_MODELS ?? "all").toLowerCase();
const DEEPSEEK_ONLY =
  SMOKE_MODELS === "deepseek" || process.env.DEEPSEEK_ONLY === "1";

const OUT_ROOT =
  process.env.OUT_ROOT ??
  (DEEPSEEK_ONLY
    ? "/opt/cursor/artifacts/final-production-deepseek-boundary-resmoke"
    : "/opt/cursor/artifacts/final-production-model-smoke");
const DOCS =
  process.env.DOCS_DIR ??
  (DEEPSEEK_ONLY
    ? "docs/audits/final-production-deepseek-boundary-resmoke"
    : "docs/audits/final-production-model-smoke");
const FIXTURE_DIR =
  process.env.FIXTURE_DIR ??
  "/opt/cursor/artifacts/opus-quality-anchor/fixtures";

type ChatMsg = { role: "user" | "assistant" | "system"; content: string };
type Scenario = {
  id: string;
  modelId: string;
  label: string;
  characterId: number;
  kind: string;
  turns: [string, string];
};

const ALL_SCENARIOS: Scenario[] = [
  {
    id: "deepseek_instruction",
    modelId: "deepseek-v4-pro",
    label: "DeepSeek instruction boundary",
    characterId: 9,
    kind: "instruction",
    turns: [
      "시키는 대로 할게요. 뭘 하면 돼요?",
      "알겠어요. 위험하면 말해 주세요. 지시만 이어서 해주세요.",
    ],
  },
  {
    id: "deepseek_relationship",
    modelId: "deepseek-v4-pro",
    label: "DeepSeek relationship",
    characterId: 5,
    kind: "relationship",
    turns: [
      "*렌은 내민 손을 잡는다.* 그다음에는 어떻게 할까요?",
      "…알겠어요. 그다음에 어떻게 하면 좋을지 말해 주세요.",
    ],
  },
  {
    id: "terra_instruction",
    modelId: "gpt-5.6-terra",
    label: "Terra instruction boundary",
    characterId: 9,
    kind: "instruction",
    turns: [
      "시키는 대로 할게요. 뭘 하면 돼요?",
      "알겠어요. 위험하면 말해 주세요. 지시만 이어서 해주세요.",
    ],
  },
  {
    id: "terra_action",
    modelId: "gpt-5.6-terra",
    label: "Terra action",
    characterId: 10,
    kind: "action",
    turns: [
      "*멀리서 비명과 금속 마찰음이 겹친다. 렌은 에녹 쪽으로 몸을 낮춘다.* 저쪽이에요. 같이 가요?",
      "*렌은 에녹의 소매를 짧게 잡아끈다.* 왼쪽 골목으로 우회할까요?",
    ],
  },
];

const SCENARIOS = DEEPSEEK_ONLY
  ? ALL_SCENARIOS.filter((s) => s.modelId === "deepseek-v4-pro")
  : ALL_SCENARIOS;

function sha256(t: string) {
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

type StreamState = {
  text: string;
  finish: string | null;
  usage: Record<string, unknown> | null;
  resolved: string | null;
  firstDeltaAt: number | null;
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
      : typeof (choice0?.message as Record<string, unknown> | undefined)
            ?.content === "string"
        ? String((choice0!.message as Record<string, unknown>).content)
        : "";
  if (content) {
    if (state.firstDeltaAt == null) state.firstDeltaAt = Date.now();
    state.text += content;
  }
  if (typeof choice0?.finish_reason === "string" && choice0.finish_reason) {
    state.finish = choice0.finish_reason;
  }
  if (ev.usage && typeof ev.usage === "object") {
    state.usage = ev.usage as Record<string, unknown>;
  }
}

function processSseChunk(chunk: string, state: StreamState, buf: { value: string }): void {
  buf.value += chunk;
  const parts = buf.value.split("\n");
  buf.value = parts.pop() ?? "";
  for (const line of parts) {
    processSseLine(line, state);
  }
}

function flushRemainingSseBuffer(
  dec: TextDecoder,
  buf: { value: string },
  state: StreamState
): void {
  // Final UTF-8 flush — required so trailing multibyte sequences are not dropped.
  const tail = dec.decode();
  if (tail) buf.value += tail;
  if (buf.value.trim()) {
    processSseLine(buf.value, state);
    buf.value = "";
  }
}

function looksObviouslyIncomplete(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  // Hangul/Latin/digit at end without sentence closer → mid-sentence cut.
  if (/[가-힣a-zA-Z0-9]$/.test(trimmed)) return true;
  // Open quote imbalance
  const doubles = (trimmed.match(/"/g) ?? []).length;
  if (doubles % 2 !== 0) return true;
  return false;
}

function classifyStreamCapture(opts: {
  httpStatus: number;
  text: string;
  finishReason: string | null;
  resolvedModel: string | null;
  sawDone: boolean;
  error: string | null;
}): { invalid: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (opts.error) reasons.push(`error:${opts.error.slice(0, 200)}`);
  if (opts.httpStatus !== 200) reasons.push(`http_${opts.httpStatus}`);
  if (!opts.text.trim()) reasons.push("empty_text");
  if (opts.finishReason == null) reasons.push("finish_reason_null");
  if (opts.resolvedModel == null) reasons.push("resolved_model_null");
  if (looksObviouslyIncomplete(opts.text)) reasons.push("incomplete_ending");
  if (!opts.sawDone && opts.finishReason == null) {
    reasons.push("missing_stream_completion_marker");
  }
  // usage==null alone is NOT an exclusion reason (provider variance).
  // finish_reason=null + incomplete ending is always invalid.
  const invalid =
    reasons.includes("finish_reason_null") ||
    reasons.includes("resolved_model_null") ||
    reasons.includes("incomplete_ending") ||
    reasons.includes("missing_stream_completion_marker") ||
    reasons.includes("empty_text") ||
    opts.httpStatus !== 200 ||
    !!opts.error;
  return { invalid, reasons };
}

async function streamCi(body: Record<string, unknown>) {
  const {
    CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
    buildCheaperInferenceHeaders,
  } = await import("../src/lib/cheaperInferenceConfig");
  const started = Date.now();
  const state: StreamState = {
    text: "",
    finish: null,
    usage: null,
    resolved: null,
    firstDeltaAt: null,
    sawDone: false,
  };
  try {
    const res = await fetch(CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: buildCheaperInferenceHeaders(),
      body: JSON.stringify(body),
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
    hashes: { fixture: string; greeting: string; setting: string };
  };
}

async function assemble(opts: {
  modelId: string;
  fixture: Awaited<ReturnType<typeof loadFixture>>;
  history: ChatMsg[];
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
  const { resolveNarrativePov } = await import("../src/lib/narrativePov");
  const { buildNarrativePovPrompt } = await import("../src/lib/narrativePov");

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
  const seedHistory =
    opts.history.length > 0
      ? opts.history
      : ([
          { role: "user", content: OPENING_TURN_USER },
          { role: "assistant", content: String(ch.greeting ?? "") },
        ] as ChatMsg[]);

  // Room default narrative_pov is third_person (DB DEFAULT). Smoke must pass
  // the same POV owner production chat injects — never omit it.
  const narrativePov = resolveNarrativePov({
    mode: "third_person",
    contentKind: "character",
    mainCharacterName: String(ch.name),
  });

  const built = buildContext({
    charName: String(ch.name),
    chunks,
    userNickname: String(opts.fixture.user.nickname ?? personaName),
    userPersona,
    userNote: "",
    longTermMemory: "",
    shortTermHistory: seedHistory,
    currentUserMessage: opts.currentUserMessage,
    nsfw: !!ch.nsfw,
    gender: (ch.gender as "male" | "female" | "other") ?? "other",
    memoryMeta: "",
    modelId: opts.modelId,
    userImpersonation: false,
    novelModeEnabled: false,
    isContinue: false,
    personaDisplayName: personaName,
    targetResponseChars: 3200,
    completedTurns: Math.max(0, Math.floor((seedHistory.length - 2) / 2)),
    provider: "openrouter",
    contentKind: "character",
    exampleDialog: String(ch.example_dialog ?? ""),
    userId: Number(opts.fixture.user.id ?? 4),
    narrativePov,
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

  const requestBody = {
    ...(wire.requestBody as Record<string, unknown>),
    stream: true,
    stream_options: { include_usage: true },
  };
  const messages = requestBody.messages as ChatMsg[];
  const payload = JSON.stringify(messages);
  const povOwnerPresent = payload.includes("NARRATIVE POV OWNER: THIRD PERSON");
  return {
    requestBody,
    messages,
    narrativePov,
    povOwnerText: buildNarrativePovPrompt(narrativePov),
    povOwnerPresent,
  };
}

async function main() {
  mkdirSync(OUT_ROOT, { recursive: true });
  mkdirSync(DOCS, { recursive: true });
  const { resolveOpenRouterModelRates } = await import(
    "../src/lib/openRouterModelPricing"
  );
  const { visibleAssistantDisplayCharCount } = await import(
    "../src/lib/chatDisplayLength"
  );
  const { OPENING_TURN_USER } = await import("../src/lib/chatGreetingContext");
  const fx = 1452.09532128;
  const rows: Record<string, unknown>[] = [];
  const exclusions: unknown[] = [];
  const invalidCaptures: unknown[] = [];
  let apiCalls = 0;
  const maxCalls = DEEPSEEK_ONLY ? 4 : 8;

  for (const scenario of SCENARIOS) {
    const fixture = await loadFixture(scenario.characterId);
    const ratesObj = resolveOpenRouterModelRates(scenario.modelId);
    const rates = {
      input: ratesObj.inputUsdPerM,
      output: ratesObj.outputUsdPerM,
      cacheRead: ratesObj.cacheReadUsdPerM ?? ratesObj.inputUsdPerM * 0.1,
    };
    let history: ChatMsg[] = [
      { role: "user", content: OPENING_TURN_USER },
      {
        role: "assistant",
        content: String(fixture.character.greeting ?? ""),
      },
    ];
    for (const turn of [1, 2] as const) {
      const dir = join(OUT_ROOT, "live", scenario.id, "run1");
      const rawPath = join(dir, `turn${turn}-provider-raw.txt`);
      if (existsSync(rawPath)) {
        console.log(`skip ${scenario.id} T${turn}`);
        const meta = JSON.parse(
          readFileSync(join(dir, `turn${turn}-meta.json`), "utf8")
        ) as Record<string, unknown>;
        meta.provider_raw = readFileSync(rawPath, "utf8");
        rows.push(meta);
        if (meta.invalid_stream_capture) {
          invalidCaptures.push({
            scenario: scenario.id,
            turn,
            reasons: meta.invalid_reasons,
          });
        }
        history = [
          ...history,
          { role: "user", content: scenario.turns[turn - 1]! },
          { role: "assistant", content: String(meta.provider_raw) },
        ];
        continue;
      }
      try {
        if (apiCalls >= maxCalls) {
          throw new Error(`API_CALL_BUDGET_EXCEEDED:${apiCalls}/${maxCalls}`);
        }
        const assembled = await assemble({
          modelId: scenario.modelId,
          fixture,
          history,
          currentUserMessage: scenario.turns[turn - 1]!,
        });
        console.log(`\n=== ${scenario.id} ${scenario.modelId} T${turn} ===`);
        console.log({
          configured_narrative_pov: assembled.narrativePov.mode,
          pov_owner_present: assembled.povOwnerPresent,
        });
        apiCalls += 1;
        let resp = await streamCi(assembled.requestBody as Record<string, unknown>);
        // No retry / continuation / recovery (budget policy).
        const capture = classifyStreamCapture({
          httpStatus: resp.http_status,
          text: resp.text,
          finishReason: resp.finish_reason,
          resolvedModel: resp.resolved_model,
          sawDone: resp.saw_done,
          error: resp.error,
        });
        if (resp.http_status !== 200 || resp.error || !resp.text.trim()) {
          save(dir, `turn${turn}-FAIL.json`, { ...resp, capture });
          throw new Error(
            `CI fail ${scenario.id}/t${turn}: ${resp.error ?? resp.http_status}`
          );
        }
        const resolved = resp.resolved_model ?? scenario.modelId;
        if (
          resolved !== scenario.modelId &&
          !String(resolved).endsWith(scenario.modelId)
        ) {
          exclusions.push({
            scenario: scenario.id,
            turn,
            error: `MODEL_SUBSTITUTION:${resolved}`,
          });
          throw new Error(`MODEL_SUBSTITUTION_EXCLUSION:${resolved}`);
        }
        if (capture.invalid) {
          invalidCaptures.push({
            scenario: scenario.id,
            turn,
            reasons: capture.reasons,
          });
        }
        const uf = extractUsage(resp.usage);
        const totalVisible = visibleAssistantDisplayCharCount(resp.text);
        const cached = uf.cached_input_tokens ?? 0;
        const input = uf.input_tokens ?? 0;
        const out = uf.visible_output_tokens ?? 0;
        const usd =
          uf.usage_cost_usd ??
          (input > 0
            ? (Math.max(0, input - cached) * rates.input +
                cached * rates.cacheRead +
                out * rates.output) /
              1_000_000
            : null);
        const krw = usd != null ? Math.round(usd * fx * 10) / 10 : null;
        const row = {
          attempt_id: `${scenario.id.toUpperCase()}-T${turn}`,
          model: scenario.modelId,
          resolved_model: resolved,
          scenario_id: scenario.id,
          scenario_label: scenario.label,
          scenario_kind: scenario.kind,
          character_id: scenario.characterId,
          turn,
          user_input: scenario.turns[turn - 1],
          http_status: resp.http_status,
          finish_reason: resp.finish_reason,
          saw_done: resp.saw_done,
          invalid_stream_capture: capture.invalid,
          invalid_reasons: capture.reasons,
          total_visible_chars: totalVisible,
          configured_narrative_pov: assembled.narrativePov.mode,
          pov_owner_present: assembled.povOwnerPresent,
          ...uf,
          usage_cost_usd: usd,
          api_raw_cost_krw: krw,
          latency_s: resp.latency_s,
          retry: 0,
          continuation: 0,
          recovery: 0,
          raw_hash: sha256(resp.text),
          provider_raw: resp.text,
          acceptance_eligible: !capture.invalid,
        };
        save(dir, `turn${turn}-provider-raw.txt`, resp.text);
        save(dir, `turn${turn}-meta.json`, { ...row, provider_raw: undefined });
        save(dir, `turn${turn}-messages.json`, assembled.messages);
        save(dir, `turn${turn}-pov.json`, {
          configured_narrative_pov: assembled.narrativePov.mode,
          assembled_pov_owner_present: assembled.povOwnerPresent,
          pov_owner_preview: assembled.povOwnerText.slice(0, 240),
        });
        rows.push(row);
        history = [
          ...history,
          { role: "user", content: scenario.turns[turn - 1]! },
          { role: "assistant", content: resp.text },
        ];
        console.log({
          id: row.attempt_id,
          totalVisible,
          krw,
          finish: resp.finish_reason,
          invalid: capture.invalid,
          reasons: capture.reasons,
        });
      } catch (e) {
        exclusions.push({ scenario: scenario.id, turn, error: String(e) });
        save(OUT_ROOT, "RUNTIME_RESULTS.json", {
          status: DEEPSEEK_ONLY
            ? "DEEPSEEK_BOUNDARY_RESMOKE_RUNTIME_FAIL"
            : "FINAL_PRODUCTION_SMOKE_RUNTIME_FAIL",
          error: String(e),
          exclusions,
          invalid_captures: invalidCaptures,
          api_calls: apiCalls,
        });
        throw e;
      }
    }
  }

  const all: Record<string, unknown>[] = [];
  for (const sc of readdirSync(join(OUT_ROOT, "live"))) {
    for (const turn of [1, 2] as const) {
      const p = join(OUT_ROOT, "live", sc, "run1", `turn${turn}-meta.json`);
      const r = join(
        OUT_ROOT,
        "live",
        sc,
        "run1",
        `turn${turn}-provider-raw.txt`
      );
      if (existsSync(p) && existsSync(r)) {
        const meta = JSON.parse(readFileSync(p, "utf8")) as Record<
          string,
          unknown
        >;
        meta.provider_raw = readFileSync(r, "utf8");
        all.push(meta);
      }
    }
  }

  function modelStats(model: string, acceptanceOnly: boolean) {
    const m = all.filter(
      (r) =>
        r.model === model &&
        (!acceptanceOnly || r.acceptance_eligible !== false)
    );
    const chars = m
      .map((r) => r.total_visible_chars)
      .filter((x): x is number => typeof x === "number")
      .sort((a, b) => a - b);
    const krw = m
      .map((r) => r.api_raw_cost_krw)
      .filter((x): x is number => typeof x === "number");
    return {
      outputs: m.length,
      median_total_visible_chars: chars.length
        ? chars[Math.floor((chars.length - 1) / 2)]
        : null,
      avg_api_raw_cost_krw: krw.length
        ? krw.reduce((a, b) => a + b, 0) / krw.length
        : null,
      sum_api_raw_cost_krw: krw.reduce((a, b) => a + b, 0),
      finish_reasons: m.map((r) => r.finish_reason),
      visible_chars: m.map((r) => r.total_visible_chars),
      resolved_models: m.map((r) => r.resolved_model),
    };
  }

  const deepseekAll = all.filter((r) => r.model === "deepseek-v4-pro");
  const deepseekInvalid = deepseekAll.filter((r) => r.invalid_stream_capture);
  const runtime = {
    status: DEEPSEEK_ONLY
      ? "DEEPSEEK_BOUNDARY_RESMOKE_CAPTURED"
      : "FINAL_PRODUCTION_SMOKE_CAPTURED",
    DEEPSEEK_ONLY,
    DEEPSEEK_FINAL_SMOKE_CAPTURED: deepseekAll.length > 0,
    TERRA_FINAL_SMOKE_CAPTURED: !DEEPSEEK_ONLY,
    FINAL_HUMAN_REVIEW_REQUIRED: true,
    opus_calls: 0,
    terra_calls: DEEPSEEK_ONLY
      ? 0
      : all.filter((r) => r.model === "gpt-5.6-terra").length,
    deepseek_calls: deepseekAll.length,
    api_calls: apiCalls,
    expected: maxCalls,
    retry: 0,
    continuation: 0,
    recovery: 0,
    invalid_stream_captures: deepseekInvalid.length,
    invalid_capture_details: deepseekInvalid.map((r) => ({
      attempt_id: r.attempt_id,
      reasons: r.invalid_reasons,
      finish_reason: r.finish_reason,
      total_visible_chars: r.total_visible_chars,
    })),
    exclusions,
    by_model: {
      "deepseek-v4-pro": {
        all: modelStats("deepseek-v4-pro", false),
        acceptance_eligible: modelStats("deepseek-v4-pro", true),
      },
      ...(DEEPSEEK_ONLY
        ? {}
        : {
            "gpt-5.6-terra": {
              all: modelStats("gpt-5.6-terra", false),
              acceptance_eligible: modelStats("gpt-5.6-terra", true),
            },
          }),
    },
    historical_note: DEEPSEEK_ONLY
      ? "Prior 904/884 invalid T2 cells remain under final-production-model-smoke as historical raw; excluded from acceptance."
      : null,
    merge: "NOT_RUN — waiting for ChatGPT final human review",
    production_change: false,
  };
  save(OUT_ROOT, "RUNTIME_RESULTS.json", runtime);
  save(OUT_ROOT, "all_rows.json", all);
  save(DOCS, "RUNTIME_RESULTS.json", runtime);
  console.log(JSON.stringify(runtime, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
