/**
 * PR #620 archived real-production capsule → current-main buildContext quality verification.
 * Audit-only. No production runtime changes.
 *
 *   LABEL=pr620-real-capsule-quality REPS=3 \
 *     npx tsx scripts/pr620-real-capsule-quality-benchmark.ts
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
} from "../src/lib/chatModels";
import {
  MAX_MAIN_RP_PROVIDER_CALLS_PER_TURN,
  TURN_LENGTH_SUPPLEMENT_API_ENABLED,
} from "../src/lib/turnApiBudget";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const LABEL = process.env.LABEL?.trim() || "pr620-real-capsule-quality";
const OUT_ROOT = path.join("/opt/cursor/artifacts", LABEL);
const REPS = Math.max(1, Math.min(5, Number(process.env.REPS ?? 3) || 3));
const CAPSULE_ROOT = path.join(
  process.cwd(),
  "docs/audits/real-production-mid-chat-style-handoff-benchmark",
);
const PR620_HEAD = "b92100326e56d726eb9040f9cf1b01c7bc11db4e";
const MODELS = [
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
];

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function readUtf8(rel: string): string {
  const p = path.join(CAPSULE_ROOT, rel);
  if (!fs.existsSync(p)) throw new Error(`Missing PR620 source: ${rel}`);
  return fs.readFileSync(p, "utf8");
}

function write(rel: string, content: string | object) {
  const p = path.join(OUT_ROOT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(
    p,
    typeof content === "string" ? content : JSON.stringify(content, null, 2),
    "utf8",
  );
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

function usageNumbers(usage: Record<string, unknown> | null) {
  if (!usage) {
    return {
      prompt_tokens: null as number | null,
      completion_tokens: null as number | null,
      reasoning_tokens: null as number | null,
    };
  }
  const prompt = Number(usage.prompt_tokens ?? usage.input_tokens ?? NaN);
  const completion = Number(usage.completion_tokens ?? usage.output_tokens ?? NaN);
  const details = usage.completion_tokens_details as Record<string, unknown> | undefined;
  const reasoningRaw = details?.reasoning_tokens ?? usage.reasoning_tokens;
  const reasoning =
    reasoningRaw != null && Number.isFinite(Number(reasoningRaw))
      ? Number(reasoningRaw)
      : null;
  return {
    prompt_tokens: Number.isFinite(prompt) ? prompt : null,
    completion_tokens: Number.isFinite(completion) ? completion : null,
    reasoning_tokens: reasoning,
  };
}

const OCCURRENCE_CHECKS: Array<{
  id: string;
  patterns: RegExp[];
}> = [
  {
    id: "DIRECT_EMOTION_LABEL",
    patterns: [
      /(?:불안|무서|걱정|화가|슬퍼|당황|설레|짜증|분노|우울|외로|기쁨|행복)(?:했|졌|난|났|돼|함|스러)/,
    ],
  },
  {
    id: "SHOW_THROUGH_BEHAVIOR",
    patterns: [/(?:시선|눈빛|표정|입꼬리|미간|호흡|숨|손끝|어깨|걸음|거리|자세|고개)/],
  },
  {
    id: "INNER_MONOLOGUE_OVERUSE",
    patterns: [/(?:생각|마음속|머릿속|뇌리|자문)/],
  },
  {
    id: "SENSORY_GROUNDING",
    patterns: [/(?:냄새|향|소리|온기|차가|따뜻|촉|질감|맛|바람)/],
  },
  {
    id: "ENVIRONMENT_DETAIL",
    patterns: [/(?:복도|로비|식당|창|천장|벽|바닥|조명|그림자|공간|숙소|현관|냉장고|소파)/],
  },
  {
    id: "APPEARANCE_DETAIL",
    patterns: [/(?:머리|눈|피부|옷|재킷|키|체형|외모|네일|초커)/],
  },
  {
    id: "SPATIAL_CONTINUITY",
    patterns: [/(?:옆|가까|멀|거리|방향|앞|뒤|침대|소파)/],
  },
  {
    id: "BODY_POSITION_CONTINUITY",
    patterns: [/(?:앉|서|기대|눕|잡|맞|포개|기울)/],
  },
  {
    id: "CHARACTER_VOICE",
    patterns: [/(?:푸하|하하|미안|장난|귀찮|배고|억울|태형|라이크)/],
  },
  {
    id: "DIALOGUE_NATURALNESS",
    patterns: [/「|"|“/],
  },
  {
    id: "RELATIONSHIP_ATMOSPHERE",
    patterns: [/(?:친밀|긴장|거리|편|부담|장난|기다|쳐다)/],
  },
  {
    id: "SEMANTIC_REPETITION",
    patterns: [],
  },
  {
    id: "MICRO_ACTION_LOOP",
    patterns: [/(?:손가락|눈을|시선을|숨을).{0,50}(?:손가락|눈을|시선을|숨을)/],
  },
  {
    id: "EXPLANATION_AFTER_SHOWING",
    patterns: [/(?:라는\s*뜻|때문이었다|의미였|것이었다|듯했다)/],
  },
  {
    id: "PSEUDO_CLINICAL_EXPLANATION",
    patterns: [/(?:심리\s*분석|지표|데이터|메커니즘|패턴\s*분석)/],
  },
  {
    id: "AGENCY_VIOLATION",
    patterns: [/(?:렌이\s*(?:말했다|외쳤|선언|결정했다))/],
  },
  {
    id: "REGISTER_VIOLATION",
    patterns: [/\*\*[^*]+\*\*/],
  },
  {
    id: "LAYOUT_VIOLATION",
    patterns: [/[가-힣]\.\s*“[^”\n]+”[^\\n]/],
  },
];

