/**
 * Audit 55 — Gemini 3.1 Pro Preview vs Claude Opus 5 minimal RP screen.
 * Standard collaborative baseline via /api/chat (no model adapters).
 * retry = 0 / continuation = 0 / recovery = 0
 */
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const BASE = process.env.PROD_BASE ?? "http://localhost:3000";
const COOKIE_FILE =
  process.env.PROD_COOKIE_FILE ?? "/tmp/muse_bakeoff_local_cookies.txt";
const CHARACTER_ID = Number(process.env.CHARACTER_ID ?? 18);
const PERSONA_ID = Number(process.env.PERSONA_ID ?? 61);
const OUT_ROOT =
  process.env.OUT_ROOT ??
  "/opt/cursor/artifacts/gemini31-opus5-minimal-screen";

const MODELS = [
  {
    key: "gemini31",
    id: "gemini-3.1-pro-preview",
    reasoning_expected: "low",
    reasoning_note:
      "CI accepts none but still burns reasoning tokens; production wire = low",
  },
  {
    key: "opus5",
    id: "claude-opus-5",
    reasoning_expected: "unset",
    reasoning_note:
      "CI accepts none with 0 reasoning tokens; production leaves reasoning_effort unset",
  },
] as const;

const REL_TURNS = [
  "난 본기억없는데.... 나는 렌이라고 부르면 돼. *고개끄덕임* 신입 맞아.",
  "너는 이름이뭐야? 뭐하는 중이었어?",
] as const;

const ACT_TURNS = [
  "*로비 천장에서 갑자기 비상 경보가 울리고 출입문 쪽에서 둔탁한 폭발음이 터진다. 렌은 소리가 난 쪽으로 고개를 돌린다.* 저거 뭐야?",
  "*렌은 태형의 소매를 잡고 곁에 붙는다.* 나도 같이 갈게.",
] as const;

type CallResult = {
  http_status: number;
  latency_s: number;
  ttft_s: number | null;
  provider_raw: string;
  done: Record<string, unknown> | null;
  error: string | null;
  chatId?: number;
  finish_reason: string | null;
  model?: string;
  provider?: string;
  usage: Record<string, unknown> | null;
  cost: number | null;
};

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
function loadSessionCookie(): string {
  const raw = readFileSync(COOKIE_FILE, "utf8");
  for (const line of raw.split("\n")) {
    const normalized = line.startsWith("#HttpOnly_")
      ? line.slice("#HttpOnly_".length)
      : line.startsWith("#")
        ? ""
        : line;
    if (!normalized) continue;
    const parts = normalized.split("\t");
    if (parts.length >= 7 && parts[5] === "session") return parts[6]!.trim();
  }
  throw new Error("session cookie not found");
}
function koreanChars(text: string): number {
  return [...text].filter((ch) => /[\uAC00-\uD7A3]/.test(ch)).length;
}

async function setSelectedAI(token: string, model: string) {
  const res = await fetch(`${BASE}/api/user/selected-ai`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: `session=${token}`,
    },
    body: JSON.stringify({ selectedAI: model }),
  });
  const body = await res.json();
  if (!res.ok || body.selectedAI !== model) {
    throw new Error(`model not selected: ${JSON.stringify(body).slice(0, 300)}`);
  }
}

