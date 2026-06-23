import fs from "fs";
import path from "path";
import { estimateTokens } from "@/lib/tokenEstimate";
import type { OpenRouterChatMessage } from "@/lib/openRouterClient";

/** debug/prompt_dump.txt — real chat API vs mock fixture vs dev/audit script */
export type PromptDumpSource = "db" | "mock" | "audit";

const PROMPT_DUMP_SOURCE_ENV = "PROMPT_DUMP_SOURCE";
const PROMPT_DUMP_DETAIL_ENV = "PROMPT_DUMP_DETAIL";

function parsePromptDumpSource(raw: string | undefined): PromptDumpSource | undefined {
  if (raw === "db" || raw === "mock" || raw === "audit") return raw;
  return undefined;
}

export function formatPromptDumpSourceLine(
  source: PromptDumpSource,
  detail?: string | null
): string {
  const trimmed = detail?.trim();
  return trimmed ? `source=${source} · ${trimmed}` : `source=${source}`;
}

/** Resolve dump origin for buildContext → writePromptBuildDump */
export function resolvePromptDumpSource(opts: {
  explicit?: PromptDumpSource | null | undefined;
  detail?: string | null | undefined;
}): { source: PromptDumpSource; detail?: string } {
  const source =
    parsePromptDumpSource(opts.explicit ?? undefined) ??
    parsePromptDumpSource(process.env[PROMPT_DUMP_SOURCE_ENV]) ??
    "audit";

  const detail =
    opts.detail?.trim() || process.env[PROMPT_DUMP_DETAIL_ENV]?.trim() || undefined;
  return { source, detail };
}

export type PromptDebugMeta = {
  stage?: string;
  requestKind?: string;
  /** debug/prompt_dump.txt source stamp (API-path dumps) */
  promptDumpSource?: PromptDumpSource;
  promptDumpDetail?: string;
  /** System text before systemSuffix merge (Gemini tail injection) */
  baseSystem?: string;
  systemSuffix?: string;
  chatId?: number;
  /** explicit cache — non-cached contents tail (visual anchor) */
  promptTail?: string;
  /** 2턴째+ — CachedContent await 후 부착 */
  awaitExplicitCache?: boolean;
  /** 폴백·백그라운드 — explicit cache 생성/부착 금지 (raw prompt only) */
  skipExplicitCache?: boolean;
  /** Static CachedContent — real context payload + fingerprint */
  staticOpts?: { staticPrompt: string; staticFingerprint: string };
  /** 유저 1턴 API fetch 킬스위치 (초기 1 + 재호출 2) */
  turnApiBudget?: import("@/lib/turnApiBudget").TurnApiBudget;
  /** 유저 1턴 Gemini HTTP 호출 추적 (과금 진단) */
  turnTrace?: import("@/lib/geminiRequestTrace").GeminiTurnTrace;
  /** truncation-recovery 등 — tier max 대신 소량 토큰만 */
  maxOutputTokensOverride?: number;
  /** false — 부모 recovery가 이미 beforeFetch 한 경우 내부 HTTP 호출 예산 중복 차감 방지 */
  chargeTurnBudget?: boolean;
};

export type PromptDebugSection = {
  id: string;
  label: string;
  role: "system" | "user" | "assistant" | "model";
  text: string;
  chars: number;
  tokens: number;
  hidden: boolean;
  hiddenReason?: string;
};

export type PromptDebugDuplicate = {
  label: string;
  sectionIds: string[];
  sharedSnippet: string;
  wastedTokens: number;
};

export type PromptDebugPayload = {
  timestamp: string;
  provider: "gemini" | "openrouter";
  model: string;
  promptDumpSource?: PromptDumpSource;
  promptDumpDetail?: string;
  stage?: string;
  requestKind?: string;
  chatId?: number;
  sections: PromptDebugSection[];
  totalChars: number;
  totalTokens: number;
  duplicates: PromptDebugDuplicate[];
  hiddenInjections: { id: string; reason: string; text: string; tokens: number }[];
  /** Exact JSON body sent to the provider API */
  apiRequestBody: Record<string, unknown>;
};

const DEBUG_DIR = path.join(process.cwd(), "debug");

