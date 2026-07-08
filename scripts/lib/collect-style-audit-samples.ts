/** Collect production assistant texts from DB paths + validation harness JSON. */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { getDatabasePath } from "../../src/lib/dataDir";
import { OPENROUTER_DEEPSEEK_V4_PRO_MODEL } from "../../src/lib/chatModels";

export type StyleAuditSample = {
  id: string;
  source: "db" | "harness";
  messageId?: number;
  chatId?: number;
  text: string;
};

const HARNESS_JSON = [
  "fewshot-cross-character-validation.json",
  "fewshot-hand-ablation-validation.json",
  "step2-movement-a-validation.json",
  "step2-emotion-a-validation.json",
  "step2-rhythm-a-validation.json",
  "step2-sensation-a-validation.json",
  "step2-sensation-c-validation.json",
  "step19b-production-craft-validation.json",
];

function loadFromDb(dbPath: string, limit: number): StyleAuditSample[] {
  if (!existsSync(dbPath)) return [];
  const db = new Database(dbPath, { readonly: true });
  try {
    const deepSeek = `%deepseek%`;
    const rows = db
      .prepare(
        `
        WITH ranked AS (
          SELECT
            m.id,
            m.chat_id,
            m.content,
            ROW_NUMBER() OVER (PARTITION BY m.chat_id ORDER BY m.id DESC) AS rn
          FROM messages m
          WHERE m.role = 'assistant'
            AND m.model IS NOT NULL
            AND (m.model LIKE ? OR m.model = ?)
            AND LENGTH(m.content) BETWEEN 1200 AND 6500
        )
        SELECT id, chat_id, content FROM ranked WHERE rn = 1
        ORDER BY id DESC LIMIT ?
        `
      )
      .all(deepSeek, OPENROUTER_DEEPSEEK_V4_PRO_MODEL, limit) as {
      id: number;
      chat_id: number;
      content: string;
    }[];

    if (rows.length >= 10) {
      return rows.map((r) => ({
        id: `db-${r.id}`,
        source: "db" as const,
        messageId: r.id,
        chatId: r.chat_id,
        text: r.content,
      }));
    }

    const fallback = db
      .prepare(
        `
        WITH ranked AS (
          SELECT m.id, m.chat_id, m.content,
            ROW_NUMBER() OVER (PARTITION BY m.chat_id ORDER BY m.id DESC) AS rn
          FROM messages m
          WHERE m.role = 'assistant' AND LENGTH(m.content) BETWEEN 1200 AND 6500
        )
        SELECT id, chat_id, content FROM ranked WHERE rn = 1
        ORDER BY id DESC LIMIT ?
        `
      )
      .all(limit) as { id: number; chat_id: number; content: string }[];

    return fallback.map((r) => ({
      id: `db-${r.id}`,
      source: "db" as const,
      messageId: r.id,
      chatId: r.chat_id,
      text: r.content,
    }));
  } finally {
    db.close();
  }
}

function extractHarnessTexts(jsonPath: string): string[] {
  if (!existsSync(jsonPath)) return [];
  const data = JSON.parse(readFileSync(jsonPath, "utf8")) as {
    pairs?: Array<{ after?: { text?: string }; before?: { text?: string } }>;
  };
  const out: string[] = [];
  for (const pair of data.pairs ?? []) {
    const after = pair.after?.text?.trim();
    const before = pair.before?.text?.trim();
    if (after && after.length >= 400) out.push(after);
    if (before && before.length >= 400) out.push(before);
  }
  return out;
}

function dedupeByPrefix(texts: StyleAuditSample[], max: number): StyleAuditSample[] {
  const seen = new Set<string>();
  const out: StyleAuditSample[] = [];
  for (const s of texts) {
    const key = s.text.slice(0, 120);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

export function collectStyleAuditSamples(opts: {
  target: number;
  dbPaths?: string[];
}): { samples: StyleAuditSample[]; sources: Record<string, number> } {
  const target = Math.max(40, Math.min(80, opts.target));
  const dbPaths = opts.dbPaths ?? [
    getDatabasePath(),
    join(process.cwd(), "tmp-railway-db-test", "app.db"),
    join(process.cwd(), "tmp-audit-fresh-db", "app.db"),
    join(process.cwd(), "tmp-digest-repro", "app.db"),
  ];

  const all: StyleAuditSample[] = [];
  const sources: Record<string, number> = { db: 0, harness: 0 };

  for (const p of dbPaths) {
    const chunk = loadFromDb(p, target);
    for (const s of chunk) {
      all.push(s);
      sources.db++;
    }
  }

  const outDir = join(process.cwd(), "output");
  for (const name of HARNESS_JSON) {
    const texts = extractHarnessTexts(join(outDir, name));
    for (let i = 0; i < texts.length; i++) {
      all.push({
        id: `harness-${name}-${i}`,
        source: "harness",
        text: texts[i]!,
      });
      sources.harness++;
    }
  }

  const samples = dedupeByPrefix(all, target);
  return { samples, sources };
}
