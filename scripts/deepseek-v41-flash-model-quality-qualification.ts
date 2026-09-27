/**
 * DeepSeek V4.1 Flash — Main RP model quality qualification (PR620 real capsule).
 * PRODUCTION DIFF = 0. buildContext → assemblePrimaryRpRequest → CI adapter only.
 *
 *   MAIN_SHA=$(git rev-parse origin/main) HEAD_SHA=$(git rev-parse HEAD) \
 *   npx tsx scripts/deepseek-v41-flash-model-quality-qualification.ts
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
import { CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL } from "../src/lib/chatModels";
import {
  MAX_MAIN_RP_PROVIDER_CALLS_PER_TURN,
  TURN_LENGTH_SUPPLEMENT_API_ENABLED,
} from "../src/lib/turnApiBudget";
import {
  isLayeredCanonActive,
  resolveCanonInjectionPolicy,
} from "../src/lib/canonInjectionPolicy";
import { compileCanonPlanV1 } from "../src/lib/canonPlan/compiler";
import { selectActiveCanonChunks } from "../src/lib/canonPlan/activeSelector";
import { adaptCheaperInferenceChatBody } from "../src/lib/cheaperInferenceConfig";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

/** Mirror deployed DeepSeek layered canon D2 @ 100% cohort (audit harness only). */
process.env.CANON_INJECTION_ENABLED = "1";
process.env.CANON_INJECTION_ROLLOUT_STAGE = "D2";
process.env.CANON_INJECTION_DEEPSEEK_CANARY = "1";
process.env.CANON_INJECTION_DEEPSEEK_CANARY_PERCENT = "100";

const REPO_OUT = path.join(
  process.cwd(),
  "docs/audits/deepseek-v41-flash-model-quality-qualification-2026-09-27",
);
const ARTIFACT_OUT = path.join(
  "/opt/cursor/artifacts",
  "deepseek-v41-flash-model-quality-qualification",
);
const REPS = 3;
const MODEL_ID = CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL;
const CAPSULE_ROOT = path.join(
  process.cwd(),
  "docs/audits/real-production-mid-chat-style-handoff-benchmark",
);
const AUDIT_USER_ID = 620;
const AUDIT_CHAT_ID = 620;

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