const HIDDEN_BLOCK_PATTERNS: { reason: string; patterns: RegExp[] }[] = [
  { reason: "Speech Lock injection", patterns: [/Speech Lock/i, /말투 잠금/i, /SPEECH.*ENFORCEMENT/i] },
  { reason: "Response length injection", patterns: [/\[LENGTH CONTROL(?: & SCENE EXPANSION)?\]/i, /\[LENGTH MODE:/i, /\[TARGET LENGTH\]/i] },
  { reason: "Gender enforcement reminder", patterns: [/GENDER.*ENFORCEMENT/i, /성별.*최종 확인/i] },
  { reason: "OpenRouter Korean overlay", patterns: [/CRITICAL LANGUAGE REQUIREMENT/i, /KOREAN NOVEL FORMAT/i] },
  { reason: "OpenRouter final reminder", patterns: [/FINAL REMINDER/i, /ABSOLUTE OUTPUT RULES/i] },
  { reason: "Status window injection", patterns: [/STATUS WINDOW/i, /GRACEFUL CLOSING/i] },
  { reason: "Continuation prompt", patterns: [/이어\s*쓰/i, /continue writing/i, /문장.*마무리/i] },
  { reason: "Speech rewrite prompt", patterns: [/말투 교정/i, /Speech Lock.*rewrite/i, /대사.*위반/i] },
  { reason: "Anti-echo rule", patterns: [/반복·에코 출력 절대 금지/i, /NEVER echo or repeat/i] },
  { reason: "Narrative style preset", patterns: [/\[style_id:/i, /NARRATIVE STYLE/i, /SENSORY IMMERSION/i] },
];

const DUPLICATE_SIGNATURES: { label: string; patterns: RegExp[] }[] = [
  { label: "ANTI_ECHO_SYSTEM_RULE", patterns: [/반복·에코 출력 절대 금지/i, /NEVER echo or repeat/i] },
  { label: "Gender rules", patterns: [/성별.*최종 확인/i, /GENDER.*ENFORCEMENT/i] },
  { label: "Speech Lock", patterns: [/Speech Lock/i, /말투 잠금/i] },
  { label: "Response length", patterns: [/\[LENGTH CONTROL(?: & SCENE EXPANSION)?\]/i, /\[LENGTH MODE:/i, /\[TARGET LENGTH\]/i] },
  { label: "Status window", patterns: [/STATUS WINDOW/i, /GRACEFUL CLOSING/i] },
  { label: "Korean enforcement", patterns: [/CRITICAL LANGUAGE REQUIREMENT/i, /100%.*한국어/i] },
];

let requestSeq = 0;

export function isPromptDebugEnabled(): boolean {
  return process.env.PROMPT_DEBUG === "1" || process.env.DEBUG_PROMPT === "1";
}

function normalizeForCompare(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function findLongSharedSubstring(a: string, b: string, minLen = 80): string | null {
  const na = normalizeForCompare(a);
  const nb = normalizeForCompare(b);
  if (!na || !nb) return null;
  for (let len = Math.min(240, na.length, nb.length); len >= minLen; len -= 10) {
    for (let i = 0; i <= na.length - len; i++) {
      const sub = na.slice(i, i + len);
      if (nb.includes(sub)) return sub.slice(0, 160);
    }
  }
  return null;
}

function detectDuplicates(sections: PromptDebugSection[]): PromptDebugDuplicate[] {
  const hits: PromptDebugDuplicate[] = [];

  for (const sig of DUPLICATE_SIGNATURES) {
    const matched = sections.filter((s) => sig.patterns.some((re) => re.test(s.text)));
    if (matched.length < 2) continue;
    const wasted = Math.max(
      0,
      matched.reduce((n, s) => n + s.tokens, 0) - (matched[0]?.tokens ?? 0)
    );
    hits.push({
      label: sig.label,
      sectionIds: matched.map((m) => m.id),
      sharedSnippet: matched[0]?.text.slice(0, 120).replace(/\s+/g, " ") + "…",
      wastedTokens: wasted,
    });
  }

  for (let i = 0; i < sections.length; i++) {
    for (let j = i + 1; j < sections.length; j++) {
      const shared = findLongSharedSubstring(sections[i].text, sections[j].text);
      if (!shared) continue;
      hits.push({
        label: `Shared content: ${sections[i].label} ↔ ${sections[j].label}`,
        sectionIds: [sections[i].id, sections[j].id],
        sharedSnippet: shared + "…",
        wastedTokens: Math.min(sections[i].tokens, sections[j].tokens),
      });
    }
  }

  return hits.slice(0, 20);
}

function detectHiddenBlocks(
  sections: PromptDebugSection[],
  meta?: PromptDebugMeta
): { id: string; reason: string; text: string; tokens: number }[] {
  const hidden: { id: string; reason: string; text: string; tokens: number }[] = [];

  if (meta?.systemSuffix?.trim()) {
    hidden.push({
      id: "gemini-system-suffix",
      reason: "Gemini systemSuffix tail injection",
      text: meta.systemSuffix,
      tokens: estimateTokens(meta.systemSuffix),
    });
  }

  for (const section of sections) {
    if (section.hidden && section.hiddenReason) {
      hidden.push({
        id: section.id,
        reason: section.hiddenReason,
        text: section.text,
        tokens: section.tokens,
      });
      continue;
    }

    const blocks = section.text.split(/\n\n+/).filter((b) => b.trim().length >= 40);
    blocks.forEach((block, idx) => {
      for (const rule of HIDDEN_BLOCK_PATTERNS) {
        if (!rule.patterns.some((re) => re.test(block))) continue;
        hidden.push({
          id: `${section.id}-block-${idx}`,
          reason: rule.reason,
          text: block.trim(),
          tokens: estimateTokens(block),
        });
        break;
      }
    });
  }

  return hidden;
}

function sectionFromText(
  id: string,
  label: string,
  role: PromptDebugSection["role"],
  text: string,
  hidden = false,
  hiddenReason?: string
): PromptDebugSection {
  return {
    id,
    label,
    role,
    text,
    chars: text.length,
    tokens: estimateTokens(text),
    hidden,
    hiddenReason,
  };
}

function isHiddenUserTurn(text: string): string | null {
  if (/이어\s*쓰|continue writing|분량.*보강|문장.*마무리/i.test(text)) {
    return "Continuation / length-fix user injection";
  }
  if (/말투 교정|Speech Lock|대사.*위반|금지\s*말투/i.test(text)) {
    return "Speech Lock rewrite user injection";
  }
  return null;
}

export function sectionsFromGeminiBody(
  body: Record<string, unknown>,
  meta?: PromptDebugMeta
): PromptDebugSection[] {
  const sections: PromptDebugSection[] = [];
  const sysPart = (body.system_instruction as { parts?: { text?: string }[] })?.parts?.[0]?.text ?? "";
  const baseLen = meta?.baseSystem?.length ?? 0;

  if (meta?.baseSystem && meta.systemSuffix && sysPart.length > baseLen) {
    sections.push(
      sectionFromText("system-base", "system (base)", "system", meta.baseSystem),
      sectionFromText(
        "system-suffix",
        "system (systemSuffix injection)",
        "system",
        meta.systemSuffix,
        true,
        "Gemini systemSuffix appended before API call"
      )
    );
  } else {
    sections.push(sectionFromText("system", "system_instruction", "system", sysPart));
  }

  const contents = (body.contents ?? []) as { role?: string; parts?: { text?: string }[] }[];
  contents.forEach((item, i) => {
    const role = item.role === "model" ? "model" : "user";
    const text = item.parts?.[0]?.text ?? "";
    const hiddenReason = role === "user" ? isHiddenUserTurn(text) : null;
    sections.push(
      sectionFromText(
        `content-${i}-${role}`,
        `contents[${i}] ${role}`,
        role,
        text,
        !!hiddenReason,
        hiddenReason ?? undefined
      )
    );
  });

  return sections;
}

function flattenOpenRouterContent(content: OpenRouterChatMessage["content"]): string {
  if (typeof content === "string") return content;
  return content.map((b) => b.text).join("");
}

export function sectionsFromOpenRouterMessages(messages: OpenRouterChatMessage[]): PromptDebugSection[] {
  const out: PromptDebugSection[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === "system" && Array.isArray(m.content)) {
      m.content.forEach((block, bi) => {
        const cached = block.cache_control?.type === "ephemeral";
        out.push(
          sectionFromText(
            `message-${i}-system-block-${bi}`,
            `messages[${i}] system block ${bi + 1}${cached ? " [cache_control:ephemeral]" : ""}`,
            "system",
            block.text,
            false
          )
        );
      });
      continue;
    }
    const text = flattenOpenRouterContent(m.content);
    const hiddenReason =
      m.role === "user" && i === messages.length - 1 ? isHiddenUserTurn(text) : null;
    out.push(
      sectionFromText(
        `message-${i}-${m.role}`,
        `messages[${i}] ${m.role}`,
        m.role,
        text,
        !!hiddenReason,
        hiddenReason ?? undefined
      )
    );
  }
  return out;
}

function buildPayload(
  provider: "gemini" | "openrouter",
  model: string,
  sections: PromptDebugSection[],
  apiRequestBody: Record<string, unknown>,
  meta?: PromptDebugMeta
): PromptDebugPayload {
  const totalChars = sections.reduce((n, s) => n + s.chars, 0);
  const totalTokens = sections.reduce((n, s) => n + s.tokens, 0);
  const duplicates = detectDuplicates(sections);
  const hiddenInjections = detectHiddenBlocks(sections, meta);

  const promptDumpSource =
    meta?.promptDumpSource ??
    (meta?.chatId != null ? "db" : meta?.requestKind ? "audit" : undefined);

  return {
    timestamp: new Date().toISOString(),
    provider,
    model,
    promptDumpSource,
    promptDumpDetail: meta?.promptDumpDetail,
    stage: meta?.stage,
    requestKind: meta?.requestKind,
    chatId: meta?.chatId,
    sections,
    totalChars,
    totalTokens,
    duplicates,
    hiddenInjections,
    apiRequestBody,
  };
}

function formatPromptDumpTxt(payload: PromptDebugPayload, seq: number): string {
  const apiDumpSource =
    payload.promptDumpSource ??
    (payload.chatId != null ? "db" : payload.requestKind ? "audit" : "audit");
  const apiDumpDetail =
    payload.promptDumpDetail ??
    (payload.chatId != null ? `chat=${payload.chatId}` : payload.requestKind ?? undefined);

  const lines: string[] = [
    "=".repeat(80),
    `PROMPT DEBUG DUMP #${seq}`,
    formatPromptDumpSourceLine(apiDumpSource, apiDumpDetail),
    `Timestamp: ${payload.timestamp}`,
    `Provider: ${payload.provider}`,
    `Model: ${payload.model}`,
    payload.stage ? `Stage: ${payload.stage}` : "",
    payload.requestKind ? `Request kind: ${payload.requestKind}` : "",
    payload.chatId != null ? `Chat ID: ${payload.chatId}` : "",
    "=".repeat(80),
    "",
  ].filter(Boolean);

  for (const s of payload.sections) {
    lines.push(
      `-`.repeat(80),
      `[SECTION ${s.id}] role=${s.role} | ${s.label}`,
      `chars=${s.chars.toLocaleString()} | tokens≈${s.tokens.toLocaleString()}${s.hidden ? " | HIDDEN INJECTION" : ""}`,
      s.hiddenReason ? `hiddenReason: ${s.hiddenReason}` : "",
      "<<<BEGIN EXACT TEXT>>>",
      s.text,
      "<<<END EXACT TEXT>>>",
      ""
    );
  }

  lines.push("=".repeat(80), "DUPLICATE DETECTION", "=".repeat(80));
  if (payload.duplicates.length === 0) {
    lines.push("(none detected)");
  } else {
    for (const d of payload.duplicates) {
      lines.push(
        `• ${d.label}`,
        `  sections: [${d.sectionIds.join(", ")}]`,
        `  wastedTokens≈${d.wastedTokens}`,
        `  snippet: ${d.sharedSnippet}`,
        ""
      );
    }
  }

  lines.push("=".repeat(80), "HIDDEN / INJECTED PROMPTS", "=".repeat(80));
  if (payload.hiddenInjections.length === 0) {
    lines.push("(none flagged)");
  } else {
    for (const h of payload.hiddenInjections) {
      lines.push(
        `• [${h.id}] ${h.reason} (tokens≈${h.tokens})`,
        "<<<BEGIN EXACT TEXT>>>",
        h.text,
        "<<<END EXACT TEXT>>>",
        ""
      );
    }
  }

  lines.push(
    "=".repeat(80),
    "EXACT API REQUEST BODY (as sent to provider — no summarization)",
    "=".repeat(80),
    JSON.stringify(payload.apiRequestBody, null, 2)
  );

  return lines.join("\n");
}

function writeDebugFiles(payload: PromptDebugPayload): void {
  requestSeq += 1;
  fs.mkdirSync(DEBUG_DIR, { recursive: true });

  const txtPath = path.join(DEBUG_DIR, "prompt_dump.txt");
  const jsonPath = path.join(DEBUG_DIR, "token_breakdown.json");

  fs.writeFileSync(txtPath, formatPromptDumpTxt(payload, requestSeq), "utf8");
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), "utf8");

  console.log(`[PROMPT_DEBUG] wrote ${txtPath} + ${jsonPath} (#${requestSeq}, ${payload.provider}/${payload.model})`);
}

/* ──────────────────────────────────────────────────────────────
 * Build-time dump — written by contextBuilder for every assembled
 * prompt in development (no env flag required; skipped in production).
 * Files: debug/prompt_dump.txt + debug/token_breakdown.json
 * ────────────────────────────────────────────────────────────── */

type BuildDumpSection = {
  id: string;
  label: string;
  category: string;
  text: string;
};

export function writePromptBuildDump(opts: {
  sections: BuildDumpSection[];
  history: { role: string; content: string }[];
  provider: string;
  modelId: string;
  charName: string;
  source: PromptDumpSource;
  sourceDetail?: string;
}): void {
  if (process.env.NODE_ENV === "production" && !isPromptDebugEnabled()) return;

  try {
    const debugSections: PromptDebugSection[] = opts.sections.map((s) => ({
      id: s.id,
      label: `${s.label} [${s.category}]`,
      role: "system" as const,
      text: s.text,
      chars: s.text.length,
      tokens: estimateTokens(s.text),
      hidden: false,
    }));

    const systemTokens = debugSections.reduce((n, s) => n + s.tokens, 0);
    const historyTokens = opts.history.reduce((n, m) => n + estimateTokens(m.content), 0);
    const duplicates = detectDuplicates(debugSections);

    const breakdown = {
      timestamp: new Date().toISOString(),
      promptDumpSource: opts.source,
      promptDumpDetail: opts.sourceDetail,
      provider: opts.provider,
      model: opts.modelId,
      charName: opts.charName,
      sections: debugSections.map((s) => ({
        id: s.id,
        label: s.label,
        chars: s.chars,
        tokens: s.tokens,
        duplicateFlag: duplicates.some((d) => d.sectionIds.includes(s.id)),
      })),
      duplicates,
      systemPromptTokens: systemTokens,
      historyTokens,
      totalTokens: systemTokens + historyTokens,
    };

    const txtLines: string[] = [
      "=".repeat(80),
      `PROMPT BUILD DUMP — ${breakdown.timestamp}`,
      formatPromptDumpSourceLine(opts.source, opts.sourceDetail),
      `provider=${opts.provider} model=${opts.modelId} char=${opts.charName}`,
      `system≈${systemTokens.toLocaleString()} tok · history≈${historyTokens.toLocaleString()} tok · total≈${breakdown.totalTokens.toLocaleString()} tok`,
      "=".repeat(80),
      "",
    ];
    for (const s of debugSections) {
      txtLines.push(
        "-".repeat(80),
        `### [${s.id}] ${s.label} — chars=${s.chars.toLocaleString()} tokens≈${s.tokens.toLocaleString()}`,
        s.text,
        ""
      );
    }
    txtLines.push("-".repeat(80), `### HISTORY (${opts.history.length} messages, ≈${historyTokens.toLocaleString()} tok)`);
    opts.history.forEach((m, n) => {
      txtLines.push(`--- history[${n}] ${m.role} (${m.content.length} chars) ---`, m.content, "");
    });
    if (duplicates.length > 0) {
      txtLines.push("=".repeat(80), "DUPLICATES DETECTED");
      for (const d of duplicates) {
        txtLines.push(`• ${d.label} — [${d.sectionIds.join(", ")}] wasted≈${d.wastedTokens}`);
      }
    } else {
      txtLines.push("=".repeat(80), "DUPLICATES: none detected");
    }

    fs.mkdirSync(DEBUG_DIR, { recursive: true });
    fs.writeFileSync(path.join(DEBUG_DIR, "prompt_dump.txt"), txtLines.join("\n"), "utf8");
    fs.writeFileSync(
      path.join(DEBUG_DIR, "token_breakdown.json"),
      JSON.stringify(breakdown, null, 2),
      "utf8"
    );
  } catch (e) {
    console.warn("[promptDebugDump] build dump failed:", (e as Error).message);
  }
}

export function dumpGeminiRequest(
  body: Record<string, unknown>,
  modelId: string,
  meta?: PromptDebugMeta
): void {
  if (!isPromptDebugEnabled()) return;
  const sections = sectionsFromGeminiBody(body, meta);
  const payload = buildPayload("gemini", modelId, sections, body, meta);
  writeDebugFiles(payload);
}

export function dumpOpenRouterRequest(
  body: Record<string, unknown>,
  meta?: PromptDebugMeta
): void {
  if (!isPromptDebugEnabled()) return;
  const model = String(body.model ?? "unknown");
  const messages = (body.messages ?? []) as OpenRouterChatMessage[];
  const sections = sectionsFromOpenRouterMessages(messages);
  const payload = buildPayload("openrouter", model, sections, body, meta);
  writeDebugFiles(payload);
}