async function postChat(opts: {
  token: string;
  chatId?: number;
  message: string;
  tag: string;
}): Promise<CallResult> {
  const started = Date.now();
  let firstDeltaAt: number | null = null;
  const body: Record<string, unknown> = {
    characterId: CHARACTER_ID,
    message: opts.message,
    personaId: PERSONA_ID,
  };
  if (opts.chatId != null) body.chatId = opts.chatId;
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `session=${opts.token}`,
      "X-Audit-Tag": opts.tag,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    return {
      http_status: res.status,
      latency_s: (Date.now() - started) / 1000,
      ttft_s: null,
      provider_raw: "",
      done: null,
      error: (await res.text()).slice(0, 2000),
      finish_reason: null,
      usage: null,
      cost: null,
    };
  }
  const reader = res.body?.getReader();
  if (!reader) throw new Error("no body");
  const dec = new TextDecoder();
  let buf = "";
  let provider_raw = "";
  let done: Record<string, unknown> | null = null;
  let persistedChatId: number | undefined;
  let error: string | null = null;
  while (true) {
    const { done: eof, value } = await reader.read();
    if (eof) break;
    buf += dec.decode(value, { stream: true });
    const chunks = buf.split("\n\n");
    buf = chunks.pop() ?? "";
    for (const chunk of chunks) {
      let data = "";
      for (const line of chunk.split("\n")) {
        if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!data || data === "[DONE]") continue;
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(data) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (ev.type === "delta" && typeof ev.text === "string") {
        if (firstDeltaAt == null && ev.text.length > 0) firstDeltaAt = Date.now();
        provider_raw += ev.text;
      }
      if (ev.type === "replace" && typeof ev.text === "string") {
        if (firstDeltaAt == null && ev.text.length > 0) firstDeltaAt = Date.now();
        provider_raw = ev.text;
      }
      if (ev.type === "turn_persisted" && ev.chatId != null) {
        persistedChatId = Number(ev.chatId);
      }
      if (ev.type === "done") {
        done = ev;
        if (typeof ev.finalContent === "string" && ev.finalContent.length > 0) {
          provider_raw = ev.finalContent;
        }
      }
      if (ev.type === "error") error = String(ev.message ?? JSON.stringify(ev));
    }
  }
  const usage = (done?.usage ?? null) as Record<string, unknown> | null;
  const finish =
    (typeof done?.finishReason === "string" ? done.finishReason : null) ??
    (typeof usage?.finishReason === "string"
      ? (usage.finishReason as string)
      : null);
  return {
    http_status: res.status,
    latency_s: (Date.now() - started) / 1000,
    ttft_s: firstDeltaAt != null ? (firstDeltaAt - started) / 1000 : null,
    provider_raw,
    done,
    error,
    chatId:
      persistedChatId ??
      (done?.chatId != null ? Number(done.chatId) : undefined),
    finish_reason: finish,
    model: typeof usage?.model === "string" ? usage.model : undefined,
    provider: typeof usage?.provider === "string" ? usage.provider : undefined,
    usage,
    cost: typeof done?.cost === "number" ? done.cost : null,
  };
}

function runtimeExclude(resp: CallResult, requestedModel: string): string[] {
  const reasons: string[] = [];
  if (resp.http_status !== 200) reasons.push(`http_${resp.http_status}`);
  if (resp.error) reasons.push(`sse_error:${resp.error.slice(0, 160)}`);
  if (!resp.provider_raw.trim()) reasons.push("empty_upstream_stream");
  if (resp.finish_reason == null && resp.provider_raw.trim()) {
    reasons.push("finish_metadata_missing");
  }
  const resolved = resp.model ?? (resp.usage?.model as string | undefined);
  if (resolved && resolved !== requestedModel && !resolved.endsWith(requestedModel)) {
    reasons.push(`MODEL_SUBSTITUTION_EXCLUSION:${resolved}`);
  }
  return reasons;
}

