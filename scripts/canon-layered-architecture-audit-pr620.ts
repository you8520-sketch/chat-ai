/**
 * PROMPT/RUNTIME canon architecture audit — PR620 라이크/렌 capsule.
 * ARM F = FULL_LEGACY wire (code-default policy, no CanonPlan).
 * ARM L = existing LAYERED (forced D3 canary policy + compiled CanonPlan).
 *
 *   MAIN_SHA=$(git rev-parse origin/main) HEAD_SHA=$(git rev-parse HEAD) \
 *   LABEL=canon-layered-audit-pr620 REPS=2 \
 *   npx tsx scripts/canon-layered-architecture-audit-pr620.ts
 */
import "./lib/server-only-mock";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { loadEnvLocal } from "./load-env-local";
import {
  exitIfBenchmarkCheaperInferenceApiKeyMissing,
  sanitizeBenchmarkCredentialText,
} from "./lib/benchmarkCheaperInferenceCredential";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  OPENROUTER_DEEPSEEK_V4_PRO_0813_BACKUP_MODEL,
} from "../src/lib/chatModels";
import {
  MAX_MAIN_RP_PROVIDER_CALLS_PER_TURN,
  TURN_LENGTH_SUPPLEMENT_API_ENABLED,
} from "../src/lib/turnApiBudget";
import type { CanonInjectionPolicy } from "../src/lib/canonInjectionPolicy";
import { resolveCanonInjectionPolicy } from "../src/lib/canonInjectionPolicy";
import { compileCanonPlanV1, canonCoreInflationMetrics } from "../src/lib/canonPlan/compiler";
import { selectActiveCanonChunks } from "../src/lib/canonPlan/activeSelector";
import { renderCoreCanonBlock } from "../src/lib/canonPlan/coreRenderer";
import type { CanonPlanV1, CanonPlanChunk } from "../src/lib/canonPlan/types";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const LABEL = process.env.LABEL?.trim() || "canon-layered-audit-pr620";
const REPO_OUT = path.join(
  process.cwd(),
  "docs/audits/canon-layered-architecture-audit-2026-09-27",
);
const ARTIFACT_OUT = path.join("/opt/cursor/artifacts", LABEL);
const REPS = Math.max(1, Math.min(2, Number(process.env.REPS ?? 2) || 2));
const SKIP_LIVE = process.env.SKIP_LIVE === "1";
const CAPSULE_ROOT = path.join(
  process.cwd(),
  "docs/audits/real-production-mid-chat-style-handoff-benchmark",
);
const ORIGIN_MAIN_SHA =
  process.env.MAIN_SHA?.trim() || "4aeaa008c068ff708883a2a01b57dc1c23cb91ab";

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function writeBoth(rel: string, content: string | object) {
  const text =
    typeof content === "string" ? content : JSON.stringify(content, null, 2);
  for (const root of [REPO_OUT, ARTIFACT_OUT]) {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text, "utf8");
  }
}

function readUtf8(rel: string): string {
  const p = path.join(CAPSULE_ROOT, rel);
  if (!fs.existsSync(p)) throw new Error(`Missing PR620 source: ${rel}`);
  return fs.readFileSync(p, "utf8");
}