function annotateOccurrences(text: string): Record<
  string,
  { hit: boolean; excerpts: Array<{ offset: number; text: string }> }
> {
  const out: Record<
    string,
    { hit: boolean; excerpts: Array<{ offset: number; text: string }> }
  > = {};
  for (const check of OCCURRENCE_CHECKS) {
    const excerpts: Array<{ offset: number; text: string }> = [];
    for (const p of check.patterns) {
      const m = p.exec(text);
      if (m?.index != null) {
        const start = Math.max(0, m.index - 20);
        excerpts.push({
          offset: m.index,
          text: text.slice(start, start + 100).replace(/\s+/g, " ").trim(),
        });
      }
    }
    out[check.id] = { hit: excerpts.length > 0, excerpts: excerpts.slice(0, 3) };
  }
  return out;
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  let i = 0;
  while (true) {
    const idx = haystack.indexOf(needle, i);
    if (idx < 0) break;
    n += 1;
    i = idx + needle.length;
  }
  return n;
}

async function main() {
  if (TURN_LENGTH_SUPPLEMENT_API_ENABLED !== false) {
    throw new Error("expected TURN_LENGTH_SUPPLEMENT_API_ENABLED=false");
  }
  if (MAX_MAIN_RP_PROVIDER_CALLS_PER_TURN !== 1) {
    throw new Error("expected MAX_MAIN_RP_PROVIDER_CALLS_PER_TURN=1");
  }

  const mainSha = process.env.MAIN_SHA?.trim() || "unknown";
  write("git-baseline.json", {
    recordedAt: new Date().toISOString(),
    originMainSha: mainSha,
    headSha: process.env.HEAD_SHA?.trim() || "unknown",
    pr620Head: PR620_HEAD,
  });

  const turns = JSON.parse(readUtf8("fixtures/user-turns-t1-t2-t3.json")) as {
    characterName: string;
    personaName: string;
    T1_USER_RAW: string;
    T2_USER_RAW: string;
  };

  if (turns.characterName.trim() !== "라이크" || turns.personaName.trim() !== "렌") {
    throw new Error("PR620 fixture identity mismatch (expected 라이크 / 렌)");
  }

  const opening = readUtf8("raw/OPENING_ASSISTANT_VISIBLE.txt").trimEnd();
  const t1User = readUtf8("raw/T1-USER_RAW.txt").trimEnd();
  const t1Assistant = readUtf8("raw/T1-ASSISTANT_PERSISTED_VISIBLE.txt").trimEnd();
  const t2User = readUtf8("raw/T2-USER_RAW.txt").trimEnd();

  if (t1User !== turns.T1_USER_RAW.trim()) {
    throw new Error("T1_USER_RAW mismatch between fixture JSON and raw/T1-USER_RAW.txt");
  }
  if (t2User !== turns.T2_USER_RAW.trim()) {
    throw new Error("T2_USER_RAW mismatch between fixture JSON and raw/T2-USER_RAW.txt");
  }

  const promptDumpT1 = readUtf8("requests/T1-prompt_dump.txt");
  const promptDumpT2 = readUtf8("requests/T2-prompt_dump.txt");
  const characterCanon = extractPromptDumpSection(promptDumpT1, "character-core-identity");
  const identityRules = extractPromptDumpSection(promptDumpT1, "identity-and-rules");
  const privateSpeech = extractPromptDumpSection(promptDumpT1, "private-speech-control");
  const personaDescription = extractUserPersonaBlock(identityRules);

  const sourceFiles = [
    "fixtures/user-turns-t1-t2-t3.json",
    "raw/OPENING_ASSISTANT_VISIBLE.txt",
    "raw/T1-USER_RAW.txt",
    "raw/T1-ASSISTANT_PERSISTED_VISIBLE.txt",
    "raw/T2-USER_RAW.txt",
    "requests/T1-prompt_dump.txt",
    "requests/T2-prompt_dump.txt",
    "requests/T1-token_breakdown.json",
    "requests/T2-token_breakdown.json",
    "requests/T1-GEMINI-input.json",
    "requests/T2-GEMINI-input.json",
  ];

  const capsuleHash = sha256(
    sourceFiles.map((f) => `${f}:${sha256(readUtf8(f))}`).join("\n"),
  );

  const sourceMap: Array<{
    field: string;
    sourceFile: string;
    sourceSection: string;
    hash: string;
    chars: number;
  }> = [
    {
      field: "characterName",
      sourceFile: "fixtures/user-turns-t1-t2-t3.json",
      sourceSection: "characterName",
      hash: sha256(turns.characterName),
      chars: turns.characterName.length,
    },
    {
      field: "personaName",
      sourceFile: "fixtures/user-turns-t1-t2-t3.json",
      sourceSection: "personaName",
      hash: sha256(turns.personaName),
      chars: turns.personaName.length,
    },
    {
      field: "characterCanon",
      sourceFile: "requests/T1-prompt_dump.txt",
      sourceSection: "character-core-identity",
      hash: sha256(characterCanon),
      chars: characterCanon.length,
    },
    {
      field: "personaDescription",
      sourceFile: "requests/T1-prompt_dump.txt",
      sourceSection: "identity-and-rules/[USER_PERSONA]",
      hash: sha256(personaDescription),
      chars: personaDescription.length,
    },
    {
      field: "privateSpeechControl",
      sourceFile: "requests/T1-prompt_dump.txt",
      sourceSection: "private-speech-control",
      hash: sha256(privateSpeech),
      chars: privateSpeech.length,
    },
    {
      field: "openingAssistant",
      sourceFile: "raw/OPENING_ASSISTANT_VISIBLE.txt",
      sourceSection: "full",
      hash: sha256(opening),
      chars: opening.length,
    },
    {
      field: "T1_USER_RAW",
      sourceFile: "raw/T1-USER_RAW.txt",
      sourceSection: "full",
      hash: sha256(t1User),
      chars: t1User.length,
    },
    {
      field: "T1_ASSISTANT_PERSISTED",
      sourceFile: "raw/T1-ASSISTANT_PERSISTED_VISIBLE.txt",
      sourceSection: "full",
      hash: sha256(t1Assistant),
      chars: t1Assistant.length,
    },
    {
      field: "T2_USER_RAW",
      sourceFile: "raw/T2-USER_RAW.txt",
      sourceSection: "full",
      hash: sha256(t2User),
      chars: t2User.length,
    },
    {
      field: "longTermMemory",
      sourceFile: "requests/T1-token_breakdown.json",
      sourceSection: "no LTM row in archived T1 chat (new disposable chat)",
      hash: sha256(""),
      chars: 0,
    },
    {
      field: "nsfwMode",
      sourceFile: "meta/T1.json",
      sourceSection: "route=nsfw (archived live capture)",
      hash: sha256("nsfw"),
      chars: 4,
    },
  ];

  write("REAL_CAPSULE_SOURCE_MAP.json", {
    provenance: {
      pr: 620,
      pr620Head: PR620_HEAD,
      capsuleRoot: CAPSULE_ROOT,
      capsuleHash,
      historicalNote:
        "PR #255 char18×persona61 live capture cited as existence proof only; identity here is PR620 라이크/렌 content hashes",
    },
    entries: sourceMap,
  });

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
  const {
    DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY,
    DEEPSEEK_LENGTH_SINGLE_CALL_BLOCK,
  } = await import("../src/lib/deepseekPromptStructure");

  const chunks = parseCharacterSetting({
    characterId: "pr620-capsule-10",
    characterName: turns.characterName,
    gender: "male",
    systemPrompt: characterCanon,
    world: "",
    exampleDialog: "",
    statusWindowPrompt: "",
  });

  const userPersona = formatSelectedPersonaForPrompt(
    turns.personaName,
    "male",
    personaDescription,
  );

  const snapshots = {
    A: {
      id: "SNAPSHOT_A_T1",
      shortTermHistory: [
        { role: "user" as const, content: "[채팅 시작]" },
        { role: "assistant" as const, content: opening },
      ],
      currentUserMessage: t1User,
      completedTurns: 1,
    },
    B: {
      id: "SNAPSHOT_B_T2",
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

  type SnapshotDef = (typeof snapshots)[keyof typeof snapshots];

  const sharedFingerprintBase = sha256(
    JSON.stringify({
      capsuleHash,
      characterCanonSha: sha256(characterCanon),
      personaSha: sha256(personaDescription),
      openingSha: sha256(opening),
    }),
  );

  const assembleSnapshot = (modelId: string, snap: SnapshotDef) => {
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

    const built = buildContext({
      charName: turns.characterName,
      contentKind: "character",
      narrativePov,
      chunks,
      systemPrompt: characterCanon,
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
      promptDumpDetail: `${snap.id} capsuleHash=${capsuleHash.slice(0, 12)}`,
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
    const lastUser = flatContent([...messages].reverse().find((m) => m.role === "user")?.content);

    return {
      body,
      built,
      systemSha: sha256(system),
      lastUserSha: sha256(lastUser),
      snapshotFingerprint: sha256(
        JSON.stringify({
          sharedFingerprintBase,
          snapshot: snap.id,
          historySha: sha256(JSON.stringify(snap.shortTermHistory)),
          currentUserSha: sha256(snap.currentUserMessage),
          modelId,
        }),
      ),
      ownerInventory: {
        commonProseCount: countOccurrences(system, "[COMMON PROSE]"),
        commonProseShaPrefix: sha256(COMMON_PROSE_BLOCK).slice(0, 12),
        deepseekBottomStyleCount: countOccurrences(
          system + lastUser,
          DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY.slice(0, 40),
        ),
        deepseekLengthSingleCallCount: countOccurrences(
          system + lastUser,
          "[DEEPSEEK LENGTH — SINGLE CALL]",
        ),
        sections: built.meta.trackedSections?.map((s) => ({
          id: s.id,
          chars: s.text.length,
        })),
      },
    };
  };

  const parityReport: Record<string, unknown> = {
    sharedFingerprintBase,
    snapshots: {} as Record<string, unknown>,
  };

  for (const snap of Object.values(snapshots)) {
    const ds = assembleSnapshot(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL, snap);
    const g37 = assembleSnapshot(CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL, snap);
    (parityReport.snapshots as Record<string, unknown>)[snap.id] = {
      historySha: sha256(JSON.stringify(snap.shortTermHistory)),
      currentUserSha: sha256(snap.currentUserMessage),
      deepseek: { systemSha: ds.systemSha, lastUserSha: ds.lastUserSha },
      gemini37: { systemSha: g37.systemSha, lastUserSha: g37.lastUserSha },
      crossModelSystemShaMatch: ds.systemSha === g37.systemSha,
      crossModelLastUserShaMatch: ds.lastUserSha === g37.lastUserSha,
      ownerInventoryDeepSeek: ds.ownerInventory,
      ownerInventoryGemini37: g37.ownerInventory,
    };
    write(`parity/${snap.id}-deepseek-system-sha.txt`, ds.systemSha);
    write(`parity/${snap.id}-gemini37-system-sha.txt`, g37.systemSha);
  }

  write("input-parity.json", parityReport);
  write("CURRENT_OWNER_MAP.json", {
    intendedSharedOwner: "COMMON_PROSE_BLOCK (advancedProseNsfwGuidelines.ts)",
    note: "Wire inventory taken from pre-call assembleSnapshot (current main)",
    snapshots: parityReport.snapshots,
  });

  const apiKey = exitIfBenchmarkCheaperInferenceApiKeyMissing(
    "PR620_REAL_CAPSULE_QUALITY_NOT_RUN",
  );
  const headers = buildCheaperInferenceHeaders(apiKey);

  const index: Record<string, unknown>[] = [];
  let totalCalls = 0;

  for (const snap of Object.values(snapshots)) {
    for (const modelId of MODELS) {
      const assembled = assembleSnapshot(modelId, snap);
      write(
        `wire/${snap.id}/${modelId.replace(/\//g, "_")}/request-meta.json`,
        {
          systemSha256: assembled.systemSha,
          lastUserSha256: assembled.lastUserSha,
          ownerInventory: assembled.ownerInventory,
          providerCallBudget: 1,
        },
      );

      for (let rep = 1; rep <= REPS; rep++) {
        totalCalls += 1;
        const tag = `${snap.id}/${modelId.replace(/\//g, "_")}/r${rep}`;
        console.log(`[pr620-quality] ${tag} call=${totalCalls}`);
        const cap = await streamOnce(
          CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
          headers,
          assembled.body,
        );
        if (cap.error) {
          write(`raw/${tag}-ERROR.txt`, cap.error);
        } else {
          write(`raw/${tag}.txt`, cap.text);
        }
        const usage = usageNumbers(cap.usage);
        const visibleChars = visibleAssistantDisplayCharCount(cap.text);
        const occurrences = cap.text ? annotateOccurrences(cap.text) : {};
        const row = {
          model: modelId,
          snapshot: snap.id,
          rep,
          capsuleHash,
          promptHash: assembled.systemSha,
          snapshotFingerprint: assembled.snapshotFingerprint,
          providerCallCount: 1,
          visibleChars,
          ...usage,
          finish_reason: cap.finish,
          latencyMs: cap.latencyMs,
          httpStatus: cap.status,
          error: cap.error,
          occurrences,
        };
        write(`meta/${tag}.json`, row);
        index.push(row);
      }
    }
  }

  write("raw-output-index.json", {
    totalProviderCalls: totalCalls,
    expectedCalls: 12,
    repsPerModelPerSnapshot: REPS,
    models: MODELS,
    snapshots: Object.keys(snapshots),
    rows: index,
  });

  write("OCCURRENCE_MATRIX.json", {
    note: "Heuristic occurrence flags only — not scores",
    byRow: index.map((r) => ({
      model: r.model,
      snapshot: r.snapshot,
      rep: r.rep,
      occurrences: r.occurrences,
    })),
  });

  write("CLASSIFICATION.json", {
    classification: "PENDING_HUMAN_REVIEW",
    note:
      "Cursor does not assign final BOTH_STYLE_HEALTHY / gap classes — evidence packaged for GPT/user",
  });

  console.log(`[pr620-quality] done calls=${totalCalls} out=${OUT_ROOT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
