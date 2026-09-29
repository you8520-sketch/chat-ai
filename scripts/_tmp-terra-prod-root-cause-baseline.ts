/**
 * Production main-home Terra root-cause baseline: Like(#18) × Ren persona, 2 turns.
 * Saves redacted artifacts under output/terra-production-root-cause/baseline.
 * Does NOT log cookies, tokens, or API keys.
 */
import { mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.PROD_BASE ?? "https://chat-ai-production-3e84.up.railway.app";
const COOKIE_FILE = process.env.PROD_COOKIE_FILE ?? "/tmp/terra_smoke_cookies.txt";
const OUT = process.env.OUT_DIR ?? "output/terra-production-root-cause/baseline";
const ART =
  process.env.ART_DIR ?? "/opt/cursor/artifacts/terra-production-root-cause/baseline";
const CHARACTER_ID = Number(process.env.CHARACTER_ID ?? 18);
const PERSONA_ID = Number(process.env.PERSONA_ID ?? 60);

const TURN1 =
  "나는 렌이라고 부르면 돼....나는 본기억이 안나는데....나 알아?(갸웃)";
const TURN2 =
  "같이갈래?*두리번 거리면서 다가오는 사람들을 보다가 다시 라이크를 쳐다본다*";

function loadSessionCookie(): string {
  const raw = require("node:fs").readFileSync(COOKIE_FILE, "utf8") as string;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    // Netscape format may prefix HttpOnly cookies with "#HttpOnly_"
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

function cookieHeader(token: string): string {
  return `session=${token}`;
}

async function api(
  path: string,
  init: RequestInit & { token: string }
): Promise<{ status: number; json: any; text: string }> {
  const { token, ...rest } = init;
  const res = await fetch(`${BASE}${path}`, {
    ...rest,
    headers: {
      ...(rest.headers || {}),
      Cookie: cookieHeader(token),
    },
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* html or sse */
  }
  return { status: res.status, json, text };
}

type StreamCapture = {
  http_status: number;
  latency_s: number;
  events: any[];
  provider_raw: string;
  final_text: string;
  done: any;
  turn_persisted: any;
  statuses: string[];
  error: string | null;
};

async function postChat(opts: {
  token: string;
  characterId: number;
  chatId?: number;
  message: string;
  personaId: number;
}): Promise<StreamCapture> {
  const started = Date.now();
  const body: Record<string, unknown> = {
    characterId: opts.characterId,
    message: opts.message,
    selectedPersonaId: opts.personaId,
    selectedAI: "gpt-5.6-terra",
    isAdultMode: false,
    isNsfwMode: false,
    clientRequestId: `audit_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 8)}`,
  };
  if (opts.chatId) body.chatId = opts.chatId;

  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader(opts.token),
      Accept: "text/event-stream",
    },
    body: JSON.stringify(body),
  });

  const events: any[] = [];
  let provider_raw = "";
  let final_text = "";
  let done: any = null;
  let turn_persisted: any = null;
  const statuses: string[] = [];
  let error: string | null = null;

  if (!res.ok) {
    const t = await res.text();
    return {
      http_status: res.status,
      latency_s: (Date.now() - started) / 1000,
      events: [],
      provider_raw: "",
      final_text: "",
      done: null,
      turn_persisted: null,
      statuses: [],
      error: t.slice(0, 2000),
    };
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("no body");
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done: eof, value } = await reader.read();
    if (eof) break;
    buf += dec.decode(value, { stream: true });
    const chunks = buf.split("\n\n");
    buf = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const lines = chunk.split("\n");
      let data = "";
      for (const line of lines) {
        if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!data || data === "[DONE]") continue;
      let ev: any;
      try {
        ev = JSON.parse(data);
      } catch {
        continue;
      }
      events.push(ev);
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
      if (ev.type === "done") {
        done = ev;
        if (typeof ev.text === "string" && ev.text) final_text = ev.text;
        if (typeof ev.finalContent === "string" && ev.finalContent) {
          final_text = ev.finalContent;
        }
      }
      if (ev.type === "turn_persisted") turn_persisted = ev;
      if (ev.type === "error") error = JSON.stringify(ev).slice(0, 1000);
    }
  }

  if (!final_text && provider_raw) final_text = provider_raw;

  return {
    http_status: res.status,
    latency_s: (Date.now() - started) / 1000,
    events,
    provider_raw,
    final_text,
    done,
    turn_persisted,
    statuses,
    error,
  };
}

