/**
 * Regenerate + system-rules ablation A/B test (3 API calls per variant).
 * Pass: all 3 runs visible chars > 3000 AND regen divergence OK.
 *
 * Usage:
 *   npx.cmd tsx --import ./scripts/lib/server-only-mock.ts scripts/prompt-ablation-regen-test.ts
 *   npx.cmd tsx --import ./scripts/lib/server-only-mock.ts scripts/prompt-ablation-regen-test.ts --variant=baseline
 */
import { loadEnvLocal } from "./load-env-local";
loadEnvLocal();
if (!process.env.NODE_ENV) process.env.NODE_ENV = "development";

import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { visibleAssistantDisplayCharCount } from "../src/lib/chatDisplayLength";
import { buildRegenerateUserPrompt } from "../src/lib/continueNarrative";
import { resolveRegenerateGenerationOverrides } from "../src/lib/openRouterClient";
import { convertToOpenRouterFormat } from "../src/lib/openRouterAdult";
import type { ChatMsg } from "../src/lib/ai";

const CHAT_ID = 39;
const RUNS = 3;
const MIN_CHARS = 3000;
const TEMPERATURE = 0.85;

export type AblationVariant = {
  id: string;
  label: string;
  skipIds: string[];
  compactKnowledge?: boolean;
};

export const ABLATION_VARIANTS: AblationVariant[] = [
  { id: "baseline", label: "현재 (삭제 없음)", skipIds: [] },
  { id: "A", label: "A: rule-terminal-length-override 삭제", skipIds: ["rule-terminal-length-override"] },
  {
    id: "B",
    label: "B: character-knowledge-boundary 압축",
    skipIds: [],
    compactKnowledge: true,
  },
  {
    id: "C",
    label: "C: regenerate-divergence 삭제 (재생성 전용)",
    skipIds: ["regenerate-divergence"],
  },
  { id: "D", label: "D: rule-output-layout-recency 삭제", skipIds: ["rule-output-layout-recency"] },
  { id: "E", label: "E: openrouter-co-narration-rule 삭제", skipIds: ["openrouter-co-narration-rule"] },
  {
    id: "F",
    label: "F: rule-user-input-parsing 삭제 (co-narration OFF)",
    skipIds: ["rule-user-input-parsing"],
  },
];

function normalizeForCompare(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 4000);
}

function bigramJaccard(a: string, b: string): number {
  const grams = (s: string) => {
    const t = normalizeForCompare(s);
    const set = new Set<string>();
    for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2));
    return set;
  };
  const A = grams(a);
  const B = grams(b);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  const union = A.size + B.size - inter;
  return union > 0 ? inter / union : 0;
}