function extractPromptDumpSection(dump: string, sectionId: string): string {
  const marker = `### [${sectionId}]`;
  const start = dump.indexOf(marker);
  if (start < 0) throw new Error(`prompt dump section missing: ${sectionId}`);
  const afterHeader = dump.indexOf("\n", start);
  const rest = dump.slice(afterHeader + 1);
  const next = rest.search(/\n### \[/);
  const body = next >= 0 ? rest.slice(0, next) : rest;
  return body.trim();
}

function extractUserPersonaBlock(identitySection: string): string {
  const m = identitySection.match(/\[USER_PERSONA\]([\s\S]*?)(?=\n\[|$)/);
  if (!m?.[1]?.trim()) throw new Error("USER_PERSONA block not found in identity section");
  return m[1].trim();
}

function flatContent(c: unknown): string {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .map((p) =>
        p && typeof p === "object" && "text" in p
          ? String((p as { text: unknown }).text)
          : "",
      )
      .join("");
  }
  return "";
}

function sectionChars(built: { meta: { trackedSections?: Array<{ id: string; text: string }> } }, id: string): number {
  const s = built.meta.trackedSections?.find((x) => x.id === id);
  return s?.text.length ?? 0;
}

function forcedLayeredPolicy(modelId: string): CanonInjectionPolicy {
  return {
    modelId,
    injectionEnabled: true,
    shadowOnly: false,
    canonMode: "LAYERED",
    archiveMode: "SELECTIVE",
    rolloutStage: "D3",
    forceFullLegacy: false,
    canaryActualInjection: true,
    actualCanonMode: "LAYERED",
    actualArchiveMode: "SELECTIVE",
    masterCanaryEnabled: true,
    canaryPercent: 100,
    cohortEligible: true,
    cohortBucket: 0,
    cohortEligibilityReason: "audit-harness-forced",
  };
}

function classifyChunkRow(c: CanonPlanChunk, coreSet: Set<string>): Record<string, unknown> {
  const isCore = coreSet.has(c.id);
  let classification: string;
  if (isCore) classification = "CORE";
  else if (c.salience === "dormant") classification = "dormant";
  else if (c.visibility !== "public") classification = "private/conditional";
  else classification = "ACTIVE_candidate";

  const flags: string[] = [];
  if (isCore && c.text.length > 400) flags.push("CORE_OVERCLASSIFICATION_CANDIDATE");

  return {
    id: c.id,
    sectionTitle: c.sectionTitle,
    classification,
    salience: c.salience,
    bucket: c.bucket,
    visibility: c.visibility,
    chars: c.text.length,
    alwaysInjected: isCore,
    heuristicOwner: isCore ? "compiler.inferSalience→coreIds" : "activeSelector (if selected)",
    flags,
    textPreview: c.text.slice(0, 120).replace(/\s+/g, " "),
  };
}

type Capture = {
  text: string;
  finish: string | null;
  usage: Record<string, unknown> | null;
  error: string | null;
  status: number;
  latencyMs: number;
};

async function streamOnce(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<Capture> {
  const started = Date.now();
  const out: Capture = {
    text: "",
    finish: null,
    usage: null,
    error: null,
    status: 0,
    latencyMs: 0,
  };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12 * 60 * 1000),
    });
    out.status = res.status;
    if (!res.ok || !res.body) {
      out.error = sanitizeBenchmarkCredentialText((await res.text()).slice(0, 1500));
      out.latencyMs = Date.now() - started;
      return out;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    const handle = (line: string) => {
      const t = line.trim();
      if (!t.startsWith("data:")) return;
      const data = t.slice(5).trim();
      if (!data || data === "[DONE]") return;
      try {
        const ev = JSON.parse(data) as Record<string, unknown>;
        const choice = (ev.choices as Array<Record<string, unknown>> | undefined)?.[0];
        const delta = (choice?.delta ?? {}) as Record<string, unknown>;
        if (typeof delta.content === "string") out.text += delta.content;
        if (typeof choice?.finish_reason === "string" && choice.finish_reason) {
          out.finish = choice.finish_reason;
        }
        if (ev.usage && typeof ev.usage === "object") {
          out.usage = ev.usage as Record<string, unknown>;
        }
      } catch {
        // partial frame
      }
    };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      lines.forEach(handle);
    }
    buf += dec.decode();
    if (buf.trim()) handle(buf);
  } catch (e) {
    out.error = sanitizeBenchmarkCredentialText(String(e)).slice(0, 1500);
  }
  out.latencyMs = Date.now() - started;
  return out;
}