function dialogueBlocks(text: string): string[] {
  const blocks: string[] = [];
  const re = /"([^"\n]{1,800})"|“([^”\n]{1,800})”/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    blocks.push((m[1] ?? m[2] ?? "").trim());
  }
  return blocks.filter(Boolean);
}

function metrics(text: string) {
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const dialogues = dialogueBlocks(text);
  const dialogueChars = dialogues.reduce((a, b) => a + b.length, 0);
  const canon = text.length;
  const noWs = text.replace(/\s/g, "").length;
  const narrationChars = Math.max(0, canon - dialogueChars);
  return {
    canonical_len: canon,
    no_ws_len: noWs,
    paragraph_count: paras.length,
    dialogue_block_count: dialogues.length,
    dialogue_paragraph_ratio_pct:
      paras.length === 0
        ? 0
        : Math.round(
            (paras.filter((p) => /["“]/.test(p)).length / paras.length) * 1000
          ) / 10,
    narration_char_ratio_pct:
      canon === 0 ? 0 : Math.round((narrationChars / canon) * 1000) / 10,
    dialogue_blocks: dialogues,
    avg_dialogue_block_len:
      dialogues.length === 0
        ? 0
        : Math.round((dialogueChars / dialogues.length) * 10) / 10,
    last_200: text.slice(-200),
  };
}

function redactRequestMeta(meta: Record<string, unknown>) {
  const clone = { ...meta };
  delete clone.cookie;
  delete clone.token;
  delete clone.authorization;
  return clone;
}

function saveBoth(name: string, content: string | object) {
  mkdirSync(OUT, { recursive: true });
  mkdirSync(ART, { recursive: true });
  const data =
    typeof content === "string" ? content : JSON.stringify(content, null, 2);
  writeFileSync(join(OUT, name), data, "utf8");
  writeFileSync(join(ART, name), data, "utf8");
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  mkdirSync(ART, { recursive: true });
  const token = loadSessionCookie();

  const health = await api("/api/health", { token, method: "GET" });
  const me = await api("/api/auth/me", { token, method: "GET" });
  const selected = await api("/api/user/selected-ai", {
    token,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ selectedAI: "gpt-5.6-terra" }),
  });
  const personas = await api("/api/personas", { token, method: "GET" });

  saveBoth(
    "env_meta.json",
    redactRequestMeta({
      base: BASE,
      health: health.json,
      user: me.json?.user
        ? {
            id: me.json.user.id,
            email: String(me.json.user.email).replace(
              /(?<=.).(?=[^@]*@)/g,
              "*"
            ),
            points: me.json.user.points,
            is_admin: me.json.user.is_admin,
          }
        : null,
      selectedAI: selected.json,
      personaId: PERSONA_ID,
      characterId: CHARACTER_ID,
      personas: (personas.json?.personas || []).map((p: any) => ({
        id: p.id,
        name: p.name,
        description: p.description,
      })),
      note: "Production /api/chat path; session cookie not stored in artifacts",
    })
  );

  console.log("health", health.json);
  console.log("turn1 starting…");
  const t1 = await postChat({
    token,
    characterId: CHARACTER_ID,
    message: TURN1,
    personaId: PERSONA_ID,
  });
  const chatId = t1.turn_persisted?.chatId ?? t1.done?.chatId;
  if (!chatId) {
    saveBoth("turn-1-error.json", t1);
    throw new Error(`turn1 failed: ${t1.error || t1.http_status}`);
  }

  const m1 = metrics(t1.provider_raw || t1.final_text);
  saveBoth("turn-1-provider-raw.txt", t1.provider_raw);
  saveBoth("turn-1-final.txt", t1.final_text);
  saveBoth("turn-1-events.json", t1.events);
  saveBoth("turn-1-metrics.json", {
    ...m1,
    api: {
      http_status: t1.http_status,
      latency_s: t1.latency_s,
      chatId,
      messageId: t1.turn_persisted?.messageId ?? t1.done?.messageId,
      userMessageId: t1.turn_persisted?.userMessageId ?? t1.done?.userMessageId,
      finish_reason: t1.done?.usage?.finishReason ?? t1.done?.finishReason,
      input_tokens: t1.done?.usage?.input ?? t1.done?.usage?.apiInputTokens,
      output_tokens: t1.done?.usage?.output ?? t1.done?.usage?.apiOutputTokens,
      reasoning_tokens:
        t1.done?.usage?.reasoningTokens ??
        t1.done?.usage?.apiReasoningOutputTokens ??
        0,
      lengthRecoveryPasses: t1.done?.usage?.lengthRecoveryPasses ?? 0,
      model: t1.done?.usage?.model,
      provider: t1.done?.usage?.provider,
      statuses: t1.statuses,
      error: t1.error,
    },
    user_input: TURN1,
  });
  saveBoth(
    "turn-1-request-redacted.json",
    redactRequestMeta({
      path: "/api/chat",
      method: "POST",
      body: {
        characterId: CHARACTER_ID,
        message: TURN1,
        selectedPersonaId: PERSONA_ID,
        selectedAI: "gpt-5.6-terra",
        isAdultMode: false,
        chatId: null,
      },
      observed_response_meta: {
        chatId,
        model: t1.done?.usage?.model,
        provider: t1.done?.usage?.provider,
        finishReason: t1.done?.usage?.finishReason,
        input_tokens: t1.done?.usage?.input,
        output_tokens: t1.done?.usage?.output,
        reasoning_tokens:
          t1.done?.usage?.reasoningTokens ??
          t1.done?.usage?.apiReasoningOutputTokens ??
          0,
        lengthRecoveryPasses: t1.done?.usage?.lengthRecoveryPasses ?? 0,
        statuses: t1.statuses,
      },
      provider_request_payload:
        "NOT_CAPTURED_ON_PRODUCTION — PROMPT_DEBUG unset; see reconstructed payload from same SHA",
      note: "Client request only. Server→provider messages require PROMPT_DEBUG=1 or Railway log access.",
    })
  );

  // Fetch saved messages for history confirmation
  const msgs1 = await api(`/api/chat/messages?chatId=${chatId}&turnLimit=20`, {
    token,
    method: "GET",
  });
  saveBoth("turn-1-saved-messages.json", {
    status: msgs1.status,
    messages: (msgs1.json?.messages || msgs1.json || []).map((m: any) => ({
      id: m.id,
      role: m.role,
      model: m.model,
      content: m.content,
      createdAt: m.createdAt ?? m.created_at,
    })),
  });

  console.log("turn1 done", {
    chatId,
    len: m1.canonical_len,
    dialogues: m1.dialogue_block_count,
    model: t1.done?.usage?.model,
    provider: t1.done?.usage?.provider,
  });

  console.log("turn2 starting…");
  const t2 = await postChat({
    token,
    characterId: CHARACTER_ID,
    chatId,
    message: TURN2,
    personaId: PERSONA_ID,
  });
  const m2 = metrics(t2.provider_raw || t2.final_text);
  saveBoth("turn-2-provider-raw.txt", t2.provider_raw);
  saveBoth("turn-2-final.txt", t2.final_text);
  saveBoth("turn-2-events.json", t2.events);
  saveBoth("turn-2-metrics.json", {
    ...m2,
    api: {
      http_status: t2.http_status,
      latency_s: t2.latency_s,
      chatId: t2.turn_persisted?.chatId ?? chatId,
      messageId: t2.turn_persisted?.messageId ?? t2.done?.messageId,
      userMessageId: t2.turn_persisted?.userMessageId ?? t2.done?.userMessageId,
      finish_reason: t2.done?.usage?.finishReason ?? t2.done?.finishReason,
      input_tokens: t2.done?.usage?.input ?? t2.done?.usage?.apiInputTokens,
      output_tokens: t2.done?.usage?.output ?? t2.done?.usage?.apiOutputTokens,
      reasoning_tokens:
        t2.done?.usage?.reasoningTokens ??
        t2.done?.usage?.apiReasoningOutputTokens ??
        0,
      lengthRecoveryPasses: t2.done?.usage?.lengthRecoveryPasses ?? 0,
      model: t2.done?.usage?.model,
      provider: t2.done?.usage?.provider,
      statuses: t2.statuses,
      error: t2.error,
    },
    user_input: TURN2,
  });
  saveBoth(
    "turn-2-request-redacted.json",
    redactRequestMeta({
      path: "/api/chat",
      method: "POST",
      body: {
        characterId: CHARACTER_ID,
        chatId,
        message: TURN2,
        selectedPersonaId: PERSONA_ID,
        selectedAI: "gpt-5.6-terra",
        isAdultMode: false,
      },
      observed_response_meta: {
        chatId,
        model: t2.done?.usage?.model,
        provider: t2.done?.usage?.provider,
        finishReason: t2.done?.usage?.finishReason,
        input_tokens: t2.done?.usage?.input,
        output_tokens: t2.done?.usage?.output,
        reasoning_tokens:
          t2.done?.usage?.reasoningTokens ??
          t2.done?.usage?.apiReasoningOutputTokens ??
          0,
        lengthRecoveryPasses: t2.done?.usage?.lengthRecoveryPasses ?? 0,
        statuses: t2.statuses,
      },
      provider_request_payload:
        "NOT_CAPTURED_ON_PRODUCTION — PROMPT_DEBUG unset; see reconstructed payload from same SHA",
    })
  );

  const msgs2 = await api(`/api/chat/messages?chatId=${chatId}&turnLimit=20`, {
    token,
    method: "GET",
  });
  saveBoth("turn-2-saved-messages.json", {
    status: msgs2.status,
    messages: (msgs2.json?.messages || msgs2.json || []).map((m: any) => ({
      id: m.id,
      role: m.role,
      model: m.model,
      content: m.content,
      createdAt: m.createdAt ?? m.created_at,
    })),
  });

  // Scrape chat page for greeting / embedded character fields (public SSR)
  const chatPage = await fetch(`${BASE}/chat/${CHARACTER_ID}?chat=${chatId}`, {
    headers: { Cookie: cookieHeader(token), "User-Agent": "Mozilla/5.0" },
  });
  const chatHtml = await chatPage.text();
  saveBoth("chat-page-meta.json", {
    status: chatPage.status,
    html_len: chatHtml.length,
    has_like: chatHtml.includes("라이크"),
    has_ren: chatHtml.includes("렌"),
  });
  writeFileSync(join(OUT, "chat-page.html"), chatHtml, "utf8");
  copyFileSync(join(OUT, "chat-page.html"), join(ART, "chat-page.html"));

  saveBoth("summary.json", {
    production_sha: health.json?.gitCommit,
    characterId: CHARACTER_ID,
    personaId: PERSONA_ID,
    chatId,
    turn1: {
      canonical_len: m1.canonical_len,
      dialogue_blocks: m1.dialogue_block_count,
      narration_char_ratio_pct: m1.narration_char_ratio_pct,
      model: t1.done?.usage?.model,
      provider: t1.done?.usage?.provider,
      reasoning_tokens:
        t1.done?.usage?.reasoningTokens ??
        t1.done?.usage?.apiReasoningOutputTokens ??
        0,
      lengthRecoveryPasses: t1.done?.usage?.lengthRecoveryPasses ?? 0,
      latency_s: t1.latency_s,
    },
    turn2: {
      canonical_len: m2.canonical_len,
      dialogue_blocks: m2.dialogue_block_count,
      narration_char_ratio_pct: m2.narration_char_ratio_pct,
      model: t2.done?.usage?.model,
      provider: t2.done?.usage?.provider,
      reasoning_tokens:
        t2.done?.usage?.reasoningTokens ??
        t2.done?.usage?.apiReasoningOutputTokens ??
        0,
      lengthRecoveryPasses: t2.done?.usage?.lengthRecoveryPasses ?? 0,
      latency_s: t2.latency_s,
    },
    avg_canonical: (m1.canonical_len + m2.canonical_len) / 2,
  });

  console.log("turn2 done", {
    len: m2.canonical_len,
    dialogues: m2.dialogue_block_count,
    avg: (m1.canonical_len + m2.canonical_len) / 2,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