async function loadChatFixture(chatId: number) {
  const { getDb } = await import("../src/lib/db");
  const { loadCharacterChunks } = await import("../src/lib/characterChunks");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { formatMemoryMetaForPrompt, parseMemoryMeta, normalizeMemoryMeta } = await import("../src/lib/chatMemory");
  const { messagesToTurns, recentTurnsToHistory } = await import("../src/lib/hybridMemory");
  const { resolveCharacterGender } = await import("../src/lib/characterGender");
  const { sanitizeCharacterGenres } = await import("../src/lib/characterGenres");
  const { resolveRelationshipMetaNames } = await import("../src/lib/relationshipMetaCharacterName");

  const db = getDb();
  const chat = db.prepare("SELECT * FROM chats WHERE id=?").get(chatId) as Record<string, unknown>;
  if (!chat) throw new Error(`chat ${chatId} not found`);
  const user = db.prepare("SELECT * FROM users WHERE id=?").get(chat.user_id) as Record<string, unknown>;
  const ch = db.prepare("SELECT * FROM characters WHERE id=?").get(chat.character_id) as Record<string, unknown>;
  const personaRow = chat.selected_persona_id
    ? (db.prepare("SELECT * FROM user_personas WHERE id=?").get(chat.selected_persona_id) as Record<
        string,
        unknown
      > | null)
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
    .prepare("SELECT role, content FROM messages WHERE chat_id=? ORDER BY id ASC")
    .all(chatId) as { role: "user" | "assistant"; content: string }[];
  const completedTurns = messagesToTurns(msgRows);
  const recentHistory = recentTurnsToHistory(completedTurns, completedTurns.length);
  const lastUser = [...recentHistory].reverse().find((m) => m.role === "user");
  const lastAssistant = [...recentHistory].reverse().find((m) => m.role === "assistant");
  if (!lastUser?.content || !lastAssistant?.content) throw new Error("need last user+assistant");

  const relationshipNames = resolveRelationshipMetaNames({
    displayName: String(ch.name),
    systemPrompt: String(ch.system_prompt ?? ""),
    chunks,
    userName: personaDisplayName,
  });

  const historyForRegen = recentHistory.slice(0, -2);
  const regenUserBlock = buildRegenerateUserPrompt({
    userMessage: lastUser.content,
    personaName: personaDisplayName,
    coNarrationEnabled: Number(chat.user_impersonation) === 1 || Number(chat.novel_mode) === 1,
    targetResponseChars: Number(chat.target_response_chars ?? 3200),
  });

  const modelId =
    String(chat.selected_ai ?? "").trim() ||
    (await import("../src/lib/chatModels")).OPENROUTER_DEEPSEEK_V4_PRO_MODEL;

  return {
    modelId,
    targetResponseChars: Number(chat.target_response_chars ?? 3200),
    buildInput: {
      charName: String(ch.name),
      chunks,
      userNickname: String(user.nickname),
      userPersona: formatSelectedPersonaForPrompt(
        personaDisplayName,
        (personaRow?.gender as import("../src/lib/characterGender").CharacterGender) ?? "other",
        String(personaRow?.description ?? "")
      ),
      userNote: formatUserNoteForPrompt(String(chat.user_note ?? user.user_note ?? "").trim()),
      longTermMemory: "",
      memoryMeta: formatMemoryMetaForPrompt(
        normalizeMemoryMeta(parseMemoryMeta(String(chat.memory_meta ?? "")), relationshipNames)
      ),
      shortTermHistory: historyForRegen,
      currentUserMessage: regenUserBlock,
      nsfw: String(chat.mode) === "nsfw" || Number(user.nsfw_on) === 1,
      gender: resolveCharacterGender(String(ch.gender)),
      completedTurns: Math.max(0, completedTurns.length - 1),
      userPersonaGender: (personaRow?.gender as import("../src/lib/characterGender").CharacterGender) ?? "other",
      genres: sanitizeCharacterGenres(JSON.parse(String(ch.genres ?? "[]"))),
      userImpersonation: Number(chat.user_impersonation) === 1,
      novelModeEnabled: Number(chat.novel_mode) === 1,
      targetResponseChars: Number(chat.target_response_chars ?? 3200),
      modelId,
      provider: "openrouter" as const,
      regenerate: true,
      rejectedAssistantDraft: lastAssistant.content,
      regenAttemptId: "ablation-test",
    },
    rejectedAssistant: lastAssistant.content,
    anchorUserMessage: lastUser.content,
  };
}

async function generateOnce(
  system: string,
  history: ChatMsg[],
  modelId: string,
  targetResponseChars: number,
  runIndex: number
): Promise<string> {
  const { callOpenRouterCompletion } = await import("../src/lib/openRouterCompletion");
  const overrides = resolveRegenerateGenerationOverrides(modelId, targetResponseChars);
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await callOpenRouterCompletion({
      system,
      history,
      model: modelId,
      temperature: Math.min(1.15, (overrides.temperature ?? TEMPERATURE) + runIndex * 0.02),
      maxTokens: 4096,
      requestKind: "prompt-ablation-regen-test",
    });
    const text = res.text.trim();
    if (text.length >= 200) return text;
  }
  throw new Error("completion too short");
}