function extractUsage(usage: Record<string, unknown> | null) {
  const stages = Array.isArray(usage?.stages)
    ? (usage!.stages as Array<Record<string, unknown>>)
    : [];
  const stage0 = stages[0] ?? {};
  const details =
    (usage?.completion_tokens_details as Record<string, unknown> | undefined) ??
    (stage0.completion_tokens_details as Record<string, unknown> | undefined) ??
    {};
  const promptDetails =
    (usage?.prompt_tokens_details as Record<string, unknown> | undefined) ??
    {};
  const input =
    typeof usage?.apiInputTokens === "number"
      ? usage.apiInputTokens
      : typeof usage?.input === "number"
        ? usage.input
        : typeof usage?.prompt_tokens === "number"
          ? usage.prompt_tokens
          : null;
  const visibleOut =
    typeof usage?.apiContentOutputTokens === "number"
      ? usage.apiContentOutputTokens
      : typeof usage?.apiOutputTokens === "number"
        ? usage.apiOutputTokens
        : typeof usage?.output === "number"
          ? usage.output
          : typeof usage?.completion_tokens === "number"
            ? usage.completion_tokens
            : null;
  const reasoning =
    typeof usage?.reasoningTokens === "number"
      ? usage.reasoningTokens
      : typeof details.reasoning_tokens === "number"
        ? details.reasoning_tokens
        : typeof stage0.reasoningTokens === "number"
          ? stage0.reasoningTokens
          : null;
  const cached =
    typeof usage?.cacheReadTokens === "number"
      ? usage.cacheReadTokens
      : typeof promptDetails.cached_tokens === "number"
        ? promptDetails.cached_tokens
        : null;
  const usageCostUsd =
    typeof usage?.upstreamCostUsd === "number"
      ? usage.upstreamCostUsd
      : typeof usage?.openRouterCostUsd === "number"
        ? usage.openRouterCostUsd
        : typeof (usage?.cost_details as Record<string, unknown> | undefined)
              ?.upstream_inference_cost === "number"
          ? ((usage!.cost_details as Record<string, unknown>)
              .upstream_inference_cost as number)
          : null;
  const apiRawCostKrw =
    typeof usage?.apiRawCostKrw === "number" ? usage.apiRawCostKrw : null;
  return {
    input_tokens: input,
    cached_input_tokens: cached,
    visible_output_tokens: visibleOut,
    reasoning_tokens: reasoning,
    total_billed_output_tokens:
      typeof usage?.totalBilledOutputTokens === "number"
        ? usage.totalBilledOutputTokens
        : null,
    usage_cost_usd: usageCostUsd,
    api_raw_cost_krw: apiRawCostKrw,
    usage_cost_points: typeof usage?.cost === "number" ? usage.cost : null,
  };
}

async function runChat(opts: {
  token: string;
  modelId: string;
  modelKey: string;
  testSet: "relationship" | "action";
  turns: readonly string[];
  reasoningExpected: string;
  reasoningNote: string;
}) {
  const outputs: Record<string, unknown>[] = [];
  let chatId: number | undefined;
  const dir = join(OUT_ROOT, opts.modelKey, opts.testSet, "run1");
  mkdirSync(dir, { recursive: true });

  for (let turn = 1; turn <= 2; turn++) {
    const tag = `${opts.modelKey}_${opts.testSet}_t${turn}`;
    console.log(`\n=== ${opts.modelKey} ${opts.testSet} turn${turn} ===`);
    const resp = await postChat({
      token: opts.token,
      chatId,
      message: opts.turns[turn - 1]!,
      tag,
    });
    const reasons = runtimeExclude(resp, opts.modelId);
    if (reasons.length) {
      save(dir, `turn${turn}-FAIL.json`, { reasons, resp });
      throw new Error(
        `FAILED ${opts.modelKey} ${opts.testSet} t${turn}: ${reasons.join(",")}`
      );
    }
    if (turn === 1) {
      chatId = resp.chatId;
      if (!chatId) throw new Error("missing chatId");
    }
    const uf = extractUsage(resp.usage);
    const row = {
      attempt_id: `${opts.modelKey.toUpperCase()}-${opts.testSet === "relationship" ? "REL" : "ACT"}-R1T${turn}`,
      model_key: opts.modelKey,
      model_ui: opts.modelId,
      requested_model: opts.modelId,
      resolved_model: resp.model ?? opts.modelId,
      test_set: opts.testSet,
      run: 1,
      turn,
      user_input: opts.turns[turn - 1],
      provider_raw: resp.provider_raw,
      finish_reason: resp.finish_reason,
      latency_s: resp.latency_s,
      ttft_s: resp.ttft_s,
      visible_chars: [...resp.provider_raw].length,
      korean_chars: koreanChars(resp.provider_raw),
      chat_id: chatId,
      replacement: false,
      retry: 0,
      continuation: 0,
      recovery: 0,
      raw_hash: sha256(resp.provider_raw),
      provider: resp.provider ?? "cheaperinference",
      cost_points: resp.cost ?? uf.usage_cost_points,
      reasoning_requested: opts.reasoningExpected,
      reasoning_effort: opts.reasoningExpected,
      reasoning_note: opts.reasoningNote,
      ...uf,
      usage: resp.usage,
    };
    outputs.push(row);
    save(dir, `turn${turn}-provider-raw.txt`, resp.provider_raw);
    save(dir, `turn${turn}-meta.json`, { ...row, provider_raw: undefined });
    console.log({
      id: row.attempt_id,
      chars: row.visible_chars,
      finish: row.finish_reason,
      points: row.cost_points,
      apiRawCostKrw: uf.api_raw_cost_krw,
      usage_cost_usd: uf.usage_cost_usd,
      reasoning_tokens: uf.reasoning_tokens,
      provider: row.provider,
      latency: row.latency_s,
    });
  }
  return outputs;
}

