/**
 * Read-only shadow replay of stored paid Claude Opus receipts.
 * Never writes DB, never deducts points, never calls an LLM.
 *
 *   node --conditions=react-server --import tsx scripts/opus-tier-shadow-replay.ts
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  measureOpusShadowVolatility,
  recommendOpusTierAction,
  summarizeOpusShadowWindow,
  usageToOpusShadowTurn,
  type OpusShadowTurn,
} from "../src/lib/opusShadowReplay";
import type { Usage } from "../src/lib/chatUsage";

const OUT_DIR = path.join(process.cwd(), "docs/audits/opus5-output-tier-pricing");
const OUT_MD = path.join(OUT_DIR, "SHADOW_REPLAY.md");
const OUT_JSON = path.join(OUT_DIR, "SHADOW_REPLAY.json");

type OpenedDb = {
  db: Database.Database;
  source: string;
};

function openReadOnlyDb(): OpenedDb | null {
  const url = process.env.TURSO_DATABASE_URL?.trim() ?? "";
  const token =
    process.env.TURSO_AUTH_TOKEN?.trim() ||
    process.env.TURSO_DATABASE_TURSO_AUTH_TOKEN?.trim() ||
    "";
  if (url && token) {
    const db = new Database(url, { authToken: token } as Database.Options & {
      authToken: string;
    });
    return { db, source: "turso" };
  }
  const candidates = [
    process.env.DATA_DIR ? path.join(process.env.DATA_DIR, "app.db") : "",
    "/data/app.db",
    path.join(process.cwd(), "data/app.db"),
  ].filter(Boolean);
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    return {
      db: new Database(file, { readonly: true, fileMustExist: true }),
      source: file,
    };
  }
  return null;
}

function parseUsage(raw: string | null): Usage | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Usage;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function loadShadowTurns(db: Database.Database): {
  scanned: number;
  turns: OpusShadowTurn[];
} {
  const rows = db
    .prepare(
      `SELECT usage, model FROM messages
       WHERE role = 'assistant' AND usage IS NOT NULL AND usage != ''
         AND COALESCE(is_refunded, 0) = 0
       ORDER BY id DESC
       LIMIT 5000`
    )
    .all() as Array<{ usage: string | null; model: string }>;
  const turns: OpusShadowTurn[] = [];
  for (const row of rows) {
    const usage = parseUsage(row.usage);
    if (!usage) continue;
    if (!usage.model) usage.model = row.model;
    const turn = usageToOpusShadowTurn(usage);
    if (turn) turns.push(turn);
  }
  return { scanned: rows.length, turns };
}

function windowBlock(label: string, turns: OpusShadowTurn[]) {
  const stats = summarizeOpusShadowWindow(turns);
  const rec = recommendOpusTierAction(stats.newRealizedGrossMarginPct, stats.sampleTurns);
  return { label, ...stats, recommendation: rec };
}

function main() {
  const opened = openReadOnlyDb();
  const payload: Record<string, unknown> = {
    dbWrite: false,
    recharge: false,
    llmCalls: 0,
    priceAutoChanged: false,
    HUMAN_REVIEW_REQUIRED: true,
  };

  if (!opened) {
    payload.dbStatus = "DB_UNAVAILABLE";
    payload.sampleTurns = 0;
    payload.availableSampleOnly = true;
    payload.recommendation = recommendOpusTierAction(null, 0);
    payload.windows = {
      all: windowBlock("all", []),
      last20: windowBlock("last20", []),
      last50: windowBlock("last50", []),
      last100: windowBlock("last100", []),
    };
    payload.volatility = measureOpusShadowVolatility([]);
  } else {
    const { scanned, turns } = loadShadowTurns(opened.db);
    opened.db.close();
    payload.dbStatus = "READ_ONLY";
    payload.dbSource = opened.source;
    payload.scannedAssistantRows = scanned;
    payload.sampleTurns = turns.length;
    payload.availableSampleOnly = turns.length < 20;
    payload.windows = {
      all: windowBlock("all", turns),
      last20: windowBlock("last20", turns.slice(0, 20)),
      last50: windowBlock("last50", turns.slice(0, 50)),
      last100: windowBlock("last100", turns.slice(0, 100)),
    };
    payload.volatility = measureOpusShadowVolatility(turns);
    payload.recommendation = recommendOpusTierAction(
      (payload.windows as { all: { newRealizedGrossMarginPct: number | null } }).all
        .newRealizedGrossMarginPct,
      turns.length
    );
    payload.turns = turns;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_JSON, `${JSON.stringify(payload, null, 2)}\n`);

  const windows = payload.windows as Record<string, ReturnType<typeof windowBlock>>;
  const vol = payload.volatility as ReturnType<typeof measureOpusShadowVolatility>;
  const rec = payload.recommendation as ReturnType<typeof recommendOpusTierAction>;
  const md = `# Opus tier shadow replay

\`\`\`text
dbWrite = false
recharge = false
llmCalls = 0
priceAutoChanged = false
dbStatus = ${payload.dbStatus}
sampleTurns = ${payload.sampleTurns}
AVAILABLE_SAMPLE_ONLY = ${payload.availableSampleOnly}
recommendation = ${rec.action}
${rec.note}
\`\`\`

## Windows

${Object.values(windows)
  .map(
    (w) => `### ${w.label}
- sample turns: ${w.sampleTurns}
- avg output chars: ${w.avgOutputChars}
- avg input tokens: ${w.avgInputTokens}
- avg old charge: ${w.avgOldCharge}
- avg new charge: ${w.avgNewCharge}
- total API cost: ${w.totalApiCost}
- total new revenue: ${w.totalNewRevenue}
- new realized gross margin %: ${w.newRealizedGrossMarginPct}
- cold-write turn count: ${w.coldWriteTurnCount}
- p50 new charge: ${w.p50NewCharge}
- p90 new charge: ${w.p90NewCharge}
- max new charge: ${w.maxNewCharge}
- AVAILABLE_SAMPLE_ONLY: ${w.availableSampleOnly}
`
  )
  .join("\n")}

## Volatility

- old charge range: ${vol.oldChargeRange}
- new charge range: ${vol.newChargeRange}
- old p90-p10: ${vol.oldP90MinusP10}
- new p90-p10: ${vol.newP90MinusP10}
- old max single-turn charge: ${vol.oldMaxSingleTurnCharge}
- new max single-turn charge: ${vol.newMaxSingleTurnCharge}
- 620P hard-cap applied count: ${vol.hardCap620AppliedCount}

FINAL_WINNER / PRICE_CHANGE = NOT_APPLIED
`;
  fs.writeFileSync(OUT_MD, md);
  console.log(JSON.stringify({ out: OUT_MD, dbStatus: payload.dbStatus, sampleTurns: payload.sampleTurns }, null, 2));
}

main();
