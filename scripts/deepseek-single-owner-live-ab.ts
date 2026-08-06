/**
 * Live A/B: production triple length owner vs ds_single_terminal_length_owner.
 *
 * Env:
 *   PROD_BASE, PROD_COOKIE_FILE, OUT_ROOT, ART_ROOT
 *   ARM=A|B  (A=production/canary off, B=single owner — caller toggles Railway env)
 */
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { createHash, randomInt } from "node:crypto";

const BASE =
  process.env.PROD_BASE ?? "https://chat-ai-production-3e84.up.railway.app";
const COOKIE_FILE = process.env.PROD_COOKIE_FILE ?? "/tmp/terra_axis_cookies.txt";
const CHARACTER_ID = 18;
const PERSONA_ID = 61;
const MODEL_UI = "deepseek-v4-pro";
const ARM = (process.env.ARM ?? "A").toUpperCase() as "A" | "B";
const OUT_ROOT =
  process.env.OUT_ROOT ??
  `/opt/cursor/artifacts/deepseek-single-owner-ab/arm-${ARM}`;
const EXPECTED_LENGTH_OWNERS = ARM === "A" ? 3 : 1;

const TURNS = [
  "난 본기억없는데.... 나는 렌이라고 부르면 돼. *고개끄덕임* 신입 맞아.",
  "너는 이름이뭐야? 뭐하는 중이었어?",
] as const;

type CallResult = {
  http_status: number;
  latency_s: number;
  provider_raw: string;
  final_text: string;
  db_saved: string;
  done: Record<string, unknown> | null;
  diagnostic_pipeline: Record<string, unknown> | null;
  statuses: string[];
  error: string | null;
  chatId?: number;
  finish_reason: string | null;
  model?: string;
  provider?: string;
  output_tokens: number | null;
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
    clientRequestId: `ds_ab_${ARM}_${opts.tag}_${Date.now().toString(36)}`,
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
      db_saved: "",
      done: null,
      diagnostic_pipeline: null,
      statuses: [],
      error: (await res.text()).slice(0, 2000),
      finish_reason: null,
      output_tokens: null,
    };
  }
  const reader = res.body?.getReader();
  if (!reader) throw new Error("no body");
  const dec = new TextDecoder();
  let buf = "";
  let provider_raw = "";
  let final_text = "";
  let done: Record<string, unknown> | null = null;
  let diagnostic_pipeline: Record<string, unknown> | null = null;
  let persistedChatId: number | undefined;
  const statuses: string[] = [];
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
      if (ev.type === "status" && typeof ev.message === "string") {
        statuses.push(ev.message);
      }
      if (ev.type === "delta" && typeof ev.text === "string") {
        provider_raw += ev.text;
      }
      if (ev.type === "replace" && typeof ev.text === "string") {
        provider_raw = ev.text;
        final_text = ev.text;
      }
      if (ev.type === "turn_persisted" && ev.chatId != null) {
        persistedChatId = Number(ev.chatId);
      }
      if (ev.type === "diagnostic_pipeline") diagnostic_pipeline = ev;
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
  if (done && persistedChatId && !done.chatId) done.chatId = persistedChatId;
  const usage = (done?.usage ?? null) as Record<string, unknown> | null;
  const finish =
    (typeof done?.finishReason === "string" ? done.finishReason : null) ??
    (typeof usage?.finishReason === "string"
      ? (usage.finishReason as string)
      : null);
  const outputTokens =
    typeof usage?.output === "number"
      ? usage.output
      : typeof usage?.outputTokens === "number"
        ? (usage.outputTokens as number)
        : null;
  return {
    http_status: res.status,
    latency_s: (Date.now() - started) / 1000,
    provider_raw,
    final_text,
    db_saved: final_text,
    done,
    diagnostic_pipeline,
    statuses,
    error,
    chatId:
      persistedChatId ??
      (done?.chatId != null ? Number(done.chatId) : undefined),
    finish_reason: finish,
    model: typeof usage?.model === "string" ? usage.model : undefined,
    provider: typeof usage?.provider === "string" ? usage.provider : undefined,
    output_tokens: outputTokens,
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
  if (resp.done == null && resp.provider_raw.trim() && !resp.final_text.trim()) {
    reasons.push("raw_sse_db_incomplete");
  }
  return reasons;
}

