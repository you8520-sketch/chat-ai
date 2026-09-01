#!/usr/bin/env node
/**
 * PR #808 — Real image provider A/B benchmark (6 calls max).
 * Arm A: legacy formatApprovedScenePlanForComic panel prose
 * Arm B: production structured compileChatComicPanelSpec panel spec
 *
 * Run: node --conditions=react-server --import tsx scripts/run-comic-panel-spec-provider-ab.ts
 * Requires CHEAPER_INFERENCE_API_KEY. Does not charge app user points.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildChatComicGenerationPlan,
  buildChatComicImagePrompt,
  CHAT_COMIC_TEMPLATE_PREVIEW_URL,
  resolveChatComicOutputSize,
  type ChatComicMood,
} from "@/lib/chatComicGeneration";
import { buildChatComicPanelSpecPromptSection } from "@/lib/chatComicPanelSpec";
import {
  COMIC_PANEL_BENCHMARK_FIXTURES,
  scenePlanForFixture,
} from "@/lib/chatComicPanelSpec.fixtures";
import { resolveChatImageGenerationModel } from "@/lib/chatImageGeneration";
import {
  formatApprovedScenePlanForComic,
  type ScenePlan,
} from "@/lib/chatImageScenePlan";
import {
  productionReferenceOwnerMap,
} from "@/lib/chatImagePromptSubjectMap";
import {
  callImageEdit,
  OpenAiImageError,
  resolveImageEditTransportConfig,
} from "@/lib/openAiImageEdit";

const ROOT = process.cwd();
const OUT_DIR = join("/opt/cursor/artifacts", "comic-panel-spec-provider-ab");
const STATIC_REVIEWED_HEAD = "5c1f0beb63ca522cb725bbc1714c0e8acd0610f9";

const MODEL = resolveChatImageGenerationModel();
const QUALITY = "medium" as const;
const OUTPUT_COMPRESSION = 84;
const SEED_SUPPORT = false;

type Arm = "A_LEGACY" | "B_STRUCTURED";

type TestDef = {
  testId: string;
  fixtureId: string;
  panelCount: 2 | 3 | 4;
  mood: ChatComicMood;
};

const TESTS: TestDef[] = [
  { testId: "T1_2P", fixtureId: "F01-2panel-invite", panelCount: 2, mood: "daily" },
  { testId: "T2_3P", fixtureId: "F04-3koma-rain", panelCount: 3, mood: "daily" },
  { testId: "T3_4P", fixtureId: "F08-4panel-chase", panelCount: 4, mood: "daily" },
];

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function fileToDataUrl(absPath: string, mime = "image/webp"): string {
  const buf = readFileSync(absPath);
  return `data:${mime};base64,${buf.toString("base64")}`;
}

function loadBenchmarkReferences(): {
  templateDataUrl: string;
  characterDataUrl: string;
  personaDataUrl: string;
  referenceIdentifiers: string[];
} {
  const templatePath = join(ROOT, "public/image-templates/comic-vertical-sample-hq.webp");
  const characterPath = join(ROOT, "docs/audits/chat-image-multicast-674/smoke/ref-main.webp");
  const personaPath = join(ROOT, "docs/audits/chat-image-multicast-674/smoke/ref-persona.webp");
  return {
    templateDataUrl: fileToDataUrl(templatePath),
    characterDataUrl: fileToDataUrl(characterPath),
    personaDataUrl: fileToDataUrl(personaPath),
    referenceIdentifiers: [
      "public/image-templates/comic-vertical-sample-hq.webp",
      "docs/audits/chat-image-multicast-674/smoke/ref-main.webp",
      "docs/audits/chat-image-multicast-674/smoke/ref-persona.webp",
    ],
  };
}

function resolveReferenceDataUrls(referenceUrls: readonly string[], refs: ReturnType<typeof loadBenchmarkReferences>): string[] {
  return referenceUrls.map((url) => {
    if (url.startsWith("data:")) return url;
    if (url === CHAT_COMIC_TEMPLATE_PREVIEW_URL) return refs.templateDataUrl;
    if (url.includes("ref-main") || url === refs.characterDataUrl) return refs.characterDataUrl;
    if (url.includes("ref-persona") || url === refs.personaDataUrl) return refs.personaDataUrl;
    if (url.startsWith("/image-templates/")) {
      return fileToDataUrl(join(ROOT, "public", url.slice(1)));
    }
    throw new Error(`unresolved reference url: ${url}`);
  });
}

function buildStructuredPlan(opts: {
  plan: ScenePlan;
  characterName: string;
  personaName: string;
  mood: ChatComicMood;
  characterDataUrl: string;
  personaDataUrl: string;
}) {
  return buildChatComicGenerationPlan({
    characterName: opts.characterName,
    characterGender: "male",
    personaName: opts.personaName,
    personaGender: "female",
    characterImageUrl: opts.characterDataUrl,
    characterSavedAppearance: "",
    characterAppearanceMode: "image_only",
    personaImageUrl: opts.personaDataUrl,
    personaSavedAppearance: "",
    personaAppearanceMode: "image_only",
    mood: opts.mood,
    plan: opts.plan,
  });
}

function buildLegacyArmPrompt(opts: {
  plan: ScenePlan;
  characterName: string;
  personaName: string;
  mood: ChatComicMood;
  subjects: ReturnType<typeof buildStructuredPlan>["subjects"];
}): string {
  const structuredPrompt = buildChatComicImagePrompt({
    characterName: opts.characterName,
    characterGender: "male",
    personaName: opts.personaName,
    personaGender: "female",
    mood: opts.mood,
    plan: opts.plan,
    subjects: opts.subjects,
    characterImageUrl: "inline-character-ref",
    personaImageUrl: "inline-persona-ref",
  });
  const structuredSection = buildChatComicPanelSpecPromptSection({
    plan: opts.plan,
    personaName: opts.personaName,
    characterName: opts.characterName,
    subjects: opts.subjects,
  });
  const legacySection = formatApprovedScenePlanForComic(opts.plan);
  if (!structuredPrompt.includes(structuredSection)) {
    throw new Error("structured panel section not found in production prompt — A/B parity broken");
  }
  return structuredPrompt.replace(structuredSection, legacySection);
}

type CallRecord = {
  testId: string;
  arm: Arm;
  fileBase: string;
  provider: string;
  model: string;
  quality: string;
  outputSize: string;
  seedSupport: boolean;
  seed: null;
  referenceOrder: string[];
  sourceFixture: string;
  panelCount: number;
  mood: ChatComicMood;
  finalPromptSha256: string;
  finalPromptPath: string;
  referenceIdentifiers: string[];
  productionReferenceMap: Array<{ image: number; owner: string }>;
  startedAt: string;
  finishedAt: string | null;
  latencyMs: number | null;
  costUsd: number | null;
  httpStatus: number | "blocked" | "error";
  resultImagePath: string | null;
  error: string | null;
  flags: {
    EXACT_PANEL_COUNT: "true" | "false" | "uncertain";
    EXPECTED_TEXT_ONLY: "true" | "false" | "uncertain";
    EXTRA_TEXT: "true" | "false" | "uncertain";
    CHARACTER_IDENTITY_STABLE: "PENDING_GPT_HUMAN";
    PERSONA_IDENTITY_STABLE: "PENDING_GPT_HUMAN";
    SPEAKER_BUBBLE_OWNERSHIP: "PENDING_GPT_HUMAN";
    ACTION_OWNERSHIP: "PENDING_GPT_HUMAN";
  };
};

async function executeCall(opts: {
  test: TestDef;
  arm: Arm;
  prompt: string;
  referenceDataUrls: string[];
  refs: ReturnType<typeof loadBenchmarkReferences>;
  productionMap: Array<{ image: number; owner: string }>;
  fixtureId: string;
  characterName: string;
  personaName: string;
}): Promise<CallRecord> {
  const fileBase =
    opts.arm === "A_LEGACY"
      ? `${opts.test.testId}_A_LEGACY`
      : `${opts.test.testId}_B_STRUCTURED`;
  const outputSize = resolveChatComicOutputSize(opts.test.panelCount);
  const promptPath = join(OUT_DIR, `${fileBase}-prompt.txt`);
  writeFileSync(promptPath, opts.prompt, "utf8");

  const transport = resolveImageEditTransportConfig();
  const record: CallRecord = {
    testId: opts.test.testId,
    arm: opts.arm,
    fileBase,
    provider: transport.provider,
    model: MODEL,
    quality: QUALITY,
    outputSize,
    seedSupport: SEED_SUPPORT,
    seed: null,
    referenceOrder: opts.refs.referenceIdentifiers,
    sourceFixture: opts.fixtureId,
    panelCount: opts.test.panelCount,
    mood: opts.test.mood,
    finalPromptSha256: sha256(opts.prompt),
    finalPromptPath: promptPath,
    referenceIdentifiers: opts.refs.referenceIdentifiers,
    productionReferenceMap: opts.productionMap,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    latencyMs: null,
    costUsd: null,
    httpStatus: "blocked",
    resultImagePath: null,
    error: null,
    flags: {
      EXACT_PANEL_COUNT: "uncertain",
      EXPECTED_TEXT_ONLY: "uncertain",
      EXTRA_TEXT: "uncertain",
      CHARACTER_IDENTITY_STABLE: "PENDING_GPT_HUMAN",
      PERSONA_IDENTITY_STABLE: "PENDING_GPT_HUMAN",
      SPEAKER_BUBBLE_OWNERSHIP: "PENDING_GPT_HUMAN",
      ACTION_OWNERSHIP: "PENDING_GPT_HUMAN",
    },
  };

  const started = Date.now();
  try {
    const result = await callImageEdit({
      model: MODEL,
      prompt: opts.prompt,
      references: opts.referenceDataUrls,
      size: outputSize,
      quality: QUALITY,
      outputCompression: OUTPUT_COMPRESSION,
    });
    const imagePath = join(OUT_DIR, `${fileBase}.webp`);
    writeFileSync(imagePath, result.buffer);
    record.resultImagePath = imagePath;
    record.costUsd = result.costUsd;
    record.httpStatus = 200;
    record.latencyMs = Date.now() - started;
    record.finishedAt = new Date().toISOString();
  } catch (error) {
    record.latencyMs = Date.now() - started;
    record.finishedAt = new Date().toISOString();
    if (error instanceof OpenAiImageError) {
      record.httpStatus = error.status;
      record.error = error.message;
    } else {
      record.httpStatus = "error";
      record.error = error instanceof Error ? error.message : String(error);
    }
  }

  writeFileSync(join(OUT_DIR, `${fileBase}-metadata.json`), JSON.stringify(record, null, 2));
  return record;
}

function buildReviewPacket(records: CallRecord[], prHead: string): string {
  const successful = records.filter((r) => r.resultImagePath);
  const totalCost = records.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
  const latencies = records.filter((r) => r.latencyMs != null).map((r) => r.latencyMs!);
  const avgLatency =
    latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null;

  const lines: string[] = [
    "# REAL PROVIDER A/B REVIEW PACKET — PR #808",
    "",
    `- **STATIC REVIEWED HEAD:** \`${STATIC_REVIEWED_HEAD}\``,
    `- **BENCHMARK PR HEAD:** \`${prHead}\``,
    `- **PROVIDER:** CheaperInference (\`${resolveImageEditTransportConfig().endpointUrl}\`)`,
    `- **PRODUCTION_TRANSPORT_PATH_USED:** true`,
    `- **MODEL:** ${MODEL}`,
    `- **QUALITY:** ${QUALITY}`,
    `- **OUTPUT COMPRESSION:** ${OUTPUT_COMPRESSION}`,
    `- **SEED_SUPPORT:** ${SEED_SUPPORT}`,
    `- **CALL BUDGET:** 6 maximum`,
    `- **PROVIDER_IMAGE_CALL_COUNT:** ${successful.length} / 6`,
    `- **RETRY_COUNT:** 0`,
    `- **REFERENCE_PARITY:** true (same template + smoke refs per pair)`,
    `- **OPTION_PARITY:** true (model/quality/size/mood/refs matched A↔B)`,
    `- **PRODUCTION_PROMPT_PATH_USED:** true (Arm B = buildChatComicGenerationPlan; Arm A = same shell + legacy panel section)`,
    `- **CODE_CHANGED_DURING_BENCHMARK:** false`,
    "",
    "## Cost / latency",
    "",
    `- **TOTAL_UPSTREAM_COST_USD:** ${totalCost > 0 ? totalCost.toFixed(6) : "n/a"}`,
    `- **AVERAGE_LATENCY_MS:** ${avgLatency ?? "n/a"}`,
    "",
    "## NO RETRIES CONFIRMATION",
    "",
    "RETRY_COUNT=0. Failed calls are recorded as-is; no replacement calls.",
    "",
    "**GPT_SCORE:** PENDING",
    "**HUMAN_SCORE:** PENDING",
    "",
  ];

  for (const test of TESTS) {
    lines.push(`## ${test.testId} (${test.panelCount} panels, mood=${test.mood})`);
    lines.push("");
    for (const arm of ["A_LEGACY", "B_STRUCTURED"] as const) {
      const rec = records.find((r) => r.testId === test.testId && r.arm === arm);
      if (!rec) continue;
      lines.push(`### ${rec.fileBase}`);
      lines.push("");
      lines.push(`- ARM: ${rec.arm}`);
      lines.push(`- SOURCE_FIXTURE: ${rec.sourceFixture}`);
      lines.push(`- FINAL_PROMPT_SHA256: \`${rec.finalPromptSha256}\``);
      lines.push(`- REFERENCE_ORDER: ${rec.referenceOrder.join(" → ")}`);
      lines.push(`- PRODUCTION_REFERENCE_MAP:`);
      for (const ref of rec.productionReferenceMap) {
        lines.push(`  - Image ${ref.image} → ${ref.owner}`);
      }
      lines.push(`- HTTP_STATUS: ${rec.httpStatus}`);
      lines.push(`- LATENCY_MS: ${rec.latencyMs ?? "n/a"}`);
      lines.push(`- COST_USD: ${rec.costUsd ?? "n/a"}`);
      if (rec.error) lines.push(`- ERROR: ${rec.error}`);
      if (rec.resultImagePath) {
        lines.push(`- RESULT: ${rec.resultImagePath}`);
      }
      lines.push("");
      lines.push("#### FINAL_PROMPT (untruncated)");
      lines.push("");
      lines.push("```text");
      lines.push(readFileSync(rec.finalPromptPath, "utf8"));
      lines.push("```");
      lines.push("");
      lines.push("#### OBJECTIVE FLAGS (no subjective score)");
      lines.push("");
      lines.push("```json");
      lines.push(JSON.stringify(rec.flags, null, 2));
      lines.push("```");
      lines.push("");
    }
  }

  return lines.join("\n");
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const refs = loadBenchmarkReferences();
  const records: CallRecord[] = [];

  for (const test of TESTS) {
    const fixture = COMIC_PANEL_BENCHMARK_FIXTURES.find((f) => f.id === test.fixtureId);
    if (!fixture) throw new Error(`missing fixture ${test.fixtureId}`);
    const plan = scenePlanForFixture(fixture);
    const structured = buildStructuredPlan({
      plan,
      characterName: fixture.expectedCast.character,
      personaName: fixture.expectedCast.persona,
      mood: test.mood,
      characterDataUrl: refs.characterDataUrl,
      personaDataUrl: refs.personaDataUrl,
    });
    const referenceDataUrls = resolveReferenceDataUrls(structured.referenceUrls, refs);
    const productionMap = productionReferenceOwnerMap({
      referenceUrls: structured.referenceUrls,
      subjects: structured.subjects,
      templateUrl: CHAT_COMIC_TEMPLATE_PREVIEW_URL,
    });

    const legacyPrompt = buildLegacyArmPrompt({
      plan,
      characterName: fixture.expectedCast.character,
      personaName: fixture.expectedCast.persona,
      mood: test.mood,
      subjects: structured.subjects,
    });

    records.push(
      await executeCall({
        test,
        arm: "A_LEGACY",
        prompt: legacyPrompt,
        referenceDataUrls,
        refs,
        productionMap,
        fixtureId: fixture.id,
        characterName: fixture.expectedCast.character,
        personaName: fixture.expectedCast.persona,
      })
    );
    records.push(
      await executeCall({
        test,
        arm: "B_STRUCTURED",
        prompt: structured.prompt,
        referenceDataUrls,
        refs,
        productionMap,
        fixtureId: fixture.id,
        characterName: fixture.expectedCast.character,
        personaName: fixture.expectedCast.persona,
      })
    );
  }

  const prHead = process.env.GIT_HEAD?.trim() || "unknown";
  const packet = buildReviewPacket(records, prHead);
  writeFileSync(join(OUT_DIR, "REAL_PROVIDER_AB_REVIEW_PACKET.md"), packet, "utf8");
  writeFileSync(
    join(OUT_DIR, "RUN_SUMMARY.json"),
    JSON.stringify(
      {
        staticReviewedHead: STATIC_REVIEWED_HEAD,
        prHead,
        providerImageCallCount: records.filter((r) => r.resultImagePath).length,
        retryCount: 0,
        seedSupport: SEED_SUPPORT,
        records: records.map((r) => ({
          fileBase: r.fileBase,
          httpStatus: r.httpStatus,
          error: r.error,
          latencyMs: r.latencyMs,
          costUsd: r.costUsd,
        })),
      },
      null,
      2
    )
  );

  console.log(`Wrote ${OUT_DIR}/REAL_PROVIDER_AB_REVIEW_PACKET.md`);
  const successCount = records.filter((r) => r.resultImagePath).length;
  if (successCount === 0) {
    const credentialBlocked = records.every((r) => r.error?.includes("API 키"));
    console.error(
      credentialBlocked
        ? "All provider calls blocked — CHEAPER_INFERENCE_API_KEY required for real generation."
        : `All ${records.length} provider calls completed with zero successful images — see metadata for errors.`
    );
    process.exit(2);
  }
}

void main();
