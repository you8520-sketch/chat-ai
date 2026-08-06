/**
 * Terra public premium confirmation — 1 relationship chat + 1 action chat (T1→T2 each).
 * Architecture: PR #248 collaborative; no Terra-specific prompt changes.
 */
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const BASE =
  process.env.PROD_BASE ?? "https://chat-ai-production-3e84.up.railway.app";
const COOKIE_FILE = process.env.PROD_COOKIE_FILE ?? "/tmp/terra_axis_cookies.txt";
const CHARACTER_ID = 18;
const PERSONA_ID = 61;
const MODEL_UI = "gpt-5.6-terra";
const OUT_ROOT =
  process.env.OUT_ROOT ?? "/opt/cursor/artifacts/terra-confirmation";

const RELATIONSHIP = [
  "난 본기억없는데.... 나는 렌이라고 부르면 돼. *고개끄덕임* 신입 맞아.",
  "너는 이름이뭐야? 뭐하는 중이었어?",
] as const;
const ACTION = [
  "*로비 천장에서 갑자기 비상 경보가 울리고 출입문 쪽에서 둔탁한 폭발음이 터진다. 렌은 소리가 난 쪽으로 고개를 돌린다.* 저거 뭐야?",
  "*렌은 태형의 소매를 잡고 곁에 붙는다.* 나도 같이 갈게.",
] as const;

type CallResult = {
  http_status: number;
  latency_s: number;
  provider_raw: string;
  final_text: string;
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

async function setSelectedAI(token: string) {
  const res = await fetch(`${BASE}/api/user/selected-ai`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: `session=${token}`,
    },
    body: JSON.stringify({ selectedAI: MODEL_UI }),
  });
  const body = await res.json();
  if (!res.ok || body.selectedAI !== MODEL_UI) {
    throw new Error(`model not selected: ${JSON.stringify(body).slice(0, 200)}`);
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
    clientRequestId: `terra_conf_${opts.tag}_${Date.now().toString(36)}`,
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
      final_text: "",
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
  let final_text = "";
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
      if (ev.type === "replace" && typeof ev.text === "string") {
        provider_raw = ev.text;
        final_text = ev.text;
      }
      if (ev.type === "turn_persisted" && ev.chatId != null) {
        persistedChatId = Number(ev.chatId);
      }
      if (ev.type === "done") {
        done = ev;
        if (typeof ev.finalContent === "string" && ev.finalContent.length > 0) {
          final_text = ev.finalContent;
        } else if (typeof ev.text === "string" && ev.text.length > 0) {
          final_text = ev.text;
        }
      }
      if (ev.type === "error") error = String(ev.message ?? JSON.stringify(ev));
    }
  }
  if (!final_text) final_text = provider_raw;
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
    final_text,
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

async function runSet(
  token: string,
  testSet: "relationship" | "action",
  turns: readonly string[],
  stats: { attempts: number; replacements: number; exclusions: unknown[] }
) {
  const budget = { left: 2 };
  const dir = join(OUT_ROOT, testSet, "run1");
  mkdirSync(dir, { recursive: true });
  let chatId: number | undefined;
  const rows: unknown[] = [];
  for (let turn = 1; turn <= 2; turn++) {
    const tag = `${testSet}_t${turn}`;
    console.log(`\n=== TERRA ${testSet} turn${turn} ===`);
    let resp = await postChat({
      token,
      chatId,
      message: turns[turn - 1]!,
      tag,
    });
    stats.attempts += 1;
    let usedReplacement = false;
    let reasons = runtimeExclude(resp);
    if (reasons.length && budget.left > 0) {
      stats.exclusions.push({ testSet, turn, attempt: 1, reasons });
      resp = await postChat({
        token,
        chatId: turn === 1 ? undefined : chatId,
        message: turns[turn - 1]!,
        tag: `${tag}_repl`,
      });
      stats.attempts += 1;
      stats.replacements += 1;
      budget.left -= 1;
      usedReplacement = true;
      reasons = runtimeExclude(resp);
    }
    if (reasons.length) {
      throw new Error(`RUNTIME_RELIABILITY_FAIL terra/${testSet} t${turn}: ${reasons}`);
    }
    if (turn === 1) {
      chatId = resp.chatId;
      if (!chatId) throw new Error("chat_id_missing");
    }
    const row = {
      attempt_id: `TERRA-${testSet === "relationship" ? "REL" : "ACT"}-T${turn}`,
      test_set: testSet,
      turn,
      user_input: turns[turn - 1],
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
    rows.push(row);
    save(dir, `turn${turn}-provider-raw.txt`, resp.provider_raw);
    save(dir, `turn${turn}-meta.json`, { ...row, provider_raw: undefined });
    console.log({
      id: row.attempt_id,
      chars: row.visible_chars,
      finish: row.finish_reason,
      points: row.cost_points,
    });
  }
  return rows;
}

async function main() {
  mkdirSync(OUT_ROOT, { recursive: true });
  const token = loadSessionCookie();
  const me = await (
    await fetch(`${BASE}/api/auth/me`, {
      headers: { Cookie: `session=${token}` },
    })
  ).json();
  if (me.user?.id !== 34) throw new Error(`expected user 34`);
  await setSelectedAI(token);
  const stats = { attempts: 0, replacements: 0, exclusions: [] as unknown[] };
  const rel = await runSet(token, "relationship", RELATIONSHIP, stats);
  const act = await runSet(token, "action", ACTION, stats);
  await setSelectedAI(token); // keep terra? reset to deepseek after
  await fetch(`${BASE}/api/user/selected-ai`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: `session=${token}`,
    },
    body: JSON.stringify({ selectedAI: "deepseek-v4-pro" }),
  });
  const all = [...rel, ...act];
  save(OUT_ROOT, "outputs_index.json", {
    status: "TERRA_CONFIRMATION_CAPTURED",
    model: MODEL_UI,
    attempts: stats.attempts,
    replacement_calls: stats.replacements,
    exclusions: stats.exclusions,
    valid: all.length,
    outputs: all.map((o) => {
      const x = o as Record<string, unknown>;
      return {
        attempt_id: x.attempt_id,
        visible_chars: x.visible_chars,
        finish_reason: x.finish_reason,
        cost_points: x.cost_points,
        api_raw_cost_krw: x.api_raw_cost_krw,
      };
    }),
  });
  save(OUT_ROOT, "all_valid_rows.json", all);
  console.log("TERRA_CONF_DONE", { valid: all.length, attempts: stats.attempts });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
