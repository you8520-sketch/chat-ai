/**
 * Muse Spark 1.2 action baseline — 1 chat × Turn1→Turn2.
 * Max 2 replacement calls total. No Muse adapter.
 */
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const BASE = process.env.PROD_BASE ?? "http://localhost:3000";
const COOKIE_FILE =
  process.env.PROD_COOKIE_FILE ?? "/tmp/muse_bakeoff_local_cookies.txt";
const CHARACTER_ID = Number(process.env.CHARACTER_ID ?? 18);
const PERSONA_ID = Number(process.env.PERSONA_ID ?? 61);
const MODEL_UI = "meta/muse-spark-1.2";
const OUT_ROOT =
  process.env.OUT_ROOT ?? "/opt/cursor/artifacts/muse-value-bakeoff-action";
const MAX_REPLACEMENTS = 2;
const TURNS = [
  "*로비 천장에서 갑자기 비상 경보가 울리고 출입문 쪽에서 둔탁한 폭발음이 터진다. 렌은 소리가 난 쪽으로 고개를 돌린다.* 저거 뭐야?",
  "*렌은 태형의 소매를 잡고 곁에 붙는다.* 나도 같이 갈게.",
] as const;

type CallResult = {
  http_status: number;
  latency_s: number;
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

function usageFields(usage: Record<string, unknown> | null) {
  const stages = Array.isArray(usage?.stages)
    ? (usage!.stages as Array<Record<string, unknown>>)
    : [];
  const stage0 = stages[0] ?? {};
  const input =
    typeof usage?.apiInputTokens === "number"
      ? usage.apiInputTokens
      : typeof usage?.input === "number"
        ? usage.input
        : null;
  const visibleOut =
    typeof usage?.apiOutputTokens === "number"
      ? usage.apiOutputTokens
      : typeof usage?.output === "number"
        ? usage.output
        : null;
  const reasoning =
    typeof usage?.reasoningTokens === "number"
      ? usage.reasoningTokens
      : typeof stage0.reasoningTokens === "number"
        ? stage0.reasoningTokens
        : null;
  const billedOut =
    typeof usage?.totalBilledOutputTokens === "number"
      ? usage.totalBilledOutputTokens
      : typeof stage0.totalBilledOutputTokens === "number"
        ? stage0.totalBilledOutputTokens
        : null;
  const usageCost =
    typeof usage?.cost === "number"
      ? usage.cost
      : typeof usage?.upstream_cost_usd === "number"
        ? usage.upstream_cost_usd
        : null;
  const apiRawCostKrw =
    typeof usage?.apiRawCostKrw === "number" ? usage.apiRawCostKrw : null;
  return {
    input_tokens: input,
    visible_output_tokens: visibleOut,
    reasoning_tokens: reasoning,
    total_billed_output_tokens: billedOut,
    usage_cost: usageCost,
    api_raw_cost_krw: apiRawCostKrw,
  };
}

async function setSelectedAI(token: string, model = MODEL_UI) {
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
    throw new Error(`model not selected: ${JSON.stringify(body).slice(0, 240)}`);
  }
}