function simpleAlarms(text: string, turn: number, prev?: string): string[] {
  const alarms: string[] = [];
  if (/S급\s*가이드|임시\s*등록된\s*S급/.test(text)) {
    alarms.push("USER_STATE_INVENTION");
  }
  if (
    /(직원|스태프|안내원).{0,40}[“"]/.test(text) &&
    /(등록|접수|문진|바이탈|신원)/.test(text)
  ) {
    alarms.push("ADMINISTRATIVE_SUBPLOT");
  }
  if (prev && turn >= 2) {
    const a = text.replace(/\s+/g, "");
    const b = prev.replace(/\s+/g, "");
    if (a.length > 200 && b.length > 200) {
      const slice = b.slice(0, Math.floor(b.length * 0.3));
      if (slice.length > 80 && a.includes(slice.slice(0, 80))) {
        alarms.push("PREVIOUS_TURN_REPLAY");
      }
    }
  }
  if (/\[CURRENT USER INPUT\]|TARGET_LENGTH|SceneDirective|SYSTEM REMINDER/i.test(text)) {
    alarms.push("META_OR_FORMAT_LEAK");
  }
  return alarms;
}

async function fetchDbAssistant(
  chatId: number,
  token: string,
  turn: number
): Promise<string> {
  const res = await fetch(
    `${BASE}/api/chat/messages?chatId=${chatId}&turnLimit=${Math.max(turn + 2, 8)}`,
    { headers: { Cookie: `session=${token}` } }
  );
  if (!res.ok) return "";
  const data = (await res.json()) as {
    messages?: Array<{ role: string; content: string; model?: string }>;
  };
  const assistants = (data.messages ?? []).filter(
    (m) => m.role === "assistant" && m.model !== "greeting"
  );
  return assistants[turn - 1]?.content ?? "";
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

  const meta = {
    arm: ARM,
    expected_length_owners: EXPECTED_LENGTH_OWNERS,
    model: MODEL_UI,
    user_id: 34,
    character_id: CHARACTER_ID,
    persona_id: PERSONA_ID,
    started_at: new Date().toISOString(),
  };
  save(OUT_ROOT, "env_meta.json", meta);

  const outputs: unknown[] = [];
  const exclusions: unknown[] = [];
  let newCalls = 0;
  let replacementCalls = 0;
  let replacementBudget = 1;

  for (let run = 1; run <= 2; run++) {
    const runDir = join(OUT_ROOT, `run${run}`);
    mkdirSync(runDir, { recursive: true });
    let chatId: number | undefined;
    let prevRaw: string | undefined;

    for (let turn = 1; turn <= 2; turn++) {
      const userInput = TURNS[turn - 1]!;
      const tag = `r${run}_t${turn}`;
      console.log(`\n=== ARM ${ARM} run${run} turn${turn} ===`);

      let resp = await postChat({ token, chatId, message: userInput, tag });
      newCalls += 1;
      let usedReplacement = false;
      let reasons = runtimeExclude(resp);

      if (reasons.length > 0 && replacementBudget > 0) {
        save(join(OUT_ROOT, "runtime_excluded"), `${tag}_attempt1.json`, {
          reasons,
          finish_reason: resp.finish_reason,
          provider_raw: resp.provider_raw,
          error: resp.error,
        });
        exclusions.push({ run, turn, attempt: 1, reasons });
        resp = await postChat({
          token,
          chatId: turn === 1 ? undefined : chatId,
          message: userInput,
          tag: `${tag}_repl`,
        });
        newCalls += 1;
        replacementCalls += 1;
        replacementBudget -= 1;
        usedReplacement = true;
        reasons = runtimeExclude(resp);
      }

      if (reasons.length > 0) {
        save(join(OUT_ROOT, "runtime_excluded"), `${tag}_final.json`, {
          reasons,
          finish_reason: resp.finish_reason,
          provider_raw: resp.provider_raw,
          error: resp.error,
          usedReplacement,
        });
        exclusions.push({ run, turn, attempt: "final", reasons, usedReplacement });
        throw new Error(
          `ARM ${ARM} r${run}t${turn} runtime excluded: ${reasons.join(",")}`
        );
      }

      if (turn === 1) {
        chatId = resp.chatId;
        if (!chatId) throw new Error("no chatId");
      }
      const dbSaved = chatId
        ? (await fetchDbAssistant(chatId, token, turn)) || resp.final_text
        : resp.final_text;

      // Integrity hints from diagnostic pipeline when present
      const integrity = (resp.diagnostic_pipeline as {
        integrity?: {
          canaryVariant?: string;
          resolvedProviderModelId?: string;
        };
      } | null)?.integrity;

      const attemptId = `${ARM}-R${run}T${turn}`;
      const alarms = simpleAlarms(resp.provider_raw, turn, prevRaw);
      const row = {
        attempt_id: attemptId,
        arm: ARM,
        run,
        turn,
        user_input: userInput,
        provider_raw: resp.provider_raw,
        final_text: resp.final_text,
        db_saved: dbSaved,
        finish_reason: resp.finish_reason,
        latency_s: resp.latency_s,
        raw_chars: [...resp.provider_raw].length,
        output_tokens: resp.output_tokens,
        chat_id: chatId,
        replacement: usedReplacement,
        alarms,
        raw_hash: sha256(resp.provider_raw),
        model: resp.model,
        provider: resp.provider,
        canary_variant: integrity?.canaryVariant ?? null,
        resolved_model: integrity?.resolvedProviderModelId ?? null,
      };
      outputs.push(row);
      prevRaw = resp.provider_raw;

      save(runDir, `turn${turn}-provider-raw.txt`, resp.provider_raw);
      save(runDir, `turn${turn}-sse-final.txt`, resp.final_text);
      save(runDir, `turn${turn}-db-saved.txt`, dbSaved);
      save(runDir, `turn${turn}-meta.json`, {
        ...row,
        provider_raw: undefined,
        final_text: undefined,
        db_saved: undefined,
      });
      if (resp.diagnostic_pipeline) {
        save(runDir, `turn${turn}-pipeline.json`, resp.diagnostic_pipeline);
      }
      console.log({
        attemptId,
        chars: row.raw_chars,
        finish: row.finish_reason,
        alarms,
        canary: row.canary_variant,
        latency_s: row.latency_s,
      });
    }
    if (run < 2) await new Promise((r) => setTimeout(r, 2000));
  }

  save(OUT_ROOT, "outputs_index.json", {
    arm: ARM,
    new_calls: newCalls,
    replacement_calls: replacementCalls,
    exclusions,
    outputs: outputs.map((o) => {
      const x = o as Record<string, unknown>;
      return {
        attempt_id: x.attempt_id,
        raw_chars: x.raw_chars,
        finish_reason: x.finish_reason,
        alarms: x.alarms,
        canary_variant: x.canary_variant,
        provider: x.provider,
        replacement: x.replacement,
      };
    }),
  });
  console.log("ARM_DONE", {
    arm: ARM,
    newCalls,
    replacementCalls,
    exclusions: exclusions.length,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
