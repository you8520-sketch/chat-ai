/**
 * Audit 45 — DeepSeek auto-progression AI-focal screen.
 * 2 chats × (T1→T2 standard) then isContinue=true → 2 valid auto outputs.
 */
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const BASE =
  process.env.PROD_BASE ?? "https://chat-ai-production-3e84.up.railway.app";
const COOKIE_FILE = process.env.PROD_COOKIE_FILE ?? "/tmp/terra_axis_cookies.txt";
const CHARACTER_ID = 18;
const PERSONA_ID = 61;
const MODEL_UI = "deepseek-v4-pro";
const OUT_ROOT =
  process.env.OUT_ROOT ??
  "/opt/cursor/artifacts/auto-progression-ai-focal";

const TURNS = [
  "난 본기억없는데.... 나는 렌이라고 부르면 돼. *고개끄덕임* 신입 맞아.",
  "너는 이름이뭐야? 뭐하는 중이었어?",
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
  total_points_cost: number | null;
};

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
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
  await fetch(`${BASE}/api/user/selected-ai`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: `session=${token}`,
    },
    body: JSON.stringify({ selectedAI: MODEL_UI }),
  });
  const sel = await (
    await fetch(`${BASE}/api/user/selected-ai`, {
      headers: { Cookie: `session=${token}` },
    })
  ).json();
  if (sel.selectedAI !== MODEL_UI) {
    throw new Error(`model not selected: ${sel.selectedAI}`);
  }
}