async function runVariant(variant: AblationVariant, fixture: Awaited<ReturnType<typeof loadChatFixture>>) {
  const { buildContext } = await import("../src/services/contextBuilder");

  const variantInput = (regenAttemptId: string) => ({
    ...fixture.buildInput,
    regenAttemptId,
    promptSectionSkipIds: variant.skipIds.length ? variant.skipIds : undefined,
    promptUseFullKnowledgeBoundary: variant.compactKnowledge ? false : undefined,
  });

  const built = buildContext(variantInput(fixture.buildInput.regenAttemptId ?? "ablation-test"));
  const orHistory = convertToOpenRouterFormat(built.history);
  const history: ChatMsg[] = orHistory.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const runs: Array<{
    chars: number;
    similarityToRejected: number;
    preview: string;
  }> = [];

  for (let i = 0; i < RUNS; i++) {
    process.env.PROMPT_ABLATION_REGEN_SEED = String(i + 1);
    fixture.buildInput.regenAttemptId = `ablation-${variant.id}-${i + 1}`;
    const builtRun = buildContext(variantInput(`ablation-${variant.id}-${i + 1}`));
    const text = await generateOnce(
      builtRun.systemPrompt,
      builtRun.history.map((m) => ({ role: m.role, content: m.content ?? "" })),
      fixture.modelId,
      fixture.targetResponseChars,
      i
    );
    const chars = visibleAssistantDisplayCharCount(text);
    runs.push({
      chars,
      similarityToRejected: bigramJaccard(text, fixture.rejectedAssistant),
      preview: text.slice(0, 200).replace(/\s+/g, " "),
    });
    console.log(`  run ${i + 1}: ${chars} chars, sim=${runs[i]!.similarityToRejected.toFixed(3)}`);
  }

  const minChars = Math.min(...runs.map((r) => r.chars));
  const avgChars = Math.round(runs.reduce((s, r) => s + r.chars, 0) / runs.length);
  const maxSim = Math.max(...runs.map((r) => r.similarityToRejected));
  const baselineSim = variant.id === "baseline" ? maxSim : undefined;

  const lengthPass = runs.every((r) => r.chars > MIN_CHARS);
  // 재생성: 거절본과 너무 비슷하면(>0.72) diverge 실패로 간주
  const divergePass = maxSim < 0.72;
  const pass = lengthPass && divergePass;

  return {
    variant: variant.id,
    label: variant.label,
    skipIds: variant.skipIds,
    compactKnowledge: !!variant.compactKnowledge,
    runs,
    minChars,
    avgChars,
    maxSim,
    lengthPass,
    divergePass,
    pass,
    systemRulesTokens: (built.meta.trackedSections ?? [])
      .filter((s) => s.category === "systemRules")
      .reduce((n, s) => n + s.text.length, 0),
  };
}

async function main() {
  const onlyVariant = process.argv.find((a) => a.startsWith("--variant="))?.slice("--variant=".length);
  const fixture = await loadChatFixture(CHAT_ID);
  const variants = onlyVariant
    ? ABLATION_VARIANTS.filter((v) => v.id === onlyVariant)
    : ABLATION_VARIANTS;

  if (variants.length === 0) throw new Error(`unknown variant ${onlyVariant}`);

  console.log(`=== prompt ablation regen test chat=${CHAT_ID} model=${fixture.modelId} ===`);
  console.log(`threshold: visible chars > ${MIN_CHARS}, regen sim to rejected < 0.72`);

  const results = [];
  for (const v of variants) {
    console.log(`\n--- ${v.id}: ${v.label} ---`);
    results.push(await runVariant(v, fixture));
  }

  const outDir = join(process.cwd(), "output");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "prompt-ablation-regen-test.json");
  writeFileSync(outPath, JSON.stringify({ chatId: CHAT_ID, minChars: MIN_CHARS, results }, null, 2));
  console.log(`\nWrote ${outPath}`);

  console.log("\n=== SUMMARY ===");
  for (const r of results) {
    console.log(
      `${r.pass ? "PASS" : "FAIL"} ${r.variant.padEnd(10)} min=${r.minChars} avg=${r.avgChars} maxSim=${r.maxSim.toFixed(3)} | ${r.label}`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
