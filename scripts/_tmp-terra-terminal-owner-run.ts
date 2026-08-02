/**
 * Terra terminal single-owner A/B live run (one call each).
 * Uses production builders: buildContext + streamOpenRouterAdultToClient.
 * Must use built.history so the user-turn terminal contract is actually sent.
 */
import Module from "module";
const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import { mkdirSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import { performance } from "perf_hooks";
import Database from "better-sqlite3";
import { loadEnvLocal } from "./load-env-local";
import { CHEAPER_INFERENCE_GPT_56_TERRA_MODEL } from "../src/lib/chatModels";
import {
  CHEAPER_INFERENCE_BASE_URL,
  CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
  adaptCheaperInferenceChatBody,
} from "../src/lib/cheaperInferenceConfig";
import { buildOpenRouterRequestBody } from "../src/lib/openRouterClient";
import {
  buildOpenRouterMessages,
  streamOpenRouterAdultToClient,
} from "../src/lib/openRouterAdult";
import { buildContext } from "../src/services/contextBuilder";
import { loadCharacterChunksForPromptReadOnly } from "../src/lib/characterChunks";
import { formatUserPersonaForPrompt } from "../src/lib/persona";
import { TERRA_MAX_OUTPUT_TOKENS } from "../src/lib/openAiResponsesClient";
import { getCanonicalProseBody } from "../src/lib/canonicalProse";
import {
  resolveRpSceneCastMode,
  shouldUseTerraTerminalLengthOwner,
  TERRA_TERMINAL_LENGTH_OWNER_CONTRACT,
} from "../src/lib/terraTerminalLengthOwner";
import type { ChatMsg } from "../src/lib/ai";

loadEnvLocal();

process.env.LUNA_WORK_COMPLETE = "true";
process.env.LUNA_PRODUCTION_ADOPTED = "true";
process.env.LUNA_REOPENED = "false";
process.env.WORLD_MOTION_REOPENED = "false";

const OUT = resolve("output/terra-terminal-owner");
const MODEL = CHEAPER_INFERENCE_GPT_56_TERRA_MODEL;
const BENGALI_MARKER = "এবার";
const TARGET = 3200;
const CONTRACT = TERRA_TERMINAL_LENGTH_OWNER_CONTRACT;

const SCENE_A = {
  id: "A",
  seed: [
    {
      role: "user" as const,
      content:
        '*손전등을 낮게 비추며 속삭인다.* "이 통로, 물때가 아직 축축해요. 방금 전에 누가 지나간 것 같아요."',
    },
    {
      role: "assistant" as const,
      content:
        '에녹은 대답 대신 손전등 각도를 조금 낮췄다.\n\n"소리 죽여."\n\n통로 끝에서 물방울 떨어지는 간격이 한 박 짧아진 듯했다.',
    },
  ],
  userMessage:
    '*발소리를 죽이며 한 걸음 더 들어간다.* "왼쪽 갈림길… 이끼가 쓸려 있어요. 어떻게 할까요."',
};

const SCENE_B = {
  id: "B",
  seed: [
    {
      role: "user" as const,
      content: '*숨을 죽이며 엄폐한다.* "왼쪽에서 소리가 났어요."',
    },
    {
      role: "assistant" as const,
      content:
        '에녹은 손전등을 끄고 벽으로 바짝 붙었다.\n\n"엄폐. 소리 죽여."\n\n통로 모퉁이에서 무엇인가가 콘크리트 위를 긁는 소리가 다시 한 번 짧게 났다.',
    },
  ],
  userMessage:
    '*방아쇠에 손을 올린다.* "지금이야 — 반격해! 저쪽 모퉁이 확인해."',
};

function extractDialogueBlocks(text: string): string[] {
  const blocks: string[] = [];
  for (const re of [/[「『"].+?[」』"]/gs, /“[^”]+”/g]) {
    let m: RegExpExecArray | null;
    const r = new RegExp(re.source, re.flags);
    while ((m = r.exec(text))) blocks.push(m[0]);
  }
  return blocks;
}

function koreanCharCount(text: string): number {
  return (text.match(/[가-힣]/g) || []).length;
}

function countNeedle(hay: string, needle: string): number {
  if (!needle) return 0;
  return hay.split(needle).length - 1;
}

function scanForeign(text: string) {
  const hits: Array<{ ch: string; cp: string; index: number; sentence: string }> = [];
  for (let i = 0; i < text.length; i++) {
    const cp = text.codePointAt(i)!;
    const isBengali = cp >= 0x0980 && cp <= 0x09ff;
    const isCyrillic = cp >= 0x0400 && cp <= 0x04ff;
    const isArabic = cp >= 0x0600 && cp <= 0x06ff;
    const isHiragana = cp >= 0x3040 && cp <= 0x309f;
    const isKatakana = cp >= 0x30a0 && cp <= 0x30ff;
    if (isBengali || isCyrillic || isArabic || isHiragana || isKatakana) {
      const ch = String.fromCodePoint(cp);
      const start = Math.max(0, text.lastIndexOf("\n", i));
      const end = text.indexOf("\n", i);
      hits.push({
        ch,
        cp: `U+${cp.toString(16).toUpperCase()}`,
        index: i,
        sentence: text.slice(start, end === -1 ? undefined : end).trim().slice(0, 160),
      });
      if (cp > 0xffff) i++;
    }
  }
  return {
    hasBengaliMarker: text.includes(BENGALI_MARKER),
    hitCount: hits.length,
    hits: hits.slice(0, 40),
  };
}

function loadEnoch() {
  const db = new Database(resolve("data/app.db"), { readonly: true });
  try {
    const row =
      (db
        .prepare(
          `SELECT * FROM characters WHERE id = 10 OR name LIKE ? ORDER BY CASE WHEN id = 10 THEN 0 ELSE 1 END LIMIT 1`
        )
        .get("%에녹%") as Record<string, unknown> | undefined) ||
      (db.prepare(`SELECT * FROM characters ORDER BY id LIMIT 1`).get() as
        | Record<string, unknown>
        | undefined);
    if (!row) throw new Error("no character");
    return {
      characterRow: row,
      persona: {
        name: "유저",
        description: "조심스럽고 짧게 말하는 동행자. 탐험에 익숙하지 않다.",
        gender: "other",
      },
      userNickname: "유저",
    };
  } finally {
    db.close();
  }
}

function buildScene(scene: typeof SCENE_A, fixture: ReturnType<typeof loadEnoch>) {
  const contentKind =
    fixture.characterRow.content_kind === "simulation" ? "simulation" : "character";
  const sceneCastMode = resolveRpSceneCastMode(contentKind);
  const { chunks, usedEnglish } = loadCharacterChunksForPromptReadOnly(
    fixture.characterRow as never,
    fixture.persona.name,
    fixture.userNickname
  );
  const userPersona = formatUserPersonaForPrompt(
    fixture.persona.name,
    fixture.persona.description,
    fixture.userNickname
  );
  const shortTermHistory: ChatMsg[] = scene.seed.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  const built = buildContext({
    charName: String(fixture.characterRow.name ?? "에녹"),
    chunks,
    userNickname: fixture.userNickname,
    userPersona,
    userNote: "",
    longTermMemory: "",
    archiveMemory: null,
    shortTermHistory,
    currentUserMessage: scene.userMessage,
    nsfw: !!fixture.characterRow.nsfw,
    gender:
      (fixture.characterRow.gender as "male" | "female" | "other") ?? "other",
    userId: 1,
    chatId: 0,
    targetResponseChars: TARGET,
    modelId: MODEL,
    provider: "cheaperinference",
    personaDisplayName: fixture.persona.name,
    userPersonaGender:
      (fixture.persona.gender as "male" | "female" | "other") ?? null,
    useEnglishCharacterPrompt: usedEnglish,
    contentKind,
  });
  // Production path: use built.history (includes terminal contract).
  return {
    system: built.systemPrompt ?? "",
    history: built.history,
    built,
    contentKind,
    sceneCastMode,
    terraTerminalApplied: shouldUseTerraTerminalLengthOwner({
      modelId: MODEL,
      contentKind,
    }),
  };
}

function auditPayload(
  sceneId: string,
  system: string,
  history: ChatMsg[],
  meta: {
    contentKind: string;
    sceneCastMode: string;
    terraTerminalApplied: boolean;
  }
) {
  const messages = buildOpenRouterMessages(system, history);
  const before = buildOpenRouterRequestBody(
    MODEL,
    messages,
    true,
    TARGET,
    undefined,
    TERRA_MAX_OUTPUT_TOKENS
  ) as Record<string, unknown>;
  const adapted = adaptCheaperInferenceChatBody(before);
  const adaptedMessages =
    (adapted.messages as Array<{ role?: string; content?: string }>) || [];
  const sys = String(adaptedMessages.find((m) => m.role === "system")?.content ?? "");
  const lastUser = [...adaptedMessages].reverse().find((m) => m.role === "user");
  const lastUserContent = String(lastUser?.content ?? "");
  const payloadText = adaptedMessages
    .map((m) => `${m.role}\n${String(m.content ?? "")}`)
    .join("\n\n");

  const contractCount = countNeedle(payloadText, CONTRACT);
  const targetLengthCount = countNeedle(payloadText, "TARGET_LENGTH");
  const minimumFloorCount = countNeedle(payloadText, "MINIMUM_FLOOR");
  // Length-owner keyword scan (system directives only — report hits with context).
  const lengthOwnerNeedles = [
    "TARGET_LENGTH",
    "MINIMUM_FLOOR",
    "3,200",
    "4,200",
    "2,700",
    "장편",
    "조기 종료",
    "최대 전개",
    "length control",
    "LENGTH CONTROL",
    "terminal length",
    "TERMINAL LENGTH",
  ];
  const lengthOwnerHits: Array<{ needle: string; count: number; sample?: string }> = [];
  for (const needle of lengthOwnerNeedles) {
    const count = countNeedle(payloadText, needle);
    if (count > 0) {
      const idx = payloadText.indexOf(needle);
      lengthOwnerHits.push({
        needle,
        count,
        sample: payloadText.slice(Math.max(0, idx - 40), idx + needle.length + 80).replace(/\s+/g, " "),
      });
    }
  }

  // Contract occurrences of 3,200/4,200 are expected once in the terminal contract.
  const contractHas3200 = CONTRACT.includes("3,200");
  const otherLengthOwners = lengthOwnerHits.filter((h) => {
    if (h.needle === "3,200" || h.needle === "4,200") {
      // Allow only the terminal contract's numbers.
      return h.count > (contractHas3200 ? contractCount : 0);
    }
    if (h.needle === CONTRACT.slice(0, 10)) return false;
    // NARRATIVE DENSITY keeps TARGET/FLOOR wording by experiment scope — not TARGET_LENGTH.
    return !["3,200", "4,200"].includes(h.needle) || h.count > contractCount;
  });

  const afterContract = lastUserContent.includes(CONTRACT)
    ? lastUserContent.slice(lastUserContent.indexOf(CONTRACT) + CONTRACT.length).trim()
    : null;
  const contractIsLastRpInstruction =
    !!lastUserContent.trimEnd().endsWith(CONTRACT) && !afterContract;

  const sectionHints = [
    "[SCENE EXPANSION]",
    "[LENGTH CONTROL & SCENE EXPANSION]",
    "[SCENE CONTINUATION PRIORITY]",
    "[NARRATIVE DENSITY]",
    "rule-terminal",
    "레이아웃:",
  ]
    .map((label) => {
      const inSys = sys.includes(label.replace("rule-terminal", "TARGET_LENGTH"));
      const inUser = lastUserContent.includes(label);
      const posSys = sys.indexOf(label);
      const posUser = lastUserContent.indexOf(label);
      return {
        label,
        inSystem: posSys >= 0 || (label === "rule-terminal" && sys.includes("TARGET_LENGTH")),
        inUser: posUser >= 0 || (label.startsWith("레이아웃") && lastUserContent.includes("레이아웃")),
        systemIndex: posSys,
        userIndex: posUser,
      };
    });

  const bengaliInPayload =
    /[\u0980-\u09FF]/.test(payloadText) || payloadText.includes(BENGALI_MARKER);

  const audit = {
    scene: sceneId,
    contentKind: meta.contentKind,
    sceneCastMode: meta.sceneCastMode,
    terraTerminalApplied: meta.terraTerminalApplied,
    terminalContractCount: contractCount,
    terminalContractExactOnce: contractCount === 1,
    TARGET_LENGTH: targetLengthCount,
    MINIMUM_FLOOR: minimumFloorCount,
    otherLengthOwnerHits: lengthOwnerHits,
    contractIsLastOnUserTurn: contractIsLastRpInstruction,
    afterContractInstructions: afterContract || "(none)",
    reasoning_effort: adapted.reasoning_effort,
    max_tokens: adapted.max_tokens,
    temperature: adapted.temperature,
    bengaliInputContamination: bengaliInPayload ? "FOUND" : "none",
    terraDialogueAdapter: /\[TERRA|dialogue adapter|3~6개 발화/i.test(payloadText),
    lunaAdapter: /LUNA.*ADAPTER|\[LUNA/i.test(payloadText),
    sectionHints,
    lastUserTail1000: lastUserContent.slice(-1000),
    systemTail800: sys.slice(-800),
  };

  const hardFail: string[] = [];
  if (!meta.terraTerminalApplied) hardFail.push("terra terminal not applied");
  if (meta.sceneCastMode !== "single_primary") hardFail.push(`sceneCastMode=${meta.sceneCastMode}`);
  if (contractCount !== 1) hardFail.push(`terminal contract count=${contractCount}`);
  if (targetLengthCount !== 0) hardFail.push(`TARGET_LENGTH=${targetLengthCount}`);
  if (minimumFloorCount !== 0) hardFail.push(`MINIMUM_FLOOR=${minimumFloorCount}`);
  if (adapted.reasoning_effort !== "none") hardFail.push("reasoning_effort != none");
  if (adapted.max_tokens !== TERRA_MAX_OUTPUT_TOKENS) {
    hardFail.push(`max_tokens=${String(adapted.max_tokens)}`);
  }
  if (bengaliInPayload) hardFail.push("Bengali input contamination");
  if (audit.terraDialogueAdapter) hardFail.push("Terra dialogue adapter present");
  if (audit.lunaAdapter) hardFail.push("Luna adapter present");
  if (!contractIsLastRpInstruction) hardFail.push("terminal contract not last on user turn");

  return { audit, hardFail, adapted };
}

async function callScene(scene: typeof SCENE_A, system: string, history: ChatMsg[]) {
  const t0 = performance.now();
  const result = await streamOpenRouterAdultToClient(
    () => {},
    system,
    history,
    MODEL,
    "terra-terminal-owner",
    TARGET,
    {
      transportProvider: "cheaperinference",
      allowOpenRouterUnderLengthRecovery: false,
      maxTokensOverride: TERRA_MAX_OUTPUT_TOKENS,
      charName: "에녹",
      personaName: "유저",
    }
  );
  const latencyMs = Math.round(performance.now() - t0);
  const providerRaw = result.rawStreamText || result.text || "";
  const finalText = getCanonicalProseBody(result.text) || result.text || "";
  return {
    ok: providerRaw.trim().length > 0,
    providerRaw,
    finalText,
    latencyMs,
    stage: result.stage,
    recoveryStage: result.recoveryStage,
    removalTraceSteps: result.removalTraceSteps?.map((s) => ({
      id: s.id,
      beforeChars: s.before?.length ?? null,
      afterChars: s.after?.length ?? null,
    })),
  };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  if (!process.env.CHEAPER_INFERENCE_API_KEY?.trim()) {
    throw new Error("CHEAPER_INFERENCE_API_KEY missing in env");
  }
  console.log(
    JSON.stringify({
      phase: "start",
      model: MODEL,
      keyPresent: true,
      maxTokens: TERRA_MAX_OUTPUT_TOKENS,
      out: OUT,
    })
  );

  const fixture = loadEnoch();
  if (!existsSync(resolve("data/app.db"))) throw new Error("missing db");

  for (const scene of [SCENE_A, SCENE_B]) {
    const built = buildScene(scene, fixture);
    const { audit, hardFail } = auditPayload(scene.id, built.system, built.history, {
      contentKind: built.contentKind,
      sceneCastMode: built.sceneCastMode,
      terraTerminalApplied: built.terraTerminalApplied,
    });
    writeFileSync(
      resolve(OUT, `scene-${scene.id}-payload-audit.json`),
      JSON.stringify(audit, null, 2),
      "utf8"
    );
    console.log(
      JSON.stringify({
        phase: "preflight",
        scene: scene.id,
        sceneCastMode: audit.sceneCastMode,
        terminalContractCount: audit.terminalContractCount,
        TARGET_LENGTH: audit.TARGET_LENGTH,
        MINIMUM_FLOOR: audit.MINIMUM_FLOOR,
        reasoning_effort: audit.reasoning_effort,
        max_tokens: audit.max_tokens,
        contractIsLastOnUserTurn: audit.contractIsLastOnUserTurn,
        afterContract: audit.afterContractInstructions,
        hardFail,
      })
    );
    if (hardFail.length) {
      throw new Error(`preflight failed scene ${scene.id}: ${hardFail.join("; ")}`);
    }

    console.log(JSON.stringify({ phase: "call-start", scene: scene.id }));
    const call = await callScene(scene, built.system, built.history);

    const providerRaw = call.providerRaw;
    const finalText = call.finalText;
    const foreignProvider = scanForeign(providerRaw);
    const foreignFinal = scanForeign(finalText);
    const dialogue = extractDialogueBlocks(finalText);
    const paragraphs = finalText
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);

    writeFileSync(resolve(OUT, `scene-${scene.id}-provider-raw.txt`), providerRaw, "utf8");
    writeFileSync(resolve(OUT, `scene-${scene.id}-final.txt`), finalText, "utf8");
    if (providerRaw !== finalText) {
      writeFileSync(
        resolve(OUT, `scene-${scene.id}-raw-vs-final.diff.txt`),
        [
          `--- provider-raw (${providerRaw.length} chars)`,
          `+++ final (${finalText.length} chars)`,
          `deltaChars: ${providerRaw.length - finalText.length}`,
          "",
          "=== PROVIDER RAW ===",
          providerRaw,
          "",
          "=== FINAL ===",
          finalText,
        ].join("\n"),
        "utf8"
      );
    }

    const stage = call.stage as {
      input?: number;
      output?: number;
      finishReason?: string;
      apiReasoningOutputTokens?: number;
      lengthRecoveryPasses?: number;
      truncated?: boolean;
    };
    const stageAny = call.stage as Record<string, unknown>;
    const metrics = {
      scene: scene.id,
      model: MODEL,
      provider: "cheaperinference",
      baseURL: CHEAPER_INFERENCE_BASE_URL,
      endpoint: CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
      api: "chat.completions",
      contentKind: built.contentKind,
      sceneCastMode: built.sceneCastMode,
      terraTerminalApplied: built.terraTerminalApplied,
      httpStatus: call.ok ? 200 : null,
      finish_reason: stage.finishReason ?? null,
      incomplete_details: null,
      inputTokens: stage.input ?? null,
      cacheReadTokens: stageAny.cacheReadTokens ?? null,
      cacheWriteTokens: stageAny.cacheWriteTokens ?? null,
      outputTokens: stage.output ?? null,
      reasoningTokens:
        typeof stage.apiReasoningOutputTokens === "number"
          ? { status: "reported", value: stage.apiReasoningOutputTokens }
          : {
              status: "reported_or_absent_via_stage",
              value: stage.apiReasoningOutputTokens ?? 0,
            },
      usageCost: stageAny.upstreamCostUsd ?? null,
      latencyMs: call.latencyMs,
      providerRawCharsTotal: providerRaw.length,
      providerRawCharsNoWs: providerRaw.replace(/\s+/g, "").length,
      finalCharsTotal: finalText.length,
      finalCharsNoWs: finalText.replace(/\s+/g, "").length,
      koreanChars: koreanCharCount(finalText),
      paragraphCount: paragraphs.length,
      dialogueBlockCount: dialogue.length,
      retry: 0,
      continuation: 0,
      recoveryCall: call.recoveryStage ? 1 : 0,
      lengthRecoveryPasses: stage.lengthRecoveryPasses ?? 0,
      max_tokens: TERRA_MAX_OUTPUT_TOKENS,
      temperature: audit.temperature,
      preflight: {
        terminalContractCount: audit.terminalContractCount,
        TARGET_LENGTH: audit.TARGET_LENGTH,
        MINIMUM_FLOOR: audit.MINIMUM_FLOOR,
        reasoning_effort: audit.reasoning_effort,
        bengaliInputContamination: audit.bengaliInputContamination,
        terraDialogueAdapter: audit.terraDialogueAdapter,
        lunaAdapter: audit.lunaAdapter,
        contractIsLastOnUserTurn: audit.contractIsLastOnUserTurn,
        afterContractInstructions: audit.afterContractInstructions,
      },
      foreignScriptProvider: foreignProvider,
      foreignScriptFinal: foreignFinal,
      postprocessDeltaChars: providerRaw.length - finalText.length,
      removalTraceSteps: call.removalTraceSteps,
      truncated: stage.truncated ?? null,
    };

    writeFileSync(
      resolve(OUT, `scene-${scene.id}-metrics.json`),
      JSON.stringify(metrics, null, 2),
      "utf8"
    );

    console.log(
      JSON.stringify({
        phase: "call-done",
        scene: scene.id,
        ok: call.ok,
        finish_reason: metrics.finish_reason,
        providerRawCharsNoWs: metrics.providerRawCharsNoWs,
        finalCharsNoWs: metrics.finalCharsNoWs,
        dialogueBlockCount: metrics.dialogueBlockCount,
        paragraphCount: metrics.paragraphCount,
        latencyMs: metrics.latencyMs,
        inputTokens: metrics.inputTokens,
        outputTokens: metrics.outputTokens,
        recoveryCall: metrics.recoveryCall,
        bengaliProvider: foreignProvider.hasBengaliMarker,
        bengaliFinal: foreignFinal.hasBengaliMarker,
      })
    );
  }

  console.log(JSON.stringify({ phase: "done", out: OUT }));
}

main().catch((err) => {
  console.error(String((err as Error)?.stack || err));
  process.exit(1);
});
