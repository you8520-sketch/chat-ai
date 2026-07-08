/**
 * Step 7.6c — Production Leon tagged example + post-deploy verification.
 *
 * Usage:
 *   npm.cmd exec tsx -- scripts/step76c-prod-leon-rollout.ts --apply-db
 *   npm.cmd exec tsx -- scripts/step76c-prod-leon-rollout.ts --apply-db --verify --n=12
 *
 * DATA_DIR selects the target DB (local data/ or Railway /data volume).
 * Verify harness sets EXAMPLE_DIALOG_SCENE_FILTER=1; the production runtime env
 * (Railway variables) must be set separately for live traffic.
 */
import "./lib/server-only-mock";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";
import { getDb } from "@/lib/db";
import { getDataDir } from "@/lib/dataDir";
import { validateBracketTaggedExampleDialog } from "@/lib/exampleDialogSceneFilter";
import { LEON_EXAMPLE_TAGGED, LEON_SCENES } from "./lib/exampleDialogContextAuditLib";
import {
  buildStagingContextFromDb,
  LEON_STAGING_CHARACTER_ID,
} from "./lib/step76LeonStagingContext";
import { evaluateRegisterCompliance } from "@/lib/characterRegisterCompliance";
import { evaluateStep73Sample } from "@/lib/registerMetaAudit";
import { OPENROUTER_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";
import { resolveDeepSeekTemperatureForTarget } from "@/lib/openRouterClient";
import type { RegisterValidationScene } from "./lib/leon-ren-register-fixtures";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const LEON_ID = Number(
  process.env.LEON_PROD_CHARACTER_ID ?? process.env.LEON_STAGING_CHARACTER_ID ?? "18"
);
const OUT_DIR = join(process.cwd(), "output");
const OUT_MD = join(OUT_DIR, "step76c-prod-leon-rollout.md");
const OUT_JSON = join(OUT_DIR, "step76c-prod-leon-rollout.json");

/** Primary bed scene + hard low-Δ private scene (reported separately). */
const VERIFY_SCENE_IDS = ["leon-private-1", "leon-private-0"] as const;

type VerifyRow = {
  run: number;
  sceneId: string;
  compliance: number;
  pass: boolean;
  driftKinds: string[];
  text: string;
};

function parseN(): number {
  const arg = process.argv.find((a) => a.startsWith("--n="));
  const n = arg ? Number.parseInt(arg.split("=")[1] ?? "12", 10) : 12;
  return Number.isFinite(n) && n >= 10 ? n : 12;
}

function verifyCachePath(sceneId: string): string {
  return join(OUT_DIR, `step76c-prod-verify-${sceneId}.json`);
}

function applyLeonProdExampleDialog() {
  const db = getDb();
  const row = db
    .prepare(`SELECT id, name, example_dialog FROM characters WHERE id = ?`)
    .get(LEON_ID) as { id: number; name: string; example_dialog: string } | undefined;

  if (!row) throw new Error(`Leon id=${LEON_ID} not found in ${getDataDir()}`);
  if (row.name !== "레온") throw new Error(`Safety: id=${row.id} name="${row.name}" is not 레온`);

  const before = row.example_dialog ?? "";
  const alreadyApplied = before.trim() === LEON_EXAMPLE_TAGGED.trim();
  if (!alreadyApplied) {
    db.prepare(`UPDATE characters SET example_dialog = ? WHERE id = ?`).run(
      LEON_EXAMPLE_TAGGED,
      row.id
    );
  }
  const after = (
    db.prepare(`SELECT example_dialog FROM characters WHERE id = ?`).get(row.id) as {
      example_dialog: string;
    }
  ).example_dialog;

  const v = validateBracketTaggedExampleDialog(after);
  if (!v.valid) throw new Error(`Verify failed: ${v.errors.join("; ")}`);

  return {
    id: row.id,
    name: row.name,
    alreadyApplied,
    bracketTagLineCount: v.bracketTagLineCount,
    before,
    after,
    dataDir: getDataDir(),
  };
}

async function verifyRun(
  scene: RegisterValidationScene,
  run: number,
  attempt = 1
): Promise<string> {
  process.env.EXAMPLE_DIALOG_SCENE_FILTER = "1";

  const { callOpenRouterCompletion } = await import("@/lib/openRouterCompletion");
  const { buildContext } = await import("@/services/contextBuilder");
  const built = buildContext(buildStagingContextFromDb(scene));

  try {
    const res = await callOpenRouterCompletion({
      system: built.systemPrompt,
      history: built.history,
      model: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
      temperature: resolveDeepSeekTemperatureForTarget(3200),
      maxTokens: 4096,
      requestKind: `step76c-prod-verify-${scene.id}-run${run}`,
    });
    return res.text.trim();
  } catch (err) {
    if (attempt >= 3) throw err;
    await new Promise((r) => setTimeout(r, 3000 * attempt));
    return verifyRun(scene, run, attempt + 1);
  }
}

function sceneStats(rows: VerifyRow[]) {
  const n = rows.length;
  const passCount = rows.filter((r) => r.pass).length;
  const driftCount = rows.filter((r) => r.driftKinds.length > 0).length;
  return {
    n,
    passCount,
    passRate: n ? Math.round((passCount / n) * 1000) / 10 : 0,
    driftCount,
    meanCompliance: n
      ? Math.round((rows.reduce((a, r) => a + r.compliance, 0) / n) * 10) / 10
      : 0,
  };
}

async function main() {
  const applyDb = process.argv.includes("--apply-db");
  const verify = process.argv.includes("--verify");
  const targetN = parseN();
  mkdirSync(OUT_DIR, { recursive: true });

  let dbApply: ReturnType<typeof applyLeonProdExampleDialog> | null = null;
  if (applyDb) {
    dbApply = applyLeonProdExampleDialog();
    console.log(
      `Prod DB ${dbApply.alreadyApplied ? "already tagged (idempotent)" : "updated"}: id=${dbApply.id} DATA_DIR=${dbApply.dataDir} bracketTags=${dbApply.bracketTagLineCount}`
    );
  }

  const perScene: Record<string, VerifyRow[]> = {};

  if (verify) {
    for (const sceneId of VERIFY_SCENE_IDS) {
      const scene = LEON_SCENES.find((s) => s.id === sceneId);
      if (!scene) throw new Error(`Scene ${sceneId} not found`);

      const rows: VerifyRow[] = [];
      const cached = new Set<number>();
      const cachePath = verifyCachePath(sceneId);
      if (existsSync(cachePath)) {
        try {
          const j = JSON.parse(readFileSync(cachePath, "utf8")) as { samples?: VerifyRow[] };
          for (const s of j.samples ?? []) {
            if (!s.text) continue;
            rows.push(s);
            cached.add(s.run);
          }
        } catch {
          /* fresh */
        }
      }

      for (let run = 1; run <= targetN; run++) {
        if (cached.has(run)) continue;
        console.log(`[prod verify ${sceneId}] run ${run}/${targetN}…`);
        const text = await verifyRun(scene, run);
        const comp = evaluateRegisterCompliance(text, scene.expectedRegister);
        const reg = evaluateStep73Sample(scene.id, text, scene.genres);
        rows.push({
          run,
          sceneId,
          compliance: comp.complianceRate,
          pass: comp.complianceRate >= 70 && reg.registerSwitching !== "FAIL",
          driftKinds: comp.driftKinds,
          text,
        });
        rows.sort((a, b) => a.run - b.run);
        writeFileSync(cachePath, JSON.stringify({ sceneId, samples: rows }, null, 2));
        await new Promise((r) => setTimeout(r, 2000));
      }

      perScene[sceneId] = rows.sort((a, b) => a.run - b.run);
    }

    const stats = Object.fromEntries(
      Object.entries(perScene).map(([id, rows]) => [id, sceneStats(rows)])
    );
    const allRows = Object.values(perScene).flat();
    const pooled = sceneStats(allRows);

    writeFileSync(
      OUT_JSON,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          leonId: LEON_ID,
          dataDir: getDataDir(),
          dbApply: dbApply
            ? {
                id: dbApply.id,
                alreadyApplied: dbApply.alreadyApplied,
                bracketTagLineCount: dbApply.bracketTagLineCount,
                dataDir: dbApply.dataDir,
              }
            : null,
          pooled,
          perScene: stats,
          rows: perScene,
        },
        null,
        2
      )
    );

    const md: string[] = [
      "# Prod Leon post-deploy verify (Step 7.6c)",
      "",
      `Generated: ${new Date().toISOString()}`,
      `DATA_DIR: ${getDataDir()}`,
      `Leon id=${LEON_ID} — tagged example_dialog ${dbApply ? (dbApply.alreadyApplied ? "already applied (idempotent check passed)" : "**applied this run**") : "(not touched this run)"}`,
      "EXAMPLE_DIALOG_SCENE_FILTER=1 (verify harness). **Production runtime env must be set separately.**",
      "",
      "## Prod-only pass rate (no mixed comparison)",
      "",
      "| scene | pass rate | drift runs | mean compliance |",
      "|-------|-----------|------------|-----------------|",
    ];
    for (const [id, s] of Object.entries(stats)) {
      md.push(`| ${id} | ${s.passRate}% (${s.passCount}/${s.n}) | ${s.driftCount} | ${s.meanCompliance}% |`);
    }
    md.push(
      `| **pooled** | **${pooled.passRate}%** (${pooled.passCount}/${pooled.n}) | ${pooled.driftCount} | ${pooled.meanCompliance}% |`,
      "",
      "**leon-private-0 note:** low-Δ hard scene — a low absolute pass rate here reflects scene difficulty (staging-path holdout mixed was 16.7%, tagged 25%), not rollout failure. Compare against those baselines, not against bed-scene numbers.",
      ""
    );
    writeFileSync(OUT_MD, md.join("\n"));
    console.log(
      `Prod verify pooled: ${pooled.passCount}/${pooled.n} = ${pooled.passRate}% | ` +
        Object.entries(stats)
          .map(([id, s]) => `${id}: ${s.passRate}%`)
          .join(" | ")
    );
  }

  if (!verify && dbApply) {
    writeFileSync(
      OUT_JSON,
      JSON.stringify({ generatedAt: new Date().toISOString(), dbApply }, null, 2)
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