async function main() {
  mkdirSync(OUT_ROOT, { recursive: true });
  const token = loadSessionCookie();
  const all: unknown[] = [];
  const perModel: Record<
    string,
    { attempts: number; valid: number; replacements_used: number }
  > = {};

  for (const m of MODELS) {
    await setSelectedAI(token, m.id);
    const attemptsRef = { n: 0 };
    try {
      const rel = await runChat({
        token,
        modelId: m.id,
        modelKey: m.key,
        testSet: "relationship",
        turns: REL_TURNS,
        reasoningExpected: m.reasoning_expected,
        reasoningNote: m.reasoning_note,
      });
      attemptsRef.n += 2;
      const act = await runChat({
        token,
        modelId: m.id,
        modelKey: m.key,
        testSet: "action",
        turns: ACT_TURNS,
        reasoningExpected: m.reasoning_expected,
        reasoningNote: m.reasoning_note,
      });
      attemptsRef.n += 2;
      all.push(...rel, ...act);
      perModel[m.key] = {
        attempts: attemptsRef.n,
        valid: rel.length + act.length,
        replacements_used: 0,
      };
    } catch (e) {
      perModel[m.key] = {
        attempts: attemptsRef.n,
        valid: all.filter(
          (r) => (r as { model_key?: string }).model_key === m.key
        ).length,
        replacements_used: 0,
      };
      save(OUT_ROOT, "RUNTIME_RESULTS.json", {
        status: "GEMINI31_OPUS5_MINIMAL_SCREEN_RUNTIME_FAIL",
        error: String(e),
        perModel,
        attempts: Object.values(perModel).reduce((a, b) => a + b.attempts, 0),
        valid: all.length,
        retry: 0,
        continuation: 0,
        recovery: 0,
      });
      throw e;
    }
  }

  await setSelectedAI(token, "deepseek-v4-pro").catch(() => undefined);
  save(OUT_ROOT, "all_valid_rows.json", all);
  save(OUT_ROOT, "RUNTIME_RESULTS.json", {
    status: "GEMINI31_OPUS5_MINIMAL_SCREEN_LIVE_CAPTURED",
    perModel,
    attempts: Object.values(perModel).reduce((a, b) => a + b.attempts, 0),
    valid: all.length,
    retry: 0,
    continuation: 0,
    recovery: 0,
    character_id: CHARACTER_ID,
    persona_id: PERSONA_ID,
    prompt_owners: {
      SceneDirective: 0,
      collaborative_owner: 1,
      legacy_novel_owner: 0,
      terminal_length_owner: 1,
    },
    human_review: "NOT_RUN — waiting for ChatGPT",
    production_db_apply: false,
    public_picker_exposure: false,
    pricing_change: false,
    auto_merge: false,
    auto_deploy: false,
  });
  console.log(
    JSON.stringify(
      {
        status: "GEMINI31_OPUS5_MINIMAL_SCREEN_LIVE_CAPTURED",
        perModel,
        valid: all.length,
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
