/**
 * Muse Spark 1.2 collaborative baseline live — relationship 2 chats × T1→T2.
 * No Muse style adapter. Architecture = PR #248 collaborative + USER_TAIL length.
 */
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const BASE =
  process.env.PROD_BASE ?? "https://chat-ai-production-3e84.up.railway.app";
const COOKIE_FILE = process.env.PROD_COOKIE_FILE ?? "/tmp/terra_axis_cookies.txt";
const CHARACTER_ID = 18;
const PERSONA_ID = 61;
const MODEL_UI = "meta/muse-spark-1.2";
const OUT_ROOT =
  process.env.OUT_ROOT ?? "/opt/cursor/artifacts/muse-spark-baseline";
const TURNS = [
  "난 본기억없는데.... 나는 렌이라고 부르면 돼. *고개끄덕임* 신입 맞아.",
  "너는 이름이뭐야? 뭐하는 중이었어?",
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
    selectedPersonaId: PERSONA_ID,
    isAdultMode: false,
    isNsfwMode: false,
    clientRequestId: `muse_base_${opts.tag}_${Date.now().toString(36)}`,
  };
  if (opts.chatId) body.chatId = opts.chatId;
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `session=${opts.token}`,
      Accept: "text/event-stream",
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
  if (resp.error) reasons.push(`sse_error:${resp.error.slice(0, 120)}`);
  if (!resp.provider_raw.trim()) reasons.push("empty_upstream_stream");
  if (resp.finish_reason == null && resp.provider_raw.trim()) {
    reasons.push("finish_metadata_missing");
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
  let completed = 0;
  let slot = 0;
  while (completed < 2 && slot < 5) {
    slot += 1;
    const run = completed + 1;
    const runDir = join(OUT_ROOT, `run${run}`);
    mkdirSync(runDir, { recursive: true });
    let chatId: number | undefined;
    let failed = false;
    const budget = { left: 2 };
    for (let turn = 1; turn <= 2; turn++) {
      const tag = `r${run}_t${turn}`;
      console.log(`\n=== MUSE run${run} turn${turn} ===`);
      let resp = await postChat({
        token,
        chatId,
        message: TURNS[turn - 1]!,
        tag,
      });
      attempts += 1;
      let usedReplacement = false;
      let reasons = runtimeExclude(resp);
      if (reasons.length && budget.left > 0) {
        exclusions.push({ run, turn, attempt: 1, reasons });
        resp = await postChat({
          token,
          chatId: turn === 1 ? undefined : chatId,
          message: TURNS[turn - 1]!,
          tag: `${tag}_repl`,
        });
        attempts += 1;
        replacements += 1;
        budget.left -= 1;
        usedReplacement = true;
        reasons = runtimeExclude(resp);
      }
      if (reasons.length) {
        exclusions.push({ run, turn, attempt: "final", reasons, usedReplacement });
        failed = true;
        break;
      }
      if (turn === 1) {
        chatId = resp.chatId;
        if (!chatId) {
          failed = true;
          break;
        }
      }
      const row = {
        attempt_id: `MUSE-REL-R${run}T${turn}`,
        run,
        turn,
        user_input: TURNS[turn - 1],
        provider_raw: resp.provider_raw,
        finish_reason: resp.finish_reason,
        latency_s: resp.latency_s,
        visible_chars: [...resp.provider_raw].length,
        chat_id: chatId,
        replacement: usedReplacement,
        raw_hash: sha256(resp.provider_raw),
        model: resp.model,
        provider: resp.provider,
        cost_points: resp.cost,
        api_raw_cost_krw:
          typeof resp.usage?.apiRawCostKrw === "number"
            ? resp.usage.apiRawCostKrw
            : null,
      };
      outputs.push(row);
      save(runDir, `turn${turn}-provider-raw.txt`, resp.provider_raw);
      save(runDir, `turn${turn}-meta.json`, { ...row, provider_raw: undefined });
      console.log({
        id: row.attempt_id,
        chars: row.visible_chars,
        finish: row.finish_reason,
        points: row.cost_points,
        model: row.model,
      });
    }
    if (failed) {
      console.log("RUN_ABORTED", run);
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }
    completed += 1;
    if (completed < 2) await new Promise((r) => setTimeout(r, 2000));
  }
  if (completed < 2) {
    throw new Error(`RUNTIME_RELIABILITY_FAIL muse completed=${completed}`);
  }
  await setSelectedAI(token, "deepseek-v4-pro");
  save(OUT_ROOT, "outputs_index.json", {
    status: "MUSE_BASELINE_LIVE_CAPTURED",
    model: MODEL_UI,
    attempts,
    replacement_calls: replacements,
    exclusions,
    valid: outputs.length,
  });
  save(OUT_ROOT, "all_valid_rows.json", outputs);
  console.log("MUSE_BASELINE_DONE", { valid: outputs.length, attempts, replacements });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