const LEAKAGE_PATTERNS: Array<{ category: string; patterns: RegExp[] }> = [
  { category: "CANON_EXPOSITION", patterns: [/S\+?급\s*특수계\s*센티넬/i, /11년\s*차/i] },
  { category: "CANON_EXPOSITION", patterns: [/188\s*cm/i, /녹(?:색)?\s*안/i] },
  { category: "CANON_EXPOSITION", patterns: [/검은\s*네일/i, /전자\s*초커/i, /피어싱/i] },
  { category: "WORLD_LORE_DUMP", patterns: [/ACB\s*한국/i, /스트라이크\s*디비전/i] },
  { category: "PHYSIOLOGY_DISPLACES_EMOTION", patterns: [/도파민|교감\s*신경|신경\s*계/i] },
  { category: "PERSONA_EXPOSITION", patterns: [/렌(?:은|이)\s*(?:두려|겁|무서|경계).{0,12}(?:없|적)/i] },
];

function semanticLeakageFlags(text: string): Array<{ category: string; excerpt: string }> {
  const flags: Array<{ category: string; excerpt: string }> = [];
  for (const row of LEAKAGE_PATTERNS) {
    for (const p of row.patterns) {
      const m = p.exec(text);
      if (m?.index != null) {
        const start = Math.max(0, m.index - 30);
        flags.push({
          category: row.category,
          excerpt: text.slice(start, start + 100).replace(/\s+/g, " ").trim(),
        });
        break;
      }
    }
  }
  return flags;
}

