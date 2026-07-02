/**
 * Step 7.5 — Register patch A/B/C/D isolated validation (Leon + Ren × 20).
 *
 * Usage:
 *   set REGISTER_PATCH=A
 *   npm.cmd exec tsx -- scripts/step75-register-patch-validation.ts --generate
 *   npm.cmd exec tsx -- scripts/step75-register-patch-validation.ts --patch step43 --generate
 *   npm.cmd exec tsx -- scripts/step75-register-patch-validation.ts --all-patches
 */
import "./lib/server-only-mock";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";
import type { RegisterPatchId } from "@/lib/registerPatchExperiment";
import { evaluateRegisterCompliance } from "@/lib/characterRegisterCompliance";
import { evaluateStep73Sample } from "@/lib/registerMetaAudit";
import { evaluateStyleQuality } from "./lib/style-quality-evaluation";
import { auditWebnovelStyleText } from "./lib/webnovel-style-audit";
import {
  REGISTER_VALIDATION_SCENES,
  buildRegisterValidationContext,
} from "./lib/leon-ren-register-fixtures";
import { OPENROUTER_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";
import { resolveDeepSeekTemperatureForTarget } from "@/lib/openRouterClient";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const OUT_DIR = join(process.cwd(), "output");
const PATCHES: RegisterPatchId[] = ["none", "step43", "A", "B", "C", "D"];

type SampleRow = {
  id: string;
  character: string;
  expectedRegister: string;
  text: string;
  compliance: number;
  registerDrift: boolean;
  metaPass: boolean;
  humanProxy: number;
  aiSmell: number;
};

type PatchSummary = {
  patch: RegisterPatchId;
  samples: SampleRow[];
  avgCompliance: number;
  driftRate: number;
  metaPassRate: number;
  avgHuman: number;
  avgAiSmell: number;
};

function outPath(patch: RegisterPatchId) {
  return join(OUT_DIR, `step75-register-patch-${patch}.json`);
}

function mdPath() {
  return join(OUT_DIR, "step75-register-patch-validation.md");
}

async function generateOne(sceneId: string, attempt = 1): Promise<string> {
  const scene = REGISTER_VALIDATION_SCENES.find((s) => s.id === sceneId);
  if (!scene) throw new Error(`Unknown scene ${sceneId}`);

  const { callOpenRouterCompletion } = await import("@/lib/openRouterCompletion");
  const { buildContext } = await import("@/services/contextBuilder");
  const built = buildContext(buildRegisterValidationContext(scene));

  try {
    const res = await callOpenRouterCompletion({
      system: built.systemPrompt,
      history: built.history,
      model: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
      temperature: resolveDeepSeekTemperatureForTarget(3200),
      maxTokens: 4096,
      requestKind: "step75-register-patch",
    });
    return res.text.trim();
  } catch (err) {
    if (attempt >= 3) throw err;
    console.warn(`Retry ${sceneId} (${attempt}/3)`);
    await new Promise((r) => setTimeout(r, 3000 * attempt));
    return generateOne(sceneId, attempt + 1);
  }
}

function measure(scene: (typeof REGISTER_VALIDATION_SCENES)[0], text: string): SampleRow {
  const comp = evaluateRegisterCompliance(text, scene.expectedRegister);
  const reg = evaluateStep73Sample(scene.id, text, scene.genres);
  const quality = evaluateStyleQuality(text);
  const audit = auditWebnovelStyleText(text, { messageId: 0, chatId: 0 });

  return {
    id: scene.id,
    character: scene.character,
    expectedRegister: scene.expectedRegister,
    text,
    compliance: comp.complianceRate,
    registerDrift: comp.driftKinds.length > 0 || reg.registerSwitching === "FAIL",
    metaPass: reg.metaNarration === "PASS",
    humanProxy: quality.scores.humanProxyOverall,
    aiSmell: audit.raw.connectorSpamScore + audit.raw.emotionLabelCount,
  };
}

async function runPatch(patch: RegisterPatchId, doGenerate: boolean): Promise<PatchSummary> {
  if (patch === "none") {
    process.env.REGISTER_PATCH = "none";
  } else {
    process.env.REGISTER_PATCH = patch;
  }

  const samples: SampleRow[] = [];
  const jsonPath = outPath(patch);
  const existingIds = new Set<string>();

  if (existsSync(jsonPath)) {
    try {
      const j = JSON.parse(readFileSync(jsonPath, "utf8")) as { samples?: SampleRow[] };
      for (const s of j.samples ?? []) {
        const scene = REGISTER_VALIDATION_SCENES.find((x) => x.id === s.id);
        if (!scene || !s.text) continue;
        samples.push({ ...measure(scene, s.text), text: s.text });
        existingIds.add(s.id);
      }
    } catch {
      /* fresh run */
    }
  }

  if (doGenerate) {
    for (const scene of REGISTER_VALIDATION_SCENES) {
      if (existingIds.has(scene.id)) {
        console.log(`[${patch}] Skip ${scene.id} (cached)`);
        continue;
      }
      console.log(`[${patch}] ${scene.id}…`);
      const text = await generateOne(scene.id);
      samples.push({ ...measure(scene, text), text });
      writeFileSync(jsonPath, JSON.stringify({ patch, generatedAt: new Date().toISOString(), samples }, null, 2));
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  const n = samples.length || 1;
  return {
    patch,
    samples,
    avgCompliance: samples.reduce((a, s) => a + s.compliance, 0) / n,
    driftRate: samples.filter((s) => s.registerDrift).length / (samples.length || 1),
    metaPassRate: samples.filter((s) => s.metaPass).length / (samples.length || 1),
    avgHuman: samples.reduce((a, s) => a + s.humanProxy, 0) / n,
    avgAiSmell: samples.reduce((a, s) => a + s.aiSmell, 0) / n,
  };
}

function renderReport(summaries: PatchSummary[], step43Compliance: number) {
  const lines = [
    "# Step 7.5 — Register Patch Validation (Leon + Ren)",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Summary",
    "",
    "| Patch | avg compliance % | drift rate | meta pass | human proxy | AI smell |",
    "|-------|------------------|------------|-----------|-------------|----------|",
    ...summaries.map(
      (s) =>
        `| ${s.patch} | ${s.avgCompliance.toFixed(1)} | ${(s.driftRate * 100).toFixed(0)}% | ${(s.metaPassRate * 100).toFixed(0)}% | ${s.avgHuman.toFixed(1)} | ${s.avgAiSmell.toFixed(1)} |`
    ),
    "",
    `**Step 4.3 baseline (step43 patch):** ${step43Compliance.toFixed(1)}% avg compliance`,
    "",
    "## Acceptance (10-pair subset — first 10 scenes)",
    "",
  ];

  for (const s of summaries) {
    const sub = s.samples.slice(0, 10);
    const avg = sub.length ? sub.reduce((a, x) => a + x.compliance, 0) / sub.length : 0;
    const pass =
      avg >= step43Compliance &&
      sub.every((x) => x.humanProxy >= 4) &&
      sub.reduce((a, x) => a + x.aiSmell, 0) / (sub.length || 1) <= 8;
    lines.push(`- **${s.patch}:** 10-pair compliance ${avg.toFixed(1)}% — ${pass ? "PASS" : "FAIL"}`);
  }

  lines.push("", "## Per-scene (latest patch run)", "");
  const latest = summaries.filter((s) => s.samples.length > 0).pop();
  if (latest) {
    lines.push("| id | char | expected | compliance | drift | meta | human | smell |");
    lines.push("|----|------|----------|------------|-------|------|-------|-------|");
    for (const r of latest.samples) {
      lines.push(
        `| ${r.id} | ${r.character} | ${r.expectedRegister} | ${r.compliance}% | ${r.registerDrift ? "Y" : "N"} | ${r.metaPass ? "PASS" : "FAIL"} | ${r.humanProxy.toFixed(1)} | ${r.aiSmell.toFixed(1)} |`
      );
    }
  }

  return lines.join("\n");
}

async function main() {
  const doGenerate = process.argv.includes("--generate");
  const allPatches = process.argv.includes("--all-patches");
  const patchArg = process.argv.find((a) => a.startsWith("--patch="))?.split("=")[1] as
    | RegisterPatchId
    | undefined;

  const toRun: RegisterPatchId[] = allPatches
    ? PATCHES
    : [patchArg ?? (process.env.REGISTER_PATCH as RegisterPatchId) ?? "none"];

  mkdirSync(OUT_DIR, { recursive: true });
  const summaries: PatchSummary[] = [];

  for (const patch of toRun) {
    const cachedCount = existsSync(outPath(patch))
      ? (JSON.parse(readFileSync(outPath(patch), "utf8")) as { samples?: unknown[] }).samples?.length ?? 0
      : 0;
    const generateThis =
      doGenerate &&
      (allPatches ? cachedCount < REGISTER_VALIDATION_SCENES.length : true);
    summaries.push(await runPatch(patch, generateThis));
  }

  const step43 = summaries.find((s) => s.patch === "step43");
  if (!step43 && !summaries.some((s) => s.patch === "step43")) {
    summaries.unshift(await runPatch("step43", false));
  }
  const step43Compliance =
    summaries.find((s) => s.patch === "step43")?.avgCompliance ??
    (await runPatch("step43", false)).avgCompliance;

  if (allPatches && !doGenerate) {
    for (const patch of PATCHES) {
      if (summaries.some((s) => s.patch === patch)) continue;
      summaries.push(await runPatch(patch, false));
    }
    summaries.sort((a, b) => PATCHES.indexOf(a.patch) - PATCHES.indexOf(b.patch));
  }

  writeFileSync(mdPath(), renderReport(summaries, step43Compliance));
  console.log(`Report: ${mdPath()}`);

  const ranked = summaries
    .filter((s) => s.patch !== "none" && s.patch !== "step43" && s.samples.length > 0)
    .sort((a, b) => b.avgCompliance - a.avgCompliance);
  if (ranked[0]) {
    console.log(
      `Best patch: ${ranked[0].patch} compliance=${ranked[0].avgCompliance.toFixed(1)}% human=${ranked[0].avgHuman.toFixed(1)}`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