async function main() {
  if (TURN_LENGTH_SUPPLEMENT_API_ENABLED !== false) {
    throw new Error("expected TURN_LENGTH_SUPPLEMENT_API_ENABLED=false");
  }
  if (MAX_MAIN_RP_PROVIDER_CALLS_PER_TURN !== 1) {
    throw new Error("expected MAX_MAIN_RP_PROVIDER_CALLS_PER_TURN=1");
  }

  const originMain =
    process.env.MAIN_SHA?.trim() ||
    (() => {
      try {
        return fs
          .readFileSync(path.join(process.cwd(), ".git/refs/remotes/origin/main"), "utf8")
          .trim();
      } catch {
        return "unknown";
      }
    })();
  const headSha = process.env.HEAD_SHA?.trim() || "unknown";

  writeBoth("git-baseline.json", {
    exactMain: originMain,
    exactHead: headSha,
    recordedAt: new Date().toISOString(),
    productionDiff: 0,
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

  const opening = readUtf8("raw/OPENING_ASSISTANT_VISIBLE.txt").trimEnd();
  const t1User = readUtf8("raw/T1-USER_RAW.txt").trimEnd();
  const t1Assistant = readUtf8("raw/T1-ASSISTANT_PERSISTED_VISIBLE.txt").trimEnd();
  const t2User = readUtf8("raw/T2-USER_RAW.txt").trimEnd();

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
  const plan = compiled.plan;

  const snapshots = {
    A: {
      id: "SNAPSHOT_A",
      label: "ordinary domestic / food / banter",
      shortTermHistory: [
        { role: "user" as const, content: "[채팅 시작]" },
        { role: "assistant" as const, content: opening },
      ],
      currentUserMessage: t1User,
      completedTurns: 1,
    },
    B: {
      id: "SNAPSHOT_B",
      label: "close-contact / relationship transition",
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

  const { buildContext } = await import("../src/services/contextBuilder");
  const { assemblePrimaryRpRequest } = await import("../src/lib/openRouterAdult");
  const {
    CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
    buildCheaperInferenceHeaders,
  } = await import("../src/lib/cheaperInferenceConfig");
  const { buildSceneDirective, renderSceneDirectiveForPrompt } =
    await import("../src/lib/sceneDirective");
  const { resolveNarrativePov } = await import("../src/lib/narrativePov");
  const { parseCharacterSetting } = await import("../src/utils/characterParser");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { visibleAssistantDisplayCharCount } =
    await import("../src/lib/chatDisplayLength");
  const { INACTIVE_CURRENT_TURN_AUTHORING_DELEGATION } = await import(
    "../src/lib/currentTurnUserAuthoringDelegation"
  );
  const { COMMON_PROSE_BLOCK } = await import("../src/lib/advancedProseNsfwGuidelines");
  const { resolveDeepSeekLengthAdapterSection } = await import(
    "../src/lib/sharedNovelProseModelAdapters"
  );

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

  const canonInjectionPolicy = resolveCanonInjectionPolicy(MODEL_ID, {
    userId: AUDIT_USER_ID,
    chatId: AUDIT_CHAT_ID,
  });
  if (!isLayeredCanonActive(canonInjectionPolicy)) {
    throw new Error(
      `expected layered canon active for audit; got ${JSON.stringify(canonInjectionPolicy)}`,
    );
  }

  type Snap = (typeof snapshots)[keyof typeof snapshots];

  const assembleSnapshot = (snap: Snap) => {
    const recentTurns = snap.shortTermHistory
      .slice(-4)
      .map((m) => ({ role: m.role, content: m.content }));
    const activeSel = selectActiveCanonChunks({
      plan,
      userMessage: snap.currentUserMessage,
      recentContext: recentTurns.map((m) => m.content).join("\n"),
      recentTurns,
    });

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
      chatId: AUDIT_CHAT_ID,
      currentTurn: snap.completedTurns + 1,
      progressionHistory: [],
      contentKind: "character",
      primaryCharacterName: turns.characterName,
    });

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
      modelId: MODEL_ID,
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
      promptDumpDetail: `${snap.id} layered=D2/100`,
      canonInjectionPolicy,
      canonPlan: plan,
    });

    const wire = assemblePrimaryRpRequest({
      system: built.systemPrompt,
      history: built.history,
      modelId: MODEL_ID,
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
          chatId: AUDIT_CHAT_ID,
          currentTurn: snap.completedTurns + 1,
          progressionHistory: [],
          canonicalSceneDirective: directive,
          skipMotionCue: false,
        },
      },
    });

    const adapted = adaptCheaperInferenceChatBody(
      wire.requestBody as Record<string, unknown>,
    );
    const body = {
      ...adapted,
      stream: true,
      stream_options: { include_usage: true },
    };
    const messages = body.messages as Array<{ role: string; content: unknown }>;
    const system = flatContent(messages.find((m) => m.role === "system")?.content);
    const historyForHash = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, content: flatContent(m.content) }));
    const lastUser = [...historyForHash].reverse().find((m) => m.role === "user");

    return {
      body,
      built,
      activeSel,
      systemSha: sha256(system),
      historySha: sha256(JSON.stringify(historyForHash)),
      currentUserSha: sha256(lastUser?.content ?? ""),
      commonProseSha: sha256(COMMON_PROSE_BLOCK),
      systemChars: system.length,
      adaptedWire: {
        model: adapted.model,
        thinking: adapted.thinking ?? null,
        reasoning_effort: adapted.reasoning_effort ?? null,
        max_tokens: adapted.max_tokens ?? null,
        temperature: adapted.temperature ?? null,
      },
      v4ProLengthAdapterPresent: resolveDeepSeekLengthAdapterSection(MODEL_ID) != null,
    };
  };

  const parity: Record<string, unknown> = {
    capsule: {
      character: turns.characterName,
      persona: turns.personaName,
      pr620CapsuleRoot: CAPSULE_ROOT,
    },
    model: {
      requestedId: MODEL_ID,
      canonicalOutboundId: MODEL_ID,
      provider: "cheaperinference",
      mainRpSelectable: true,
    },
    canonPolicy: canonInjectionPolicy,
    commonProseSha256: sha256(COMMON_PROSE_BLOCK),
    snapshots: {} as Record<string, unknown>,
  };

  for (const snap of Object.values(snapshots)) {
    const a = assembleSnapshot(snap);
    parity.snapshots![snap.id] = {
      snapshotLabel: snap.label,
      promptHashSystemSha256: a.systemSha,
      historyHashSha256: a.historySha,
      currentUserHashSha256: a.currentUserSha,
      systemChars: a.systemChars,
      canonCoreIds: plan.coreIds,
      activeChunkIds: a.activeSel.activeChunks.map((c) => c.id),
      activeSectionTitles: a.activeSel.activeChunks.map((c) => c.sectionTitle),
      wire: a.adaptedWire,
      v4ProExperimentalLengthAdapterOnWire: a.v4ProLengthAdapterPresent,
    };
    writeBoth(`wire/${snap.id}/request-meta.json`, parity.snapshots![snap.id]);
  }

  writeBoth("INPUT_PARITY.json", parity);

  const apiKey = exitIfBenchmarkCheaperInferenceApiKeyMissing(
    "V41_FLASH_MODEL_QUALITY_NOT_RUN",
  );
  const headers = buildCheaperInferenceHeaders(apiKey);

  const liveRows: Record<string, unknown>[] = [];
  let calls = 0;

  for (const snap of Object.values(snapshots)) {
    const assembled = assembleSnapshot(snap);
    for (let rep = 1; rep <= REPS; rep++) {
      calls += 1;
      const sampleId = `${snap.id}/deepseek-v4.1-flash/r${rep}`;
      console.log(`[v41-qual] ${sampleId} call=${calls}/6`);
      const cap = await streamOnce(
        CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
        headers,
        assembled.body,
      );
      if (cap.error) writeBoth(`raw/${sampleId}-ERROR.txt`, cap.error);
      else writeBoth(`raw/${sampleId}.txt`, cap.text);

      liveRows.push({
        sampleId,
        snapshot: snap.id,
        rep,
        model: MODEL_ID,
        providerCallCount: 1,
        visibleChars: visibleAssistantDisplayCharCount(cap.text),
        promptHash: assembled.systemSha,
        historyHash: assembled.historySha,
        currentUserHash: assembled.currentUserSha,
        finish: cap.finish,
        latencyMs: cap.latencyMs,
        httpStatus: cap.status,
        error: cap.error,
        usage: cap.usage,
      });
      writeBoth(`meta/${sampleId}.json`, liveRows[liveRows.length - 1]);
    }
  }

  writeBoth("WIRE_SUMMARY.json", {
    exactMain: originMain,
    exactHead: headSha,
    behindMain: 0,
    totalProviderCalls: calls,
    expectedCalls: 6,
    model: MODEL_ID,
    reasoning: "TRUE-OFF (thinking.type=disabled, reasoning_effort=none)",
    transport: "cheaperinference /v1/chat/completions",
    mainRpProviderCallsPerTurn: MAX_MAIN_RP_PROVIDER_CALLS_PER_TURN,
    layeredCanon: {
      rolloutStage: process.env.CANON_INJECTION_ROLLOUT_STAGE,
      canaryPercent: process.env.CANON_INJECTION_DEEPSEEK_CANARY_PERCENT,
      actualCanonMode: canonInjectionPolicy.actualCanonMode,
    },
    v4ProLengthAdapterAppliedToV41: false,
    rows: liveRows,
  });

  console.log(`[v41-qual] done calls=${calls} repo=${REPO_OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