async function main() {
  if (TURN_LENGTH_SUPPLEMENT_API_ENABLED !== false) {
    throw new Error("expected TURN_LENGTH_SUPPLEMENT_API_ENABLED=false");
  }
  if (MAX_MAIN_RP_PROVIDER_CALLS_PER_TURN !== 1) {
    throw new Error("expected MAX_MAIN_RP_PROVIDER_CALLS_PER_TURN=1");
  }

  writeBoth("git-baseline.json", {
    originMainSha: ORIGIN_MAIN_SHA,
    headSha: process.env.HEAD_SHA?.trim() || "unknown",
    recordedAt: new Date().toISOString(),
  });

  const promptDumpT1 = readUtf8("requests/T1-prompt_dump.txt");
  const characterCoreWire = extractPromptDumpSection(promptDumpT1, "character-core-identity");
  const identityRules = extractPromptDumpSection(promptDumpT1, "identity-and-rules");
  const privateSpeech = extractPromptDumpSection(promptDumpT1, "private-speech-control");
  const personaDescription = extractUserPersonaBlock(identityRules);

  const turns = JSON.parse(readUtf8("fixtures/user-turns-t1-t2-t3.json")) as {
    characterName: string;
    personaName: string;
    T1_USER_RAW: string;
    T2_USER_RAW: string;
  };

  const charOnlyRaw = characterCoreWire
    .split(/\n\[WORLD CANON/)[0]
    .replace(/^\[CHARACTER CANON —[^\n]+\n/, "");

  const compiled = compileCanonPlanV1({
    creatorRawDescription: charOnlyRaw,
    now: "2026-09-27T12:00:00.000Z",
  });
  if (!compiled.ok || !compiled.plan) {
    throw new Error(compiled.error ?? "canon compile failed");
  }
  const plan: CanonPlanV1 = compiled.plan;
  const coreSet = new Set(plan.coreIds);

  writeBoth("CANON_COMPILE_NOTE.json", {
    note:
      "Local DB lacks production character=10 creator_raw; compiled from PR620 T1 wire CHARACTER bucket (stripped headers). WORLD/SCENARIO from wire remain in FULL arm only.",
    charOnlyRawChars: charOnlyRaw.length,
    characterCoreWireChars: characterCoreWire.length,
    metrics: canonCoreInflationMetrics(plan),
    coreRenderChars: renderCoreCanonBlock(plan, { charName: turns.characterName }).length,
    activeBudgetChars: plan.retrieval.activeBudgetChars,
  });

  const classificationRows = plan.chunks.map((c) => classifyChunkRow(c, coreSet));
  writeBoth("CANON_CLASSIFICATION_MAP.json", {
    character: turns.characterName,
    chunks: classificationRows,
    summary: {
      total: plan.chunks.length,
      core: plan.coreIds.length,
      activeCandidates: classificationRows.filter((r) => r.classification === "ACTIVE_candidate").length,
      dormant: classificationRows.filter((r) => r.classification === "dormant").length,
      private: classificationRows.filter((r) => r.classification === "private/conditional").length,
    },
  });

  const opening = readUtf8("raw/OPENING_ASSISTANT_VISIBLE.txt").trimEnd();
  const t1User = readUtf8("raw/T1-USER_RAW.txt").trimEnd();
  const t1Assistant = readUtf8("raw/T1-ASSISTANT_PERSISTED_VISIBLE.txt").trimEnd();
  const t2User = readUtf8("raw/T2-USER_RAW.txt").trimEnd();

  const snapshots = {
    A: {
      id: "SNAPSHOT_A",
      label: "post-mission food/domestic (T1 user)",
      shortTermHistory: [
        { role: "user" as const, content: "[채팅 시작]" },
        { role: "assistant" as const, content: opening },
      ],
      currentUserMessage: t1User,
      completedTurns: 1,
    },
    B: {
      id: "SNAPSHOT_B",
      label: "relationship transition / kiss (T2 user)",
      shortTermHistory: [
        { role: "user" as const, content: "[채팅 시작]" },
        { role: "assistant" as const, content: opening },
        { role: "user" as const, content: t1User },
        { role: "assistant" as const, content: t1Assistant },
      ],
      currentUserMessage: t2User,
      completedTurns: 2,
    },
  };

  for (const snap of Object.values(snapshots)) {
    const recentSceneContext = snap.shortTermHistory
      .slice(-4)
      .map((m) => m.content?.trim() ?? "")
      .filter(Boolean)
      .join("\n");
    const recentTurns = snap.shortTermHistory
      .slice(-4)
      .map((m) => ({ role: m.role, content: m.content?.trim() ?? "" }))
      .filter((m) => m.content.length > 0);
    const active = selectActiveCanonChunks({
      plan,
      userMessage: snap.currentUserMessage,
      recentContext: recentSceneContext,
      recentTurns,
    });
    const eligible = plan.chunks.filter(
      (c) =>
        !coreSet.has(c.id) &&
        c.salience !== "core" &&
        c.bucket !== "player" &&
        c.bucket !== "scenario_meta" &&
        c.visibility === "public",
    );
    const selectedIds = new Set(active.selectedIds);
    writeBoth(`ACTIVE_SELECTION_${snap.id}.json`, {
      snapshot: snap.id,
      label: snap.label,
      userMessagePreview: snap.currentUserMessage.slice(0, 200),
      gate: {
        recentContextGateReason: active.recentContextGateReason,
        recentContextUsed: active.recentContextUsed,
        keywords: active.keywords,
      },
      budgetChars: active.budgetChars,
      eligibleCount: eligible.length,
      selectedCount: active.selectedCount,
      selectedChars: active.selectedChars,
      selected: active.activeChunks.map((c) => ({
        id: c.id,
        sectionTitle: c.sectionTitle,
        chars: c.text.length,
        reason: active.reasons.find((r) => r.chunkId === c.id),
      })),
      rejectedSample: eligible
        .filter((c) => !selectedIds.has(c.id))
        .slice(0, 15)
        .map((c) => ({ id: c.id, sectionTitle: c.sectionTitle, chars: c.text.length })),
    });
  }

  const policyDeepSeekDefault = resolveCanonInjectionPolicy(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL, {
    userId: 620,
    chatId: 620,
  });
  const policyDeepSeekOpenRouter = resolveCanonInjectionPolicy(
    OPENROUTER_DEEPSEEK_V4_PRO_0813_BACKUP_MODEL,
    { userId: 620, chatId: 620 },
  );
  const policyGemini37 = resolveCanonInjectionPolicy(CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL);

  writeBoth("RUNTIME_POLICY_MAP.json", {
    productionEnvActivation: "PRODUCTION_ENV_ACTIVATION_UNCONFIRMED",
    codeDefaultEnvAssumption: "unset → CANON_INJECTION_ROLLOUT_STAGE=D0",
    models: {
      deepseek_v4_pro_0813: policyDeepSeekDefault,
      openrouter_deepseek_v4_pro_0813_backup: policyDeepSeekOpenRouter,
      gemini_37_flash: policyGemini37,
    },
    interpretation: {
      whyWireLooksFullLegacy:
        "layeredCanonActive requires canonPlan AND isLayeredCanonActive(policy). Code default D0 → actualCanonMode FULL_LEGACY + shadowOnly. PR620 quality harness omitted canonPlan/policy → always buildCharacterCanonBlock (~10k).",
      geminiLayeredPath: "none — generic + muse/gemini-3.6 paths stay FULL_LEGACY (PR #284 experiment not merged)",
      deepSeekLayeredPath:
        "requires CANON_INJECTION_ENABLED + CANON_INJECTION_DEEPSEEK_CANARY + stage≥D2 + cohort eligible",
    },
  });

  writeBoth("OWNER_MAP.json", {
    owners: {
      canonCompilation: "src/lib/canonPlan/compiler.ts → compileCanonPlanV1",
      coreClassification: "src/lib/canonPlan/canonSalience.ts (inferSalience) + coreIds in compiler",
      activeClassification: "salience !== core && not player/scenario_meta",
      dormantClassification: "inferSalience → dormant",
      activeRetrieval: "src/lib/canonPlan/activeSelector.ts → selectActiveCanonChunks",
      activeBudget: "CanonPlanV1.retrieval.activeBudgetChars (default 1200)",
      archiveRetrieval: "src/lib/memory/archiveSelective.ts (when isSelectiveArchiveActive)",
      knowledgeVisibility: "src/lib/canonPlan/canonVisibility.ts + characterKnowledgeBoundary",
      runtimeCanonMode: "src/lib/canonInjectionPolicy.ts → resolveCanonInjectionPolicy + isLayeredCanonActive",
      rolloutCanary: "canonInjectionPolicy + canonInjectionCohort",
      cachePlacement: "contextBuilder pushSection cacheRules vs dynamic (not content policy owner)",
      characterCoreRendering:
        "layered: coreRenderer.renderCoreCanonBlock; full: buildCharacterCanonBlock",
    },
    staleComments: [
      {
        file: "src/services/contextBuilder.ts",
        line: 240,
        text: "full character profile every turn",
        classification: "STALE — layered mode injects CORE+ACTIVE; comment predates LAYERED",
      },
      {
        file: "src/services/contextBuilder.ts",
        line: 761,
        sectionTitle: "Structured character canon (every turn)",
        classification: "KEEP label — section still every turn; content varies by mode",
      },
    ],
  });

  const { buildContext } = await import("../src/services/contextBuilder");
  const { assemblePrimaryRpRequest } = await import("../src/lib/openRouterAdult");
  const { parseCharacterSetting } = await import("../src/utils/characterParser");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { buildSceneDirective, renderSceneDirectiveForPrompt } =
    await import("../src/lib/sceneDirective");
  const { resolveNarrativePov } = await import("../src/lib/narrativePov");
  const { INACTIVE_CURRENT_TURN_AUTHORING_DELEGATION } = await import(
    "../src/lib/currentTurnUserAuthoringDelegation"
  );
  const { visibleAssistantDisplayCharCount } =
    await import("../src/lib/chatDisplayLength");

  const chunks = parseCharacterSetting({
    characterId: "pr620-capsule-10",
    characterName: turns.characterName,
    gender: "male",
    systemPrompt: characterCoreWire,
    world: "",
    exampleDialog: "",
    statusWindowPrompt: "",
  });

  const userPersona = formatSelectedPersonaForPrompt(
    turns.personaName,
    "male",
    personaDescription,
  );

  type Arm = "F" | "L";
  const MODELS = [
    CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
    CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  ];

  const assemble = (modelId: string, snap: (typeof snapshots)[keyof typeof snapshots], arm: Arm) => {
    const narrativePov = resolveNarrativePov({
      mode: "third_person",
      contentKind: "character",
      mainCharacterName: turns.characterName,
    });
    const directive = buildSceneDirective({
      mode: "interactive",
      recentMessages: snap.shortTermHistory,
      currentUserMessage: snap.currentUserMessage,
      memoryText: "",
      relationshipMemoryText: "",
      lorebookText: "",
      triggeredEventText: "",
      chatId: 620,
      currentTurn: snap.completedTurns + 1,
      progressionHistory: [],
      contentKind: "character",
      primaryCharacterName: turns.characterName,
    });

    const canonInjectionPolicy =
      arm === "L"
        ? forcedLayeredPolicy(modelId)
        : resolveCanonInjectionPolicy(modelId, { userId: 620, chatId: 620 });

    const built = buildContext({
      charName: turns.characterName,
      contentKind: "character",
      narrativePov,
      chunks,
      systemPrompt: characterCoreWire,
      userNickname: turns.personaName,
      userPersona,
      userNote: formatUserNoteForPrompt(""),
      longTermMemory: "",
      shortTermHistory: snap.shortTermHistory,
      currentUserMessage: snap.currentUserMessage,
      nsfw: true,
      gender: "male",
      modelId,
      currentTurnAuthoringDelegation: INACTIVE_CURRENT_TURN_AUTHORING_DELEGATION,
      novelModeEnabled: false,
      personaDisplayName: turns.personaName,
      targetResponseChars: 3200,
      completedTurns: snap.completedTurns,
      userPersonaGender: "male",
      provider: "openrouter",
      genres: ["판타지/SF", "로맨스"],
      privateSpeechControlBlock: privateSpeech,
      sceneDirectiveBlock: renderSceneDirectiveForPrompt(directive),
      scenePacingPromptOwner: "legacy_v1",
      promptDumpSource: "pr620-capsule",
      promptDumpDetail: `${snap.id} arm=${arm}`,
      canonInjectionPolicy,
      canonPlan: arm === "L" ? plan : null,
    });

    const wire = assemblePrimaryRpRequest({
      system: built.systemPrompt,
      history: built.history,
      modelId,
      targetResponseChars: 3200,
      messageOpts: {
        transportProvider: "cheaperinference",
        charName: turns.characterName,
        personaName: turns.personaName,
        sceneServerControls: {
          mode: "interactive",
          contentKind: "character",
          party: false,
          primaryCharacterName: turns.characterName,
          currentUserMessage: snap.currentUserMessage,
          recentMessages: snap.shortTermHistory,
          memoryText: "",
          adultModeEnabled: true,
          chatId: 620,
          currentTurn: snap.completedTurns + 1,
          progressionHistory: [],
          canonicalSceneDirective: directive,
          skipMotionCue: false,
        },
      },
    });

    const body = {
      ...(wire.requestBody as Record<string, unknown>),
      stream: true,
      stream_options: { include_usage: true },
    };
    const messages = body.messages as Array<{ role: string; content: unknown }>;
    const system = flatContent(messages.find((m) => m.role === "system")?.content);

    const sections = built.meta.trackedSections ?? [];
    const staticPrefixEstimateChars = sections
      .filter((s) => s.category === "systemRules" || s.category === "characterSetting")
      .reduce((n, s) => n + s.text.length, 0);
    const dynamicEstimateChars = sections
      .filter((s) => s.category === "memory" || s.category === "recentConversation")
      .reduce((n, s) => n + s.text.length, 0);

    return {
      body,
      built,
      systemSha: sha256(system),
      wireMetrics: {
        arm,
        policyActualCanonMode: canonInjectionPolicy.actualCanonMode,
        characterCoreIdentityChars: sectionChars(built, "character-core-identity"),
        characterActiveCanonChars: sectionChars(built, "character-active-canon"),
        characterPrivateSecretChars: sectionChars(built, "character-private-secret"),
        systemTotalChars: system.length,
        staticPrefixEstimateChars,
        dynamicEstimateChars,
      },
    };
  };

  const wireRows: Record<string, unknown>[] = [];
  for (const snap of Object.values(snapshots)) {
    for (const modelId of MODELS) {
      for (const arm of ["F", "L"] as Arm[]) {
        const w = assemble(modelId, snap, arm);
        wireRows.push({
          snapshot: snap.id,
          modelId,
          arm,
          ...w.wireMetrics,
          systemSha256: w.systemSha,
        });
        writeBoth(
          `wire/${snap.id}/${modelId.replace(/\//g, "_")}/${arm}/request-meta.json`,
          { systemSha256: w.systemSha, ...w.wireMetrics },
        );
      }
    }
  }
  writeBoth("WIRE_COMPARISON.json", { rows: wireRows });

  if (SKIP_LIVE) {
    console.log("[canon-audit] SKIP_LIVE=1 — wire-only complete");
    return;
  }

  const apiKey = exitIfBenchmarkCheaperInferenceApiKeyMissing("CANON_LAYERED_AUDIT_NOT_RUN");
  const { CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL, buildCheaperInferenceHeaders } =
    await import("../src/lib/cheaperInferenceConfig");
  const headers = buildCheaperInferenceHeaders(apiKey);

  const liveIndex: Record<string, unknown>[] = [];
  let calls = 0;
  const maxCalls = 16;

  for (const snap of Object.values(snapshots)) {
    for (const modelId of MODELS) {
      for (const arm of ["F", "L"] as Arm[]) {
        for (let rep = 1; rep <= REPS; rep++) {
          if (calls >= maxCalls) break;
          calls += 1;
          const tag = `${snap.id}/${modelId.replace(/\//g, "_")}/${arm}/r${rep}`;
          const assembled = assemble(modelId, snap, arm);
          console.log(`[canon-audit] live ${tag} call=${calls}/${maxCalls}`);
          const cap = await streamOnce(
            CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
            headers,
            assembled.body,
          );
          if (cap.error) writeBoth(`raw/${tag}-ERROR.txt`, cap.error);
          else writeBoth(`raw/${tag}.txt`, cap.text);

          const usage = cap.usage;
          liveIndex.push({
            tag,
            snapshot: snap.id,
            modelId,
            arm,
            rep,
            visibleChars: visibleAssistantDisplayCharCount(cap.text),
            prompt_tokens: usage?.prompt_tokens ?? usage?.input_tokens ?? null,
            completion_tokens: usage?.completion_tokens ?? usage?.output_tokens ?? null,
            cached_tokens:
              (usage?.prompt_tokens_details as Record<string, unknown> | undefined)
                ?.cached_tokens ?? usage?.cached_tokens ?? null,
            cache_creation_input_tokens: usage?.cache_creation_input_tokens ?? null,
            finish: cap.finish,
            latencyMs: cap.latencyMs,
            httpStatus: cap.status,
            error: cap.error,
            semanticLeakageFlags: cap.text ? semanticLeakageFlags(cap.text) : [],
            wire: assembled.wireMetrics,
            systemSha256: assembled.systemSha,
          });
          writeBoth(`meta/${tag}.json`, liveIndex[liveIndex.length - 1]);
        }
      }
    }
  }

  writeBoth("LIVE_RUN_INDEX.json", {
    totalProviderCalls: calls,
    maxCalls,
    repsPerCell: REPS,
    rows: liveIndex,
  });

  console.log(`[canon-audit] done calls=${calls} repoOut=${REPO_OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
