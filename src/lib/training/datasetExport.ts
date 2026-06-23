import fs from "fs";
import path from "path";
import { getDb } from "@/lib/db";
import { normalizeMessageVariants } from "@/lib/messageAlternates";
import {
  getBadExampleMaxScore,
  getGoodExampleMinScore,
  getTrainingExportDir,
} from "./config";
import { getTagsForMessage } from "./training-db";
import type {
  ConversationExport,
  DatasetExportResult,
  PreferencePairExport,
} from "./types";

function ensureExportDir(dir: string): string {
  const resolved = path.resolve(process.cwd(), dir);
  if (!fs.existsSync(resolved)) fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}

function writeJsonl(filePath: string, rows: object[]): void {
  const lines = rows.map((r) => JSON.stringify(r));
  fs.writeFileSync(filePath, lines.join("\n") + (lines.length ? "\n" : ""), "utf8");
}

function buildSystemPrompt(characterId: number): string {
  const db = getDb();
  const row = db
    .prepare("SELECT system_prompt, name FROM characters WHERE id=?")
    .get(characterId) as { system_prompt: string; name: string } | undefined;
  if (!row?.system_prompt?.trim()) return `You are ${row?.name ?? "a character"} in a roleplay conversation.`;
  return row.system_prompt;
}

function precedingUserMessage(chatId: number, assistantMessageId: number): string {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT content FROM messages
       WHERE chat_id=? AND role='user' AND id < ?
       ORDER BY id DESC LIMIT 1`
    )
    .get(chatId, assistantMessageId) as { content: string } | undefined;
  return row?.content ?? "";
}

function positiveTagLabels(messageId: number): string[] {
  return getTagsForMessage(messageId)
    .filter((t) => t.label === "positive")
    .map((t) => t.tag);
}

function buildConversationExport(
  messageId: number,
  chatId: number,
  characterId: number,
  content: string,
  qualityScore: number
): ConversationExport {
  const system = buildSystemPrompt(characterId);
  const userContent = precedingUserMessage(chatId, messageId);
  const tags = positiveTagLabels(messageId);
  return {
    messages: [
      { role: "system", content: system },
      { role: "user", content: userContent },
      { role: "assistant", content },
    ],
    metadata: {
      quality_score: qualityScore,
      tags,
      message_id: messageId,
      chat_id: chatId,
    },
  };
}

function buildPreferencePairs(
  messageId: number,
  chatId: number,
  characterId: number
): PreferencePairExport[] {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT content, model, usage, alternates, active_variant FROM messages WHERE id=?`
    )
    .get(messageId) as {
    content: string;
    model: string;
    usage: string | null;
    alternates: string | null;
    active_variant: number | null;
  } | undefined;
  if (!row) return [];

  const { variants, activeVariant } = normalizeMessageVariants(row);
  if (variants.length < 2) return [];

  const prompt = precedingUserMessage(chatId, messageId);
  const system = buildSystemPrompt(characterId);
  const fullPrompt = `${system}\n\nUser: ${prompt}`;
  const chosen = variants[activeVariant]?.content ?? row.content;
  const pairs: PreferencePairExport[] = [];

  for (let i = 0; i < variants.length; i++) {
    if (i === activeVariant) continue;
    const rejected = variants[i]?.content;
    if (!rejected || rejected === chosen) continue;
    pairs.push({
      prompt: fullPrompt,
      chosen,
      rejected,
      metadata: {
        message_id: messageId,
        chat_id: chatId,
        chosen_variant: activeVariant,
        rejected_variant: i,
      },
    });
  }
  return pairs;
}

export function exportTrainingDataset(runId: number): DatasetExportResult {
  const db = getDb();
  const goodMin = getGoodExampleMinScore();
  const badMax = getBadExampleMaxScore();
  const exportDir = ensureExportDir(getTrainingExportDir());
  const stamp = new Date().toISOString().slice(0, 10);

  const rows = db
    .prepare(
      `SELECT
         m.id AS message_id,
         m.chat_id,
         m.content,
         c.character_id,
         c.user_id,
         ms.quality_score,
         mf.vote
       FROM messages m
       JOIN chats c ON c.id = m.chat_id
       JOIN users u ON u.id = c.user_id
       LEFT JOIN message_scores ms ON ms.message_id = m.id
       LEFT JOIN message_feedback mf ON mf.message_id = m.id
       WHERE m.role = 'assistant'
         AND u.training_consent = 1
         AND (
           ms.quality_score >= ?
           OR ms.quality_score <= ?
           OR mf.vote IN (1, -1)
           OR m.alternates != '[]'
         )`
    )
    .all(goodMin, badMax) as {
    message_id: number;
    chat_id: number;
    content: string;
    character_id: number;
    user_id: number;
    quality_score: number | null;
    vote: number | null;
  }[];

  const good: ConversationExport[] = [];
  const bad: ConversationExport[] = [];
  const pairs: PreferencePairExport[] = [];

  for (const row of rows) {
    const score = row.quality_score ?? 0;
    const isGood = score >= goodMin || row.vote === 1;
    const isBad = score <= badMax || row.vote === -1;

    if (isGood) {
      good.push(
        buildConversationExport(
          row.message_id,
          row.chat_id,
          row.character_id,
          row.content,
          score
        )
      );
    }
    if (isBad) {
      bad.push(
        buildConversationExport(
          row.message_id,
          row.chat_id,
          row.character_id,
          row.content,
          score
        )
      );
    }

    pairs.push(...buildPreferencePairs(row.message_id, row.chat_id, row.character_id));
  }

  const goodPath = path.join(exportDir, `good-examples-${stamp}-run${runId}.jsonl`);
  const badPath = path.join(exportDir, `bad-examples-${stamp}-run${runId}.jsonl`);
  const pairsPath = path.join(exportDir, `preference-pairs-${stamp}-run${runId}.jsonl`);

  writeJsonl(goodPath, good);
  writeJsonl(badPath, bad);
  writeJsonl(pairsPath, pairs);

  return {
    runId,
    goodCount: good.length,
    badCount: bad.length,
    pairCount: pairs.length,
    exportDir,
  };
}