async function postChat(opts: {
  token: string;
  chatId?: number;
  message: string;
  tag: string;
}): Promise<CallResult> {
  const started = Date.now();
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
      if (ev.type === "delta" && typeof ev.text === "string") provider_raw += ev.text;
      if (ev.type === "replace" && typeof ev.text === "string") provider_raw = ev.text;
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

function runtimeExclude(resp: CallResult): string[] {
  const reasons: string[] = [];
  if (resp.http_status !== 200) reasons.push(`http_${resp.http_status}`);
  if (resp.error) {
    const err = resp.error;
    if (/429/.test(err) && !resp.provider_raw.trim()) {
      reasons.push("provider_429_without_output");
    }
    reasons.push(`sse_error:${err.slice(0, 120)}`);
  }
  if (!resp.provider_raw.trim()) reasons.push("empty_upstream_stream");
  if (resp.finish_reason == null && resp.provider_raw.trim()) {
    reasons.push("finish_metadata_missing");
  }
  // Incomplete RAW/SSE/DB: empty raw already covered; mark truncated done mismatch.
  if (
    resp.done &&
    typeof resp.done.finalContent === "string" &&
    resp.done.finalContent.length === 0 &&
    !resp.provider_raw.trim()
  ) {
    reasons.push("incomplete_raw_sse_db");
  }
  return reasons;
}

async function main() {
  mkdirSync(OUT_ROOT, { recursive: true });
  const token = loadSessionCookie();
  await setSelectedAI(token);
  const outputs: unknown[] = [];
  const exclusions: unknown[] = [];
  let attempts = 0;
  let replacements = 0;
  let chatId: number | undefined;
  let valid = 0;

  for (let turn = 1; turn <= 2; turn++) {
    const tag = `muse_act_t${turn}`;
    console.log(`\n=== MUSE ACTION turn${turn} ===`);
    let resp = await postChat({
      token,
      chatId,
      message: TURNS[turn - 1]!,
      tag,
    });
    attempts += 1;
    let usedReplacement = false;
    let reasons = runtimeExclude(resp);
    while (reasons.length && replacements < MAX_REPLACEMENTS) {
      exclusions.push({
        run: 1,
        turn,
        attempt: attempts,
        reasons: [...reasons],
      });
      resp = await postChat({
        token,
        chatId: turn === 1 ? undefined : chatId,
        message: TURNS[turn - 1]!,
        tag: `${tag}_repl${replacements + 1}`,
      });
      attempts += 1;
      replacements += 1;
      usedReplacement = true;
      reasons = runtimeExclude(resp);
    }
    if (reasons.length) {
      exclusions.push({
        run: 1,
        turn,
        attempt: "final",
        reasons,
        usedReplacement,
      });
      const runtime = {
        status: "MUSE_RUNTIME_RELIABILITY_FAIL",
        model: MODEL_UI,
        attempts,
        valid,
        replacement_calls: replacements,
        exclusions,
        human_review: "NOT_RUN — waiting for ChatGPT",
      };
      save(OUT_ROOT, "RUNTIME_RESULTS.json", runtime);
      console.error(JSON.stringify(runtime, null, 2));
      process.exit(2);
    }
    if (turn === 1) {
      chatId = resp.chatId;
      if (!chatId) throw new Error("missing chatId after turn1");
    }
    const uf = usageFields(resp.usage);
    const row = {
      attempt_id: `MUSE-ACT-R1T${turn}`,
      run: 1,
      turn,
      test_set: "action",
      user_input: TURNS[turn - 1],
      provider_raw: resp.provider_raw,
      finish_reason: resp.finish_reason,
      latency_s: resp.latency_s,
      visible_chars: [...resp.provider_raw].length,
      korean_chars: koreanChars(resp.provider_raw),
      chat_id: chatId,
      replacement: usedReplacement,
      raw_hash: sha256(resp.provider_raw),
      model: resp.model ?? MODEL_UI,
      provider: resp.provider ?? "openrouter",
      cost_points: resp.cost,
      ...uf,
      usage: resp.usage,
    };
    outputs.push(row);
    valid += 1;
    const runDir = join(OUT_ROOT, "run1");
    save(runDir, `turn${turn}-provider-raw.txt`, resp.provider_raw);
    save(runDir, `turn${turn}-meta.json`, {
      ...row,
      provider_raw: undefined,
    });
    console.log({
      id: row.attempt_id,
      chars: row.visible_chars,
      finish: row.finish_reason,
      points: row.cost_points,
      apiRawCostKrw: uf.api_raw_cost_krw,
      latency: row.latency_s,
    });
  }

  await setSelectedAI(token, "deepseek-v4-pro").catch(() => undefined);
  save(OUT_ROOT, "all_valid_rows.json", outputs);
  save(OUT_ROOT, "RUNTIME_RESULTS.json", {
    status: "MUSE_ACTION_BASELINE_CAPTURED",
    model: MODEL_UI,
    attempts,
    valid,
    replacement_calls: replacements,
    exclusions,
    human_review: "NOT_RUN — waiting for ChatGPT",
  });
  console.log(
    JSON.stringify(
      { status: "MUSE_ACTION_BASELINE_CAPTURED", attempts, valid, replacements },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
