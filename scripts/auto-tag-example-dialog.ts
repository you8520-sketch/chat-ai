/**
 * Batch auto-tag example_dialog for DB characters (tagging-only, tone preserved).
 *
 * Pipeline per character (pass-through + periodic batch design):
 *   1. New/changed scan — compares example_dialog content hash against the
 *      last batch state file (output/auto-tag-batch-state.json). Use --all to
 *      ignore the state and rescan everything.
 *   2. Register-pattern classification: heuristic pre-pass, LLM escalation
 *      only for ambiguous cases (no LLM wired yet → ambiguous falls through
 *      to the confidence gate).
 *   3. Confidence gate: confidence < 0.8 OR emotion_based_multi → every
 *      untagged line gets a single [사적] tag (no register-map spread).
 *   4. Format dispatcher: pair-format (유저:/캐:) vs composed char-only block.
 *
 * Output:
 *   - output/auto-tag-example-dialog-report.json — machine report; preserves
 *     the ORIGINAL example_dialog per character for rollback (no schema change).
 *   - Human-readable spot-check summary on stdout (classification + confidence
 *     + gate + tag counts per character).
 *
 * Usage:
 *   npm.cmd exec tsx -- scripts/auto-tag-example-dialog.ts           # dry-run: new/changed only
 *   npm.cmd exec tsx -- scripts/auto-tag-example-dialog.ts --all     # dry-run: all characters
 *   npm.cmd exec tsx -- scripts/auto-tag-example-dialog.ts --id=17   # dry-run: one character
 *   npm.cmd exec tsx -- scripts/auto-tag-example-dialog.ts --apply   # write to LOCAL DB + advance state
 *
 * NEVER run --apply against a non-local DATA_DIR without explicit approval.
 */
import "./lib/server-only-mock";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";
import { autoTagExampleDialogDispatch } from "./lib/autoTagExampleDialog";
import {
  classifyRegisterPattern,
  resolveTagPlan,
  type RegisterPatternClassification,
} from "./lib/registerPatternClassifier";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}
if (!process.env.DATA_DIR) process.env.DATA_DIR = "data";

const argv = process.argv.slice(2);
const apply = argv.includes("--apply");
const scanAll = argv.includes("--all");
const idArg = argv.find((a) => a.startsWith("--id="));
const onlyId = idArg ? Number.parseInt(idArg.split("=")[1] ?? "", 10) : null;

// --apply approved 2026-07-03 after dry-run review (운영 4종 + 더미 검증).
// Rollback: each batch report row preserves original_example_dialog; apply
// reports are additionally archived with a timestamp suffix.

type CharRow = {
  id: number;
  name: string;
  example_dialog: string | null;
  system_prompt: string | null;
  speech_profile: string | null;
};

type BatchState = {
  updatedAt: string;
  characters: Record<string, { exampleDialogHash: string }>;
};

const STATE_PATH = join(process.cwd(), "output", "auto-tag-batch-state.json");

function loadState(): BatchState {
  if (!existsSync(STATE_PATH)) return { updatedAt: "", characters: {} };
  try {
    return JSON.parse(readFileSync(STATE_PATH, "utf8")) as BatchState;
  } catch {
    return { updatedAt: "", characters: {} };
  }
}

function contentHash(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex").slice(0, 16);
}

