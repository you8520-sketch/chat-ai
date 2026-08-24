#!/usr/bin/env node
/**
 * Promote captured B2 (actual qualifying handoff) to fixture B, then run C
 * on the same chat. Evidence-only. No production changes.
 */
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const AUDIT = join(ROOT, "docs/audits/gemini31-deepseek-refusal-handoff-p1");
const CAP = process.env.CI_CAPTURE_DIR || join(ROOT, "debug/ci-capture");
const BASE = process.env.SMOKE_BASE ?? "http://localhost:3000";
const EMAIL = process.env.SMOKE_EMAIL ?? "gemini31.handoff.p1@example.com";
const PASSWORD = process.env.SMOKE_PASSWORD ?? "handoff-p1-26";
const MODEL = "gemini-3.1-pro-preview";
const DEEPSEEK = "deepseek-v4-pro-0813";

const turns = JSON.parse(readFileSync(join(AUDIT, "fixtures/user-turns.json"), "utf8"));

function sha256(text) {
  return createHash("sha256").update(text ?? "", "utf8").digest("hex");
}
function save(rel, content) {
  const dest = join(AUDIT, rel);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(
    dest,
    typeof content === "string" ? content : JSON.stringify(content, null, 2),
    "utf8"
  );
}
function cookieFromSetCookie(header) {
  const m = /(?:^|,)\s*session=([^;]+)/i.exec(header || "");
  if (!m?.[1]) throw new Error("session cookie missing");
  return m[1];
}
function isGemini(model) {
  return /gemini-3\.1-pro-preview/i.test(model || "");
}
function isDeepSeekPro(model) {
  return /deepseek-v4-pro-0813/i.test(model || "");
}
function loadCap(id) {
  const meta = JSON.parse(readFileSync(join(CAP, `${id}-meta.json`), "utf8"));
  return {
    id,
    meta,
    request: existsSync(join(CAP, `${id}-request.json`))
      ? readFileSync(join(CAP, `${id}-request.json`), "utf8")
      : "",
    response: existsSync(join(CAP, `${id}-response.txt`))
      ? readFileSync(join(CAP, `${id}-response.txt`), "utf8")
      : "",
    extracted: existsSync(join(CAP, `${id}-extracted.txt`))
      ? readFileSync(join(CAP, `${id}-extracted.txt`), "utf8")
      : "",
    reasoning: existsSync(join(CAP, `${id}-reasoning.txt`))
      ? readFileSync(join(CAP, `${id}-reasoning.txt`), "utf8")
      : "",
  };
}
function paragraphs(text) {
  return String(text || "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
}
function isDialogueParagraph(p) {
  return /["“”「」『』]/.test(p);
}
function maxConsecutiveDialogue(paras) {
  let max = 0;
  let cur = 0;
  for (const p of paras) {
    if (isDialogueParagraph(p)) {
      cur += 1;
      max = Math.max(max, cur);
    } else cur = 0;
  }
  return max;
}
function alarmCandidates(text, finishReason) {
  const alarms = [];
  if (!String(text || "").trim()) alarms.push("EMPTY_OUTPUT");
  if (/content[_ -]?filter|length|max_tokens|truncated/i.test(String(finishReason || ""))) {
    alarms.push("TRUNCATION");
  }
  if (/(?:SYSTEM|SceneMode|routeTrigger|INTERNAL)/i.test(text)) alarms.push("META_LEAK");
  if (/(?:렌이\s*(?:말했|대답했|속삭였)|렌의\s*입에서)/.test(text)) {
    alarms.push("NEW_USER_DIALOGUE_CANDIDATE");
  }
  if (/(?:렌이\s*(?:일어섰|달려|문을\s*열|옷을\s*벗었))/.test(text)) {
    alarms.push("NEW_USER_ACTION_CANDIDATE");
  }
  if (/(?:미성년|고등학생|17살|18살 미만)/.test(text)) {
    alarms.push("CANON_CONTRADICTION_CANDIDATE");
  }
  const paras = paragraphs(text);
  const uniq = new Set(paras.map((p) => p.slice(0, 80)));
  if (paras.length >= 6 && uniq.size <= Math.ceil(paras.length * 0.5)) {
    alarms.push("REPETITION_CANDIDATE");
  }
  return [...new Set(alarms)];
}
function layoutContinuity(label, userRaw, gemini, deepseek) {
  save(
    `raw/${label}-CONTINUITY.txt`,
    [
      `# ${label} — Gemini context then DeepSeek continuation`,
      "",
      "## USER RAW",
      "",
      userRaw,
      "",
      "## Gemini input (provider request body)",
      "",
      gemini ? gemini.request : "(no Gemini request captured)",
      "",
      "## Gemini RAW",
      "",
      gemini ? gemini.extracted || gemini.response : "(no Gemini RAW captured)",
      "",
      "## Handoff input (DeepSeek request body)",
      "",
      deepseek ? deepseek.request : "(no DeepSeek handoff input)",
      "",
      "## DeepSeek RAW",
      "",
      deepseek ? deepseek.extracted || deepseek.response : "(no DeepSeek RAW)",
      "",
    ].join("\n")
  );
}

function writeProviderFiles(label, gemini, deepseek) {
  if (gemini) {
    save(`requests/${label}-GEMINI-input.json`, gemini.request);
    save(`raw/${label}-GEMINI-RAW.txt`, gemini.extracted || gemini.response);
    save(`raw/${label}-GEMINI-WIRE.txt`, gemini.response);
    if (gemini.reasoning) save(`raw/${label}-GEMINI-REASONING.txt`, gemini.reasoning);
    save(`meta/${label}-GEMINI-provider.json`, gemini.meta);
  }
  if (deepseek) {
    save(`requests/${label}-DEEPSEEK-input.json`, deepseek.request);
    save(`raw/${label}-DEEPSEEK-RAW.txt`, deepseek.extracted || deepseek.response);
    save(`raw/${label}-DEEPSEEK-WIRE.txt`, deepseek.response);
    save(`meta/${label}-DEEPSEEK-provider.json`, deepseek.meta);
  }
}

function promoteB2() {
  const userRaw = turns.fixtureB.candidates.find((c) => c.id === "B2").userRaw;
  const gemini = loadCap("015");
  const deepseek = loadCap("016");
  const prior = JSON.parse(readFileSync(join(AUDIT, "meta/B-B2.json"), "utf8"));
  const visible = deepseek.extracted;
  const paras = paragraphs(visible);
  const dialogueParas = paras.filter(isDialogueParagraph);
  save("raw/B-USER_RAW.txt", userRaw);
  save("raw/B-VISIBLE.txt", visible);
  writeProviderFiles("B", gemini, deepseek);
  layoutContinuity("B", userRaw, gemini, deepseek);
  const meta = {
    fixture: "B",
    qualifying_candidate: "B2",
    note: "usage.model stays gemini-3.1-pro-preview on the production receipt after silent replacement. Visible text and provider RAW are DeepSeek V4 Pro 0813.",
    primary_model: MODEL,
    delivered_visible_model: DEEPSEEK,
    receipt_model: prior.delivered_model,
    provider: "cheaperinference",
    visible_chars: visible.length,
    paragraph_count: paras.length,
    dialogue_paragraph_count: dialogueParas.length,
    dialogue_paragraph_ratio:
      paras.length === 0 ? 0 : Number((dialogueParas.length / paras.length).toFixed(3)),
    max_consecutive_dialogue: maxConsecutiveDialogue(paras),
    gemini: {
      input_tokens: gemini.meta.usage?.prompt_tokens ?? null,
      output_tokens: gemini.meta.usage?.completion_tokens ?? null,
      reasoning_tokens: gemini.meta.usage?.thinking_tokens ?? null,
      ttft_ms: gemini.meta.ttftMs,
      latency_ms: gemini.meta.latencyMs,
      finish_reason: gemini.meta.finishReason,
      request_sha: gemini.meta.requestSha,
      raw_sha: gemini.meta.rawSha,
      visible_chars: gemini.meta.visibleChars,
    },
    deepseek: {
      input_tokens: deepseek.meta.usage?.prompt_tokens ?? null,
      output_tokens: deepseek.meta.usage?.completion_tokens ?? null,
      reasoning_tokens: deepseek.meta.usage?.thinking_tokens ?? null,
      ttft_ms: deepseek.meta.ttftMs,
      latency_ms: deepseek.meta.latencyMs,
      finish_reason: deepseek.meta.finishReason,
      request_sha: deepseek.meta.requestSha,
      raw_sha: deepseek.meta.rawSha,
      visible_chars: deepseek.meta.visibleChars,
    },
    input_tokens: deepseek.meta.usage?.prompt_tokens ?? prior.input_tokens,
    output_tokens: deepseek.meta.usage?.completion_tokens ?? prior.output_tokens,
    reasoning_tokens: gemini.meta.usage?.thinking_tokens ?? null,
    ttft_ms: gemini.meta.ttftMs,
    latency_ms: prior.latency_ms,
    finish_reason: deepseek.meta.finishReason,
    request_sha: gemini.meta.requestSha,
    raw_sha: deepseek.meta.rawSha,
    provider_call_count: 2,
    gemini_call_count: 1,
    deepseek_call_count: 1,
    handoff_count: 1,
    provider_models: [MODEL, DEEPSEEK],
    chat_id: prior.chat_id,
    http_status: prior.http_status,
    usage: prior.usage,
    alarm_candidates: alarmCandidates(visible, deepseek.meta.finishReason),
    capture_ids: ["015", "016"],
    background_flash_excluded: ["012", "013", "014", "017"],
  };
  save("meta/B.json", meta);
  return meta;
}

function snapshotIds() {
  if (!existsSync(CAP)) return new Set();
  return new Set(
    readdirSync(CAP)
      .filter((f) => f.endsWith("-meta.json"))
      .map((f) => f.replace(/-meta.json$/, ""))
  );
}

function newCaps(before) {
  return readdirSync(CAP)
    .filter((f) => f.endsWith("-meta.json"))
    .map((f) => f.replace(/-meta.json$/, ""))
    .filter((id) => !before.has(id))
    .sort()
    .map(loadCap)
    .filter((c) => isGemini(c.meta.model) || isDeepSeekPro(c.meta.model));
}

async function runC(chatId) {
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!login.ok) throw new Error(`login ${login.status} ${await login.text()}`);
  const token = cookieFromSetCookie(login.headers.get("set-cookie"));
  const me = await fetch(`${BASE}/api/auth/me`, { headers: { Cookie: `session=${token}` } });
  const meJson = await me.json();
  const personaList = await fetch(`${BASE}/api/personas`, {
    headers: { Cookie: `session=${token}` },
  });
  const personas = (await personaList.json()).personas ?? [];
  const personaId = personas.find((p) => p.name === "렌")?.id;
  if (!personaId) throw new Error("persona 렌 missing");

  const before = snapshotIds();
  const started = Date.now();
  const userRaw = turns.fixtureC.userRaw;
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `session=${token}`,
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      characterId: 18,
      chatId,
      message: userRaw,
      selectedPersonaId: personaId,
      selectedAI: MODEL,
      isAdultMode: true,
      isNsfwMode: true,
      adultHandoffEnabled: true,
      clientRequestId: `g31_ds_p1_C_${Date.now().toString(36)}`,
    }),
  });
  if (!res.ok) throw new Error(`C http ${res.status} ${await res.text()}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let finalText = "";
  let done = null;
  while (true) {
    const { done: eof, value } = await reader.read();
    if (eof) break;
    buf += dec.decode(value, { stream: true });
    const chunks = buf.split("\n\n");
    buf = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const line = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      try {
        const obj = JSON.parse(line.slice(6));
        if (obj.type === "delta" && typeof obj.text === "string") finalText += obj.text;
        if (obj.type === "replace" && typeof obj.text === "string") finalText = obj.text;
        if (obj.type === "done") {
          done = obj;
          if (typeof obj.finalContent === "string" && obj.finalContent.trim()) {
            finalText = obj.finalContent;
          }
        }
      } catch {
        /* ignore */
      }
    }
  }
  await new Promise((r) => setTimeout(r, 800));
  const caps = newCaps(before);
  const gemini = caps.find((c) => isGemini(c.meta.model));
  const deepseek = caps.find((c) => isDeepSeekPro(c.meta.model));
  const usage = done?.usage ?? {};
  const visible = finalText || "";
  const paras = paragraphs(visible);
  const dialogueParas = paras.filter(isDialogueParagraph);
  save("raw/C-USER_RAW.txt", userRaw);
  save("raw/C-VISIBLE.txt", visible);
  writeProviderFiles("C", gemini, deepseek);
  layoutContinuity("C", userRaw, gemini, deepseek);
  if (existsSync(join(ROOT, "debug/prompt_dump.txt"))) {
    copyFileSync(join(ROOT, "debug/prompt_dump.txt"), join(AUDIT, "requests/C-prompt_dump.txt"));
  }
  const meta = {
    fixture: "C",
    primary_model: usage.selectedAI ?? usage.model ?? MODEL,
    delivered_visible_model: deepseek ? DEEPSEEK : MODEL,
    receipt_model: usage.model ?? null,
    provider: usage.provider ?? null,
    visible_chars: visible.length,
    paragraph_count: paras.length,
    dialogue_paragraph_count: dialogueParas.length,
    dialogue_paragraph_ratio:
      paras.length === 0 ? 0 : Number((dialogueParas.length / paras.length).toFixed(3)),
    max_consecutive_dialogue: maxConsecutiveDialogue(paras),
    input_tokens: usage.apiInputTokens ?? usage.input ?? gemini?.meta.usage?.prompt_tokens ?? null,
    output_tokens: usage.apiOutputTokens ?? usage.output ?? gemini?.meta.usage?.completion_tokens ?? null,
    reasoning_tokens:
      usage.apiReasoningOutputTokens ?? gemini?.meta.usage?.thinking_tokens ?? null,
    ttft_ms: gemini?.meta.ttftMs ?? null,
    latency_ms: Date.now() - started,
    finish_reason: done?.finishReason ?? usage.finishReason ?? gemini?.meta.finishReason ?? null,
    request_sha: gemini?.meta.requestSha ?? null,
    raw_sha: (deepseek ?? gemini)?.meta.rawSha ?? sha256(visible),
    provider_call_count: caps.length,
    gemini_call_count: caps.filter((c) => isGemini(c.meta.model)).length,
    deepseek_call_count: caps.filter((c) => isDeepSeekPro(c.meta.model)).length,
    handoff_count: caps.filter((c) => isDeepSeekPro(c.meta.model)).length,
    provider_models: caps.map((c) => c.meta.model),
    chat_id: chatId,
    http_status: res.status,
    usage,
    alarm_candidates: alarmCandidates(visible, done?.finishReason ?? usage.finishReason),
    capture_ids: caps.map((c) => c.id),
    user_id: meJson.id ?? meJson.user?.id,
    persona_id: personaId,
  };
  save("meta/C.json", meta);
  return { meta, gemini, deepseek };
}

const b = promoteB2();
const c = await runC(b.chat_id);
const a = JSON.parse(readFileSync(join(AUDIT, "meta/A.json"), "utf8"));
const index = {
  phase: "gemini31-deepseek-refusal-handoff-p1",
  production_code_changed: false,
  prompt_changed: false,
  fixture_b_candidate: "B2",
  chats: { A: a.chat_id, B: b.chat_id, C: c.meta.chat_id },
  provider_call_counts: {
    A: a.gemini_call_count,
    B: b.provider_call_count,
    C: c.meta.provider_call_count,
  },
  gemini_call_counts: {
    A: a.gemini_call_count,
    B: b.gemini_call_count,
    C: c.meta.gemini_call_count,
  },
  deepseek_pro_0813_call_counts: {
    A: a.deepseek_call_count,
    B: b.deepseek_call_count,
    C: c.meta.deepseek_call_count,
  },
  handoff_counts: {
    A: a.handoff_count,
    B: b.handoff_count,
    C: c.meta.handoff_count,
  },
  raw_paths: {
    A: [
      "docs/audits/gemini31-deepseek-refusal-handoff-p1/raw/A-USER_RAW.txt",
      "docs/audits/gemini31-deepseek-refusal-handoff-p1/raw/A-GEMINI-RAW.txt",
      "docs/audits/gemini31-deepseek-refusal-handoff-p1/raw/A-VISIBLE.txt",
      "docs/audits/gemini31-deepseek-refusal-handoff-p1/raw/A-CONTINUITY.txt",
    ],
    B: [
      "docs/audits/gemini31-deepseek-refusal-handoff-p1/raw/B-USER_RAW.txt",
      "docs/audits/gemini31-deepseek-refusal-handoff-p1/raw/B-GEMINI-RAW.txt",
      "docs/audits/gemini31-deepseek-refusal-handoff-p1/raw/B-DEEPSEEK-RAW.txt",
      "docs/audits/gemini31-deepseek-refusal-handoff-p1/raw/B-VISIBLE.txt",
      "docs/audits/gemini31-deepseek-refusal-handoff-p1/raw/B-CONTINUITY.txt",
    ],
    C: [
      "docs/audits/gemini31-deepseek-refusal-handoff-p1/raw/C-USER_RAW.txt",
      "docs/audits/gemini31-deepseek-refusal-handoff-p1/raw/C-GEMINI-RAW.txt",
      "docs/audits/gemini31-deepseek-refusal-handoff-p1/raw/C-VISIBLE.txt",
      "docs/audits/gemini31-deepseek-refusal-handoff-p1/raw/C-CONTINUITY.txt",
    ],
  },
  metadata_paths: {
    A: "docs/audits/gemini31-deepseek-refusal-handoff-p1/meta/A.json",
    B: "docs/audits/gemini31-deepseek-refusal-handoff-p1/meta/B.json",
    C: "docs/audits/gemini31-deepseek-refusal-handoff-p1/meta/C.json",
    setup: "docs/audits/gemini31-deepseek-refusal-handoff-p1/meta/SETUP.json",
    index: "docs/audits/gemini31-deepseek-refusal-handoff-p1/INDEX.json",
  },
};
save("INDEX.json", index);
console.log(JSON.stringify(index, null, 2));
