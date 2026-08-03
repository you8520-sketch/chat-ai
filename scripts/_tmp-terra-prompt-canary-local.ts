/**
 * Local Terra prompt canary harness — Like × Ren Turn1→Turn2.
 * Does not store cookies/API keys in artifacts.
 *
 * Env:
 *   BASE (default http://localhost:3000)
 *   VARIANT label for output folder
 *   CHARACTER_ID (default 11)
 *   PERSONA_ID (optional; creates 렌 persona if missing)
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT =
  process.env.OUT_DIR ??
  join("output", "terra-prompt-canary", process.env.VARIANT ?? "run");
const ART =
  process.env.ART_DIR ??
  join("/opt/cursor/artifacts/terra-prompt-canary", process.env.VARIANT ?? "run");
const CHARACTER_ID = Number(process.env.CHARACTER_ID ?? 11);
const COOKIE_FILE = process.env.COOKIE_FILE ?? "/tmp/terra_canary_local_cookies.txt";

const TURN1 =
  "나는 렌이라고 부르면 돼....나는 본기억이 안나는데....나 알아?(갸웃)";
const TURN2 =
  "같이갈래?*두리번 거리면서 다가오는 사람들을 보다가 다시 라이크를 쳐다본다*";

function ensureDirs() {
  mkdirSync(OUT, { recursive: true });
  mkdirSync(ART, { recursive: true });
}

function cookieFromNetscape(file: string): string {
  const raw = readFileSync(file, "utf8");
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const normalized = line.startsWith("#HttpOnly_")
      ? line.slice("#HttpOnly_".length)
      : line.startsWith("#")
        ? ""
        : line;
    if (!normalized) continue;
    const parts = normalized.split("\t");
    if (parts.length >= 7 && parts[5] === "session") return parts[6]!.trim();
  }
  throw new Error(`session cookie not found in ${file}`);
}

async function login(): Promise<{ token: string; userId: number }> {
  if (existsSync(COOKIE_FILE)) {
    try {
      const token = cookieFromNetscape(COOKIE_FILE);
      const me = await fetch(`${BASE}/api/auth/me`, {
        headers: { Cookie: `session=${token}` },
      });
      if (me.ok) {
        const j = (await me.json()) as { id?: number; user?: { id?: number } | null };
        const userId = j.user?.id ?? j.id;
        if (userId) return { token, userId };
      }
    } catch {
      /* fall through */
    }
  }

  const email = `terra.canary.${Date.now()}@example.com`;
  const password = "canary1234";
  const nickname = `canary_${Date.now().toString(36).slice(-6)}`;
  const signup = await fetch(`${BASE}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, nickname, password, pref: "male" }),
  });
  const setCookie = signup.headers.getSetCookie?.() ?? [];
  let token = "";
  for (const c of setCookie) {
    const m = /^session=([^;]+)/.exec(c);
    if (m) token = m[1]!;
  }
  if (!token) {
    // node fetch may expose getSetCookie; fallback
    const raw = signup.headers.get("set-cookie") ?? "";
    const m = /session=([^;]+)/.exec(raw);
    token = m?.[1] ?? "";
  }
  if (!signup.ok || !token) {
    throw new Error(`signup failed ${signup.status} ${await signup.text()}`);
  }
  // Write netscape cookie for reuse
  writeFileSync(
    COOKIE_FILE,
    [
      "# Netscape HTTP Cookie File",
      `localhost\tFALSE\t/\tFALSE\t0\tsession\t${token}`,
      "",
    ].join("\n"),
    "utf8"
  );
  const me = await fetch(`${BASE}/api/auth/me`, {
    headers: { Cookie: `session=${token}` },
  });
  const j = (await me.json()) as { id?: number; user?: { id?: number } | null };
  const userId = j.user?.id ?? j.id;
  if (!userId) throw new Error("could not resolve user id after signup");
  return { token, userId };
}

async function ensurePersona(token: string): Promise<number> {
  if (process.env.PERSONA_ID) return Number(process.env.PERSONA_ID);
  const list = await fetch(`${BASE}/api/personas`, {
    headers: { Cookie: `session=${token}` },
  });
  const listJson = list.ok ? await list.json() : null;
  const personas = Array.isArray(listJson)
    ? (listJson as Array<{ id: number; name: string }>)
    : Array.isArray((listJson as { personas?: unknown })?.personas)
      ? ((listJson as { personas: Array<{ id: number; name: string }> }).personas)
      : [];
  const existing = personas.find((p) => p.name === "렌");
  if (existing) return existing.id;

  const created = await fetch(`${BASE}/api/personas`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `session=${token}`,
    },
    body: JSON.stringify({
      name: "렌",
      memo: "렌",
      gender: "other",
      description:
        "신규 S급 가이드. 본기억이 흐릿하다. 호기심이 많고 낯선 환경에서도 곧장 다가간다.",
    }),
  });
  if (!created.ok) {
    if (personas[0]) return personas[0].id;
    throw new Error(`persona create failed ${created.status} ${await created.text()}`);
  }
  const j = (await created.json()) as { id?: number; persona?: { id?: number } };
  const id = j.id ?? j.persona?.id;
  if (!id) throw new Error("persona id missing");
  return id;
}

async function selectTerra(token: string) {
  const res = await fetch(`${BASE}/api/user/selected-ai`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: `session=${token}`,
    },
    body: JSON.stringify({ selectedAI: "gpt-5.6-terra" }),
  });
  if (!res.ok) {
    throw new Error(`selected-ai PATCH failed ${res.status} ${await res.text()}`);
  }
  const j = (await res.json()) as { selectedAI?: string };
  if (j.selectedAI !== "gpt-5.6-terra") {
    throw new Error(`selected-ai mismatch: ${j.selectedAI}`);
  }
}

type StreamCapture = {
  http_status: number;
  latency_s: number;
  events: any[];
  final_text: string;
  done: any;
  error: string | null;
  chatId: number | null;
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
    clientRequestId: `canary_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 8)}`,
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

  const events: any[] = [];
  let final_text = "";
  let done: any = null;
  let error: string | null = null;
  let chatId: number | null = opts.chatId ?? null;

  if (!res.ok || !res.body) {
    return {
      http_status: res.status,
      latency_s: (Date.now() - started) / 1000,
      events,
      final_text: "",
      done: null,
      error: await res.text(),
      chatId,
    };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done: eof, value } = await reader.read();
    if (eof) break;
    buf += decoder.decode(value, { stream: true });
    const chunks = buf.split("\n\n");
    buf = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const line = chunk
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .join("");
      if (!line || line === "[DONE]") continue;
      try {
        const ev = JSON.parse(line);
        events.push(ev);
        if (ev.type === "done") {
          done = ev;
          final_text = ev.finalContent ?? final_text;
          chatId = ev.chatId ?? chatId;
        }
        if (ev.type === "token" && typeof ev.text === "string") {
          /* stream */
        }
        if (ev.type === "error") error = ev.error ?? JSON.stringify(ev);
        if (typeof ev.content === "string" && ev.type === "final") {
          final_text = ev.content;
        }
      } catch {
        /* ignore partial */
      }
    }
  }
  if (!final_text && done?.finalContent) final_text = done.finalContent;

  return {
    http_status: res.status,
    latency_s: (Date.now() - started) / 1000,
    events,
    final_text,
    done,
    error,
    chatId,
  };
}

function dialogueBlocks(text: string): string[] {
  const blocks: string[] = [];
  const re = /[“"]([^”"]+)[”"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) blocks.push(m[1]!);
  return blocks;
}

function analyze(text: string) {
  const blocks = dialogueBlocks(text);
  const dialogueChars = blocks.join("").length;
  const canonical = text.replace(/\s+/g, " ").trim().length;
  const staffHits = (
    text.match(/지원국|등록|접수|검사|담당자|데스크 직원|의료진/g) ?? []
  ).length;
  const externalSpeakerHints = (
    text.match(/직원이|기사가|동료가|담당자가|운반/g) ?? []
  ).length;
  return {
    canonical_len: text.length,
    canonical_compact: canonical,
    dialogue_blocks: blocks.length,
    dialogue_chars: dialogueChars,
    narration_char_ratio_pct:
      text.length > 0
        ? Math.round(((text.length - dialogueChars) / text.length) * 1000) / 10
        : 0,
    staff_admin_hits: staffHits,
    external_speaker_hints: externalSpeakerHints,
    ending: text.trim().slice(-180),
    sha12: createHash("sha256").update(text).digest("hex").slice(0, 12),
  };
}

async function main() {
  ensureDirs();
  const { token, userId } = await login();
  console.log(JSON.stringify({ phase: "login", userId, base: BASE }));
  await selectTerra(token);
  const personaId = await ensurePersona(token);
  console.log(JSON.stringify({ phase: "persona", personaId }));

  const t1 = await postChat({
    token,
    characterId: CHARACTER_ID,
    message: TURN1,
    personaId,
  });
  writeFileSync(join(OUT, "turn1.json"), JSON.stringify(t1, null, 2));
  writeFileSync(join(OUT, "turn1.txt"), t1.final_text);
  const a1 = analyze(t1.final_text);
  console.log(JSON.stringify({ phase: "turn1", ...a1, error: t1.error, chatId: t1.chatId }));

  if (!t1.chatId || t1.error || !t1.final_text) {
    throw new Error(`turn1 failed: ${t1.error ?? "empty"}`);
  }

  const t2 = await postChat({
    token,
    characterId: CHARACTER_ID,
    chatId: t1.chatId,
    message: TURN2,
    personaId,
  });
  writeFileSync(join(OUT, "turn2.json"), JSON.stringify(t2, null, 2));
  writeFileSync(join(OUT, "turn2.txt"), t2.final_text);
  const a2 = analyze(t2.final_text);
  console.log(JSON.stringify({ phase: "turn2", ...a2, error: t2.error, chatId: t2.chatId }));

  const summary = {
    variant: process.env.VARIANT ?? null,
    userId,
    characterId: CHARACTER_ID,
    personaId,
    chatId: t1.chatId,
    turn1: { ...a1, latency_s: t1.latency_s, usage: t1.done?.usage ?? null },
    turn2: { ...a2, latency_s: t2.latency_s, usage: t2.done?.usage ?? null },
    avg_canonical: (a1.canonical_len + a2.canonical_len) / 2,
  };
  writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 2));
  writeFileSync(join(ART, "summary.json"), JSON.stringify(summary, null, 2));
  writeFileSync(join(ART, "turn1.txt"), t1.final_text);
  writeFileSync(join(ART, "turn2.txt"), t2.final_text);
  console.log(JSON.stringify({ phase: "done", summary }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