async function postChat(opts: {
  token: string;
  chatId?: number;
  message?: string;
  isContinue?: boolean;
  tag: string;
}): Promise<CallResult> {
  const started = Date.now();
  const body: Record<string, unknown> = {
    characterId: CHARACTER_ID,
    selectedPersonaId: PERSONA_ID,
    isAdultMode: false,
    isNsfwMode: false,
    clientRequestId: `auto_${opts.tag}_${Date.now().toString(36)}`,
  };
  if (opts.chatId) body.chatId = opts.chatId;
  if (opts.isContinue) body.isContinue = true;
  else body.message = opts.message ?? "";
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
      total_points_cost: null,
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
    total_points_cost:
      typeof done?.totalPointsCost === "number" ? done.totalPointsCost : null,
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

function extractUsage(resp: CallResult) {
  const u = resp.usage ?? {};
  return {
    input_tokens: typeof u.input === "number" ? u.input : null,
    visible_output_tokens:
      typeof u.apiContentOutputTokens === "number"
        ? u.apiContentOutputTokens
        : typeof u.output === "number"
          ? u.output
          : null,
    reasoning_tokens:
      typeof u.apiReasoningOutputTokens === "number"
        ? u.apiReasoningOutputTokens
        : null,
    total_billed_output_tokens:
      typeof u.apiOutputTokens === "number"
        ? u.apiOutputTokens
        : typeof u.output === "number"
          ? u.output
          : null,
    usage_cost: typeof u.cost === "number" ? u.cost : null,
    upstream_cost_usd:
      typeof u.upstreamCostUsd === "number" ? u.upstreamCostUsd : null,
    api_raw_cost_krw:
      typeof u.apiRawCostKrw === "number" ? u.apiRawCostKrw : null,
    charged_points: resp.total_points_cost ?? resp.cost,
  };
}

async function main() {
  mkdirSync(OUT_ROOT, { recursive: true });
  const token = loadSessionCookie();
  const me = await (
    await fetch(`${BASE}/api/auth/me`, {
      headers: { Cookie: `session=${token}` },
    })
  ).json();
  if (me.user?.id !== 34) throw new Error(`expected user 34 got ${me.user?.id}`);
  await setSelectedAI(token);

  save(OUT_ROOT, "env_meta.json", {
    model: MODEL_UI,
    user_id: 34,
    character_id: CHARACTER_ID,
    persona_id: PERSONA_ID,
    started_at: new Date().toISOString(),
  });

  const autoOutputs: unknown[] = [];
  const prepOutputs: unknown[] = [];
  const exclusions: unknown[] = [];
  let newCalls = 0;
  let replacementCalls = 0;
  let replacementBudget = 2; // model×set replacement max 2
  let completed = 0;
  let slot = 0;

  while (completed < 2 && slot < 5) {
    slot += 1;
    const run = completed + 1;
    const runDir = join(OUT_ROOT, `run${run}`);
    mkdirSync(runDir, { recursive: true });
    let chatId: number | undefined;
    let failed = false;

    // Standard T1→T2 prep
    for (let turn = 1; turn <= 2; turn++) {
      const tag = `prep_r${run}_t${turn}`;
      let resp = await postChat({
        token,
        chatId,
        message: TURNS[turn - 1],
        tag,
      });
      newCalls += 1;
      let reasons = runtimeExclude(resp);
      let usedReplacement = false;
      if (reasons.length && replacementBudget > 0) {
        exclusions.push({ phase: "prep", run, turn, attempt: 1, reasons });
        resp = await postChat({
          token,
          chatId: turn === 1 ? undefined : chatId,
          message: TURNS[turn - 1],
          tag: `${tag}_repl`,
        });
        newCalls += 1;
        replacementCalls += 1;
        replacementBudget -= 1;
        usedReplacement = true;
        reasons = runtimeExclude(resp);
      }
      if (reasons.length) {
        exclusions.push({
          phase: "prep",
          run,
          turn,
          attempt: "final",
          reasons,
          usedReplacement,
        });
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
      prepOutputs.push({
        run,
        turn,
        chat_id: chatId,
        raw_chars: [...resp.provider_raw].length,
        finish_reason: resp.finish_reason,
      });
      save(runDir, `prep-turn${turn}-raw.txt`, resp.provider_raw);
      console.log(`prep r${run}t${turn}`, {
        chars: [...resp.provider_raw].length,
        finish: resp.finish_reason,
      });
    }
    if (failed || !chatId) {
      console.log("PREP_ABORTED", run);
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }

    // Auto-progression
    const tag = `auto_r${run}`;
    console.log(`\n=== AUTO run${run} ===`);
    let resp = await postChat({ token, chatId, isContinue: true, tag });
    newCalls += 1;
    let reasons = runtimeExclude(resp);
    let usedReplacement = false;
    if (reasons.length && replacementBudget > 0) {
      exclusions.push({ phase: "auto", run, attempt: 1, reasons });
      save(join(OUT_ROOT, "runtime_excluded"), `${tag}_attempt1.json`, {
        reasons,
        provider_raw: resp.provider_raw,
        error: resp.error,
      });
      resp = await postChat({
        token,
        chatId,
        isContinue: true,
        tag: `${tag}_repl`,
      });
      newCalls += 1;
      replacementCalls += 1;
      replacementBudget -= 1;
      usedReplacement = true;
      reasons = runtimeExclude(resp);
    }
    if (reasons.length) {
      exclusions.push({
        phase: "auto",
        run,
        attempt: "final",
        reasons,
        usedReplacement,
      });
      save(join(OUT_ROOT, "runtime_excluded"), `${tag}_final.json`, {
        reasons,
        provider_raw: resp.provider_raw,
        error: resp.error,
      });
      console.error("AUTO_EXCLUDED", run, reasons.join(","));
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }

    const usage = extractUsage(resp);
    const row = {
      attempt_id: `AUTO-R${run}`,
      run,
      phase: "auto_progression",
      user_input: "(isContinue=true — no explicit user input)",
      provider_raw: resp.provider_raw,
      finish_reason: resp.finish_reason,
      latency_s: resp.latency_s,
      raw_chars: [...resp.provider_raw].length,
      chat_id: chatId,
      replacement: usedReplacement,
      raw_hash: sha256(resp.provider_raw),
      model: resp.model,
      provider: resp.provider,
      ...usage,
    };
    autoOutputs.push(row);
    save(runDir, "auto-provider-raw.txt", resp.provider_raw);
    save(runDir, "auto-meta.json", { ...row, provider_raw: undefined });
    save(runDir, "auto-done.json", resp.done ?? {});
    console.log({
      attemptId: row.attempt_id,
      chars: row.raw_chars,
      finish: row.finish_reason,
      charged_points: row.charged_points,
    });
    completed += 1;
    if (completed < 2) await new Promise((r) => setTimeout(r, 2000));
  }

  if (completed < 2) {
    throw new Error(`auto incomplete: ${completed} calls=${newCalls}`);
  }

  save(OUT_ROOT, "outputs_index.json", {
    auto_valid: autoOutputs.length,
    new_calls: newCalls,
    replacement_calls: replacementCalls,
    exclusions,
    prep: prepOutputs,
    outputs: autoOutputs.map((o) => {
      const x = o as Record<string, unknown>;
      return {
        attempt_id: x.attempt_id,
        raw_chars: x.raw_chars,
        finish_reason: x.finish_reason,
        charged_points: x.charged_points,
        usage_cost: x.usage_cost,
        provider: x.provider,
      };
    }),
  });
  console.log("AUTO_DONE", {
    completed,
    newCalls,
    replacementCalls,
    exclusions: exclusions.length,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
