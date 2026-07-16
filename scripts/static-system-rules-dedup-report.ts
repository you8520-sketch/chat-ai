/**
 * Static system-rules dedup validation — no live API calls.
 * Usage: npx.cmd tsx scripts/static-system-rules-dedup-report.ts --chat-id=44
 */
import Module from "module";
import fs from "fs";
import path from "path";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import { loadEnvLocal } from "./load-env-local";
loadEnvLocal();
if (!process.env.NODE_ENV) process.env.NODE_ENV = "development";

function parseChatId(argv: string[]): number {
  for (const arg of argv) {
    if (arg.startsWith("--chat-id=")) return Number(arg.slice("--chat-id=".length));
  }
  return 44;
}

function extractCombined(dump: string): string {
  const marker = "── COMBINED SYSTEM RULES TEXT ──";
  const i = dump.indexOf(marker);
  if (i < 0) return dump;
  return dump.slice(i + marker.length).trim();
}

function normalizeForOverlap(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(s: string): Set<string> {
  return new Set(normalizeForOverlap(s).split(" ").filter((t) => t.length >= 2));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

async function main() {
  const { estimateTokens } = await import("../src/lib/ai");
  const { buildContext } = await import("../src/services/contextBuilder");
  const { OPENROUTER_DEEPSEEK_V4_PRO_MODEL } = await import("../src/lib/chatModels");
  const { OUTPUT_LAYOUT_SEMANTIC_CORE } = await import("../src/lib/webnovelOutputFormat");
  const { buildLengthInstruction } = await import("../src/lib/responseLength");
  const { NO_INPUT_ECHO_RULE, NARRATIVE_DENSITY_BLOCK } = await import("../src/lib/sceneExpansionPolicy");

  // Reuse dump-system-rules fixture loader via spawn of dump after writing after file.
  const chatId = parseChatId(process.argv.slice(2));
  const beforePath = path.join("output", "static-dedup-before-system-rules-chat44.txt");
  const afterDumpPath = path.join("output", `system-rules-prompt-chat${chatId}-deepseek.txt`);

  // Generate after dump by importing dump script logic inline
  const { execSync } = await import("child_process");
  execSync(`npx.cmd tsx scripts/dump-system-rules-prompt.ts --chat-id=${chatId}`, {
    stdio: "inherit",
    cwd: process.cwd(),
    env: process.env,
  });

  const beforeRaw = fs.readFileSync(beforePath, "utf8");
  const afterRaw = fs.readFileSync(afterDumpPath, "utf8");
  fs.writeFileSync(
    path.join("output", "static-dedup-after-system-rules-chat44.txt"),
    afterRaw,
    "utf8"
  );

  const beforeCombined = extractCombined(beforeRaw);
  const afterCombined = extractCombined(afterRaw);

  const lengthMarkers = [
    "[LENGTH CONTROL & SCENE EXPANSION]",
    "TARGET_LENGTH:",
    "MINIMUM_FLOOR:",
    "[NO INPUT ECHO — STRICT]",
    "[SCENE CONTINUATION PRIORITY]",
    "[NARRATIVE DENSITY]",
    "[OUTPUT LAYOUT]",
    "[SEMANTIC PARAGRAPHING]",
  ];

  const frozenChecks: string[] = [];
  for (const m of lengthMarkers) {
    const b = beforeCombined.includes(m);
    const a = afterCombined.includes(m);
    frozenChecks.push(`${m}: before=${b} after=${a} ${b === a && b ? "OK" : "FAIL"}`);
  }

  // OUTPUT LAYOUT semantic core identity
  const layoutCoreOk = afterCombined.includes(OUTPUT_LAYOUT_SEMANTIC_CORE);
  const layoutCoreBeforeOk = beforeCombined.includes(
    OUTPUT_LAYOUT_SEMANTIC_CORE.replace(/\\\\n\\\\n/g, "\\n\\n")
  );
  // Before dump stored literal \n\n as two chars backslash-n from the builder — compare semantic lines
  const semanticLines = [
    "한 문단에는 하나의 중심 행동·반응·감정 또는 관찰 초점만 둔다.",
    'Wrong: 그는 고개를 들었다. "대사."',
    "같은 서술 초점이 유지되는 지문은 2~5문장 정도 자연스럽게 묶을 수 있다(문장 수 강제 아님).",
  ];
  const layoutIdentity = semanticLines.every(
    (l) => beforeCombined.includes(l) && afterCombined.includes(l)
  );

  const lengthBlock = buildLengthInstruction(3200);
  const lengthInAfter = afterCombined.includes(lengthBlock) || afterCombined.includes("[LENGTH CONTROL & SCENE EXPANSION]");
  const noEchoOk =
    afterCombined.includes(NO_INPUT_ECHO_RULE.trim()) ||
    afterCombined.includes("[NO INPUT ECHO — STRICT]");
  const densityOk = afterCombined.includes("[NARRATIVE DENSITY]");

  // Mapping report
  const mapping = [
    "1. CANON/SCOPE/KNOWLEDGE ← 설정 우선순위 + 서술 시점 + CORE RP + CHARACTER KNOWLEDGE BOUNDARY + 절대 금지",
    "2. LIMITED CO-NARRATION ← 유저 대사 ON + USER CONTROL LIMITED + possession_mode + orphan NO GODMODDING→LIMITED ref",
    "3. PRIVATE OUTPUT HYGIENE ← CONTAMINATION GUARD + NO STAGE DIRECTIONS + SPEECH METADATA + Qwen/DeepSeek 보강",
    "4. NO FALSE SHARED MEMORY ← 규칙 본문 유지, 나쁜/좋은 예시 2줄 제거",
    "5. OUTPUT LANG ← 3줄 → 1문장 (의미 동일)",
    "6. WEBNOVEL OUTPUT FORMAT / USER INPUT PARSING ← 출력 규칙 vs 입력 해석 분리·축소",
    "7. DIALOGUE & NARRATION ← prose bundle → OUTPUT LAYOUT 섹션으로 이동",
    "8. RHYTHM/BEAT FLOW/BREATH ← OUTPUT LAYOUT 재설명 참조 문장만 제거 (문체 지시 본문 유지)",
    "9. ADVANCED PROSE / PROSE STYLE 빈 헤더 삭제",
    "10. RUNTIME STYLE ← genre_tone + SCENE MODE (possession은 LIMITED로)",
  ];

  // Full prompt overlap candidates (Canon / LTM / RAG / recent) — report only
  const { getDb } = await import("../src/lib/db");
  const db = getDb();
  const chat = db.prepare("SELECT * FROM chats WHERE id=?").get(chatId) as Record<string, unknown>;
  const { loadCharacterChunks } = await import("../src/lib/characterChunks");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { formatMemoryMetaForPrompt, parseMemoryMeta, normalizeMemoryMeta } = await import("../src/lib/chatMemory");
  const { messagesToTurns, recentTurnsToHistory } = await import("../src/lib/hybridMemory");
  const { resolveCharacterGender } = await import("../src/lib/characterGender");
  const { sanitizeCharacterGenres } = await import("../src/lib/characterGenres");
  const { parseAssets, chatAssets } = await import("../src/lib/characterAssets");
  const { resolveRelationshipMetaNames } = await import("../src/lib/relationshipMetaCharacterName");

  const user = db.prepare("SELECT * FROM users WHERE id=?").get(Number(chat.user_id)) as Record<string, unknown>;
  const ch = db.prepare("SELECT * FROM characters WHERE id=?").get(Number(chat.character_id)) as Record<string, unknown>;
  const personaRow = chat.selected_persona_id
    ? (db.prepare("SELECT * FROM user_personas WHERE id=?").get(chat.selected_persona_id) as Record<string, unknown> | null)
    : null;
  const personaDisplayName = String(personaRow?.name ?? user.nickname ?? "").trim() || "유저";
  const chunks = loadCharacterChunks({
    id: Number(ch.id),
    name: String(ch.name),
    gender: String(ch.gender ?? ""),
    system_prompt: String(ch.system_prompt ?? ""),
    world: String(ch.world ?? ""),
    example_dialog: String(ch.example_dialog ?? ""),
    setting_chunks: String(ch.setting_chunks ?? ""),
    speech_profile: String(ch.speech_profile ?? ""),
  });
  const msgRows = db
    .prepare("SELECT role, content, model FROM messages WHERE chat_id=? ORDER BY id ASC")
    .all(chatId) as { role: "user" | "assistant"; content: string; model?: string | null }[];
  const completedTurns = messagesToTurns(msgRows);
  const recentHistory = recentTurnsToHistory(completedTurns, completedTurns.length);
  const lastUser = [...recentHistory].reverse().find((m) => m.role === "user");
  const memRow = db
    .prepare("SELECT recent_summary FROM chat_memories WHERE chat_id=?")
    .get(chatId) as { recent_summary?: string } | undefined;
  const longTermMemory = String(memRow?.recent_summary ?? chat.current_summary ?? chat.memory ?? "").trim();
  const relationshipNames = resolveRelationshipMetaNames({
    displayName: String(ch.name),
    systemPrompt: String(ch.system_prompt ?? ""),
    chunks,
    userName: personaDisplayName,
  });
  const memoryMeta = formatMemoryMetaForPrompt(
    normalizeMemoryMeta(parseMemoryMeta(String(chat.memory_meta ?? "")), relationshipNames)
  );
  const assetTags = [...new Set(chatAssets(parseAssets(String(ch.assets ?? "[]"))).map((a) => a.tag))];

  const built = buildContext({
    charName: String(ch.name),
    chunks,
    userNickname: String(user.nickname),
    userPersona: formatSelectedPersonaForPrompt(
      personaDisplayName,
      (personaRow?.gender as import("../src/lib/characterGender").CharacterGender) ?? "other",
      String(personaRow?.description ?? "")
    ),
    userNote: formatUserNoteForPrompt(String(chat.user_note ?? user.user_note ?? "").trim()),
    longTermMemory,
    memoryMeta,
    shortTermHistory: recentHistory.slice(0, -1),
    currentUserMessage: lastUser?.content ?? "안녕",
    nsfw: String(chat.mode) === "nsfw" || Number(user.nsfw_on) === 1,
    gender: resolveCharacterGender(String(ch.gender)),
    assetTags: assetTags.length > 0 ? assetTags : undefined,
    completedTurns: completedTurns.length,
    userPersonaGender: (personaRow?.gender as import("../src/lib/characterGender").CharacterGender) ?? "other",
    genres: sanitizeCharacterGenres(JSON.parse(String(ch.genres ?? "[]"))),
    userImpersonation: Number(chat.user_impersonation) === 1,
    novelModeEnabled: Number((chat as { novel_mode?: number }).novel_mode) === 1,
    targetResponseChars: Number(chat.target_response_chars ?? 2500),
    modelId: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
    provider: "openrouter",
    mainModelOwnsRelationshipExtract: false,
  });

  const sections = built.meta.trackedSections ?? [];
  const byId = (id: string) => sections.find((s) => s.id === id)?.text ?? "";
  const canon = byId("character-core-identity") || sections.filter((s) => s.category === "characterSetting").map((s) => s.text).join("\n");
  const ltm = byId("current-memory") + "\n" + memoryMeta;
  const rag = byId("user-note-reference") + "\n" + byId("keyword-lorebook");
  const recent = recentHistory.map((m) => m.content).join("\n");

  const pairs: { a: string; b: string; left: string; right: string }[] = [
    { a: "Canon", b: "LTM", left: canon, right: ltm },
    { a: "Canon", b: "RAG", left: canon, right: rag },
    { a: "Canon", b: "Recent", left: canon, right: recent },
    { a: "LTM", b: "RAG", left: ltm, right: rag },
    { a: "LTM", b: "Recent", left: ltm, right: recent },
    { a: "RAG", b: "Recent", left: rag, right: recent },
  ];

  const overlapLines: string[] = [
    "Overlap candidates (normalized token Jaccard ≥ 0.08) — report only, no auto-delete",
    "Priority reminder: CANON > LTM > RAG > recent chat",
    "",
  ];
  for (const p of pairs) {
    const ja = jaccard(tokenSet(p.left), tokenSet(p.right));
    if (ja < 0.08 && p.left.trim().length < 20) continue;
    const leftTokens = [...tokenSet(p.left)];
    const rightSet = tokenSet(p.right);
    const shared = leftTokens.filter((t) => rightSet.has(t)).slice(0, 40);
    overlapLines.push(
      `## ${p.a} ∩ ${p.b}  jaccard=${ja.toFixed(3)}  shared_tokens≈${shared.length}`
    );
    if (shared.length) overlapLines.push(`sample: ${shared.slice(0, 25).join(", ")}`);
    overlapLines.push("");
  }

  const report = [
    "# Static System Rules Dedup Report",
    `chat: ${chatId}`,
    `generated: ${new Date().toISOString()}`,
    "",
    "## Totals",
    `| | chars | est tokens |`,
    `|---|---:|---:|`,
    `| before systemRules | ${beforeCombined.length} | ${estimateTokens(beforeCombined)} |`,
    `| after systemRules | ${afterCombined.length} | ${estimateTokens(afterCombined)} |`,
    `| delta | ${afterCombined.length - beforeCombined.length} | ${estimateTokens(afterCombined) - estimateTokens(beforeCombined)} |`,
    "",
    "## Frozen length/layout/style markers",
    ...frozenChecks.map((l) => `- ${l}`),
    `- OUTPUT_LAYOUT_SEMANTIC_CORE in after: ${layoutCoreOk}`,
    `- semantic layout lines identity before∩after: ${layoutIdentity}`,
    `- length block present: ${lengthInAfter}`,
    `- NO INPUT ECHO present: ${noEchoOk}`,
    `- NARRATIVE DENSITY present: ${densityOk}`,
    `- layoutCoreBefore heuristic: ${layoutCoreBeforeOk}`,
    "",
    "## Block mapping (before → after)",
    ...mapping.map((l) => `- ${l}`),
    "",
    "## Removed / relocated duplicates (summary)",
    "- Duplicate CORE RP + knowledge boundary + absolute prohibition from separate sections → single CANON block (OpenRouter)",
    "- Co-narration ON line + possession_mode → LIMITED CO-NARRATION (no-godmodding)",
    "- NO STAGE DIRECTIONS + SPEECH METADATA → PRIVATE OUTPUT HYGIENE",
    "- NO FALSE SHARED MEMORY example lines removed",
    "- Empty ADVANCED PROSE / PROSE STYLE headers removed",
    "- DIALOGUE & NARRATION relocated under OUTPUT LAYOUT",
    "- OUTPUT LAYOUT cross-refs stripped from RHYTHM / BEAT FLOW / BREATH only",
    "",
  ].join("\n");

  fs.writeFileSync(path.join("output", "static-dedup-mapping-report.md"), report, "utf8");
  fs.writeFileSync(
    path.join("output", "static-dedup-canon-ltm-rag-overlap.md"),
    overlapLines.join("\n"),
    "utf8"
  );

  console.log(report);
  console.log("\nWrote output/static-dedup-mapping-report.md");
  console.log("Wrote output/static-dedup-canon-ltm-rag-overlap.md");
  console.log("Wrote output/static-dedup-after-system-rules-chat44.txt");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