/** Speech/말투 section from system_prompt card (for register-map classification). */
function extractSpeechSection(systemPrompt: string): string {
  const m = systemPrompt.match(/(?:^|\n)(?:#\s*말투|\[말투\])\s*\n([\s\S]*?)(?=\n(?:#|\[)|$)/);
  return m?.[1] ?? "";
}

function parseForbiddenPatterns(speechProfileJson: string | null): string[] {
  if (!speechProfileJson) return [];
  try {
    const p = JSON.parse(speechProfileJson) as { forbidden_speech_patterns?: unknown };
    return Array.isArray(p.forbidden_speech_patterns)
      ? p.forbidden_speech_patterns.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}

const PATTERN_LABEL: Record<string, string> = {
  single_haeyo: "그룹1 (1-register 해요체)",
  single_banmal: "그룹2 (1-register 반말)",
  single_formal: "그룹1 (1-register 격식체)",
  scene_based_multi: "그룹3 (장소 기반 다중 컨텍스트)",
  emotion_based_multi: "감정 기반 전환 (게이트 대상)",
  unknown: "미분류 (게이트 대상)",
};

async function main() {
  const { getDb } = await import("@/lib/db");
  const { getDataDir } = await import("@/lib/dataDir");
  const db = getDb();
  const state = loadState();

  const rows = (
    db
      .prepare(
        `SELECT id, name, example_dialog, system_prompt, speech_profile FROM characters ORDER BY id`
      )
      .all() as CharRow[]
  ).filter((r) => (onlyId === null ? true : r.id === onlyId));

  const report: Record<string, unknown>[] = [];
  const summaryLines: string[] = [];
  let unchangedSinceLastBatch = 0;
  let skippedEmpty = 0;
  let alreadyTagged = 0;
  let wouldApply = 0;
  let invalid = 0;
  let llmEscalations = 0;

  for (const row of rows) {
    const example = (row.example_dialog ?? "").trim();
    const hash = contentHash(example);

    if (!scanAll && onlyId === null) {
      const prev = state.characters[String(row.id)];
      if (prev && prev.exampleDialogHash === hash) {
        unchangedSinceLastBatch++;
        continue;
      }
    }

    if (!example) {
      skippedEmpty++;
      report.push({ id: row.id, name: row.name, status: "skip_empty" });
      summaryLines.push(`- ${row.name}(id=${row.id}): example_dialog 없음 — 스킵`);
      continue;
    }

    const speechSection = extractSpeechSection(row.system_prompt ?? "");
    const forbidden = parseForbiddenPatterns(row.speech_profile);

    // No LLM wired into the batch yet — ambiguous cases fall to the gate.
    const classification: RegisterPatternClassification = await classifyRegisterPattern({
      exampleDialog: example,
      speechSection,
      forbiddenSpeechPatterns: forbidden,
    });
    if (classification.method !== "heuristic") llmEscalations++;

    const plan = resolveTagPlan(classification);
    const result = autoTagExampleDialogDispatch(example, speechSection, {
      forceTag: plan.mode === "force_private" ? "private" : undefined,
    });

    const summaryHead =
      `- ${row.name}(id=${row.id}): ${PATTERN_LABEL[classification.pattern] ?? classification.pattern}` +
      ` | confidence=${classification.confidence.toFixed(2)} (${classification.method})` +
      (plan.gateTripped ? ` | 게이트 발동 → 단일 [사적]` : "");

    if (!result.changed) {
      alreadyTagged++;
      report.push({
        id: row.id,
        name: row.name,
        status: "already_tagged",
        format: result.format,
        classification,
        gate: plan,
        pairCount: result.pairCount,
        byTag: result.byTag,
        original_example_dialog: example,
      });
      summaryLines.push(`${summaryHead} | 이미 태깅됨 (변경 없음)`);
      continue;
    }

    if (!result.valid) {
      invalid++;
      report.push({
        id: row.id,
        name: row.name,
        status: "invalid_output",
        format: result.format,
        classification,
        gate: plan,
        errors: result.validationErrors,
        original_example_dialog: example,
        preview: result.tagged.slice(0, 240),
      });
      summaryLines.push(`${summaryHead} | !! 검증 실패: ${result.validationErrors[0] ?? ""}`);
      continue;
    }

    if (apply) {
      db.prepare(`UPDATE characters SET example_dialog = ? WHERE id = ?`).run(result.tagged, row.id);
    }
    wouldApply++;
    report.push({
      id: row.id,
      name: row.name,
      status: apply ? "applied" : "would_apply",
      format: result.format,
      classification,
      gate: plan,
      pairCount: result.pairCount,
      alreadyTaggedCount: result.alreadyTaggedCount,
      bySource: result.bySource,
      byTag: result.byTag,
      original_example_dialog: example,
      tagged_example_dialog: result.tagged,
    });
    summaryLines.push(
      `${summaryHead} | ${result.format} 형식, ${result.pairCount}개 단위 태깅 → ${JSON.stringify(result.byTag)}`
    );
  }

  // On apply: advance batch state (post-apply content hashes) so the next
  // new/changed scan only picks up genuinely new or edited characters.
  if (apply) {
    const nextState: BatchState = { updatedAt: new Date().toISOString(), characters: { ...state.characters } };
    const current = db
      .prepare(`SELECT id, example_dialog FROM characters`)
      .all() as { id: number; example_dialog: string | null }[];
    for (const c of current) {
      nextState.characters[String(c.id)] = {
        exampleDialogHash: contentHash((c.example_dialog ?? "").trim()),
      };
    }
    writeFileSync(STATE_PATH, JSON.stringify(nextState, null, 2), "utf8");
  }

  const mode = apply ? "apply" : "dry-run";
  const outDir = join(process.cwd(), "output");
  mkdirSync(outDir, { recursive: true });
  const reportBody = JSON.stringify(
    {
      dataDir: getDataDir(),
      mode,
      generatedAt: new Date().toISOString(),
      scan: scanAll ? "all" : onlyId !== null ? `id=${onlyId}` : "new_or_changed",
      totalCharacters: rows.length,
      unchangedSinceLastBatch,
      candidates: report.length,
      applied: apply ? wouldApply : 0,
      wouldApply,
      skippedEmpty,
      alreadyTagged,
      invalid,
      llmEscalations,
      note: "original_example_dialog per row is the rollback source; apply reports are archived with timestamp suffix",
      rows: report,
    },
    null,
    2
  );
  const outPath = join(outDir, "auto-tag-example-dialog-report.json");
  writeFileSync(outPath, reportBody, "utf8");
  let archivePath: string | null = null;
  if (apply) {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    archivePath = join(outDir, `auto-tag-apply-${ts}.json`);
    writeFileSync(archivePath, reportBody, "utf8");
  }

  console.log(`DATA_DIR=${getDataDir()} | mode=${mode.toUpperCase()} | scan=${scanAll ? "all" : onlyId !== null ? `id=${onlyId}` : "new/changed"}`);
  console.log(
    `characters=${rows.length} unchanged=${unchangedSinceLastBatch} candidates=${report.length} ${apply ? "applied" : "would_apply"}=${wouldApply} already_tagged=${alreadyTagged} skip_empty=${skippedEmpty} invalid=${invalid} llm_escalations=${llmEscalations}`
  );
  console.log("\n[스팟체크 요약]");
  for (const l of summaryLines) console.log(l);
  console.log(`\nWrote ${outPath}`);
  if (archivePath) console.log(`Archived ${archivePath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
