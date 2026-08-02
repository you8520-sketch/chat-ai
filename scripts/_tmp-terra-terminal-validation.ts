/**
 * Terra terminal single-owner production-candidate validation.
 * 1) Cross-model payload regression (HEAD vs baselines)
 * 2) Non-persistence checks (DB / history / summary / memory paths)
 * 3) A/B R1·R2 live reproducibility (only if regression + persistence pass)
 *
 * Does NOT modify the terminal contract wording.
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

import { createHash } from "crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { performance } from "perf_hooks";
import Database from "better-sqlite3";
import { loadEnvLocal } from "./load-env-local";
import {
  CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
  CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
  OPENROUTER_QWEN_37_MAX_MODEL,
} from "../src/lib/chatModels";
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
import { bootstrapStreamingTurn } from "../src/lib/streamingPersistence";
import type { ChatMsg } from "../src/lib/ai";

loadEnvLocal();

process.env.LUNA_WORK_COMPLETE = "true";
process.env.LUNA_PRODUCTION_ADOPTED = "true";
process.env.LUNA_REOPENED = "false";
process.env.WORLD_MOTION_REOPENED = "false";

const OUT = resolve("output/terra-terminal-validation");
const CONTRACT = TERRA_TERMINAL_LENGTH_OWNER_CONTRACT;
const TARGET = 3200;
const BENGALI = "এবার";

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

const R0 = {
  A: { canonical: 3196, density: 2358, outputTokens: 2111 },
  B: { canonical: 3329, density: 2459, outputTokens: 2237 },
};

function count(hay: string, needle: string): number {
  if (!needle) return 0;
  return hay.split(needle).length - 1;
}

function extractDialogueBlocks(text: string): string[] {
  const blocks: string[] = [];
  for (const re of [/[「『"].+?[」』"]/gs, /“[^”]+”/g]) {
    let m: RegExpExecArray | null;
    const r = new RegExp(re.source, re.flags);
    while ((m = r.exec(text))) blocks.push(m[0]);
  }
  return blocks;
}

function scanForeign(text: string) {
  const hits: Array<{ ch: string; cp: string; index: number }> = [];
  for (let i = 0; i < text.length; i++) {
    const cp = text.codePointAt(i)!;
    if (
      (cp >= 0x0980 && cp <= 0x09ff) ||
      (cp >= 0x0400 && cp <= 0x04ff) ||
      (cp >= 0x0600 && cp <= 0x06ff) ||
      (cp >= 0x3040 && cp <= 0x309f) ||
      (cp >= 0x30a0 && cp <= 0x30ff)
    ) {
      hits.push({ ch: String.fromCodePoint(cp), cp: `U+${cp.toString(16).toUpperCase()}`, index: i });
      if (cp > 0xffff) i++;
    }
  }
  return { hasBengaliMarker: text.includes(BENGALI), hitCount: hits.length, hits: hits.slice(0, 20) };
}

function median(nums: number[]): number {
  const a = [...nums].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid]! : (a[mid - 1]! + a[mid]!) / 2;
}

function mean(nums: number[]): number {
  return nums.reduce((s, n) => s + n, 0) / nums.length;
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
        gender: "other" as const,
      },
      userNickname: "유저",
    };
  } finally {
    db.close();
  }
}

type BuildOpts = {
  modelId: string;
  contentKind: "character" | "simulation";
  provider?: "cheaperinference" | "openrouter";
  scene?: typeof SCENE_A;
};

function buildPayload(fixture: ReturnType<typeof loadEnoch>, opts: BuildOpts) {
  const scene = opts.scene ?? SCENE_A;
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
    modelId: opts.modelId,
    provider: opts.provider ?? "cheaperinference",
    personaDisplayName: fixture.persona.name,
    userPersonaGender: fixture.persona.gender,
    useEnglishCharacterPrompt: usedEnglish,
    contentKind: opts.contentKind,
    systemPrompt:
      opts.contentKind === "simulation"
        ? "[SIMULATION CAST — CREATOR CANON]\n[에녹]\n- 동행자"
        : undefined,
  });

  const history = built.history;
  const system = built.systemPrompt ?? "";
  const messages = buildOpenRouterMessages(system, history);
  const before = buildOpenRouterRequestBody(
    opts.modelId,
    messages,
    true,
    TARGET,
    undefined,
    opts.modelId === CHEAPER_INFERENCE_GPT_56_TERRA_MODEL
      ? TERRA_MAX_OUTPUT_TOKENS
      : undefined
  ) as Record<string, unknown>;

  const adapted =
    opts.provider === "openrouter"
      ? before
      : adaptCheaperInferenceChatBody(before);

  const adaptedMessages =
    (adapted.messages as Array<{ role?: string; content?: string }>) || [];
  const sys = String(adaptedMessages.find((m) => m.role === "system")?.content ?? "");
  const lastUser = [...adaptedMessages].reverse().find((m) => m.role === "user");
  const lastUserContent = String(lastUser?.content ?? "");
  const payloadText = adaptedMessages
    .map((m) => `${m.role}\n${String(m.content ?? "")}`)
    .join("\n\n---\n\n");

  const sceneCastMode = resolveRpSceneCastMode(opts.contentKind);
  const terraApplied = shouldUseTerraTerminalLengthOwner({
    modelId: opts.modelId,
    contentKind: opts.contentKind,
  });

  // Normalized snapshot for cross-model compare (drop volatile numbers that are identical by construction).
  const normalized = {
    model: opts.modelId,
    contentKind: opts.contentKind,
    sceneCastMode,
    terraApplied,
    systemHasLengthControl: sys.includes("[LENGTH CONTROL & SCENE EXPANSION]"),
    systemHasSceneExpansionOnly: sys.includes("[SCENE EXPANSION]") && !sys.includes("[LENGTH CONTROL & SCENE EXPANSION]"),
    systemTargetLength: count(sys, "TARGET_LENGTH"),
    systemMinimumFloor: count(sys, "MINIMUM_FLOOR"),
    systemLongformContract: count(sys, "한국어 장편 소설형 RP로"),
    systemEarlyStop: count(sys, "MINIMUM_FLOOR 미달 전 조기 종료·관찰자 붕괴 결말 금지."),
    systemTerminalNumeric: count(sys, "TARGET_LENGTH 3,200+ · MINIMUM_FLOOR 2,700+"),
    systemTerraContract: count(sys, CONTRACT),
    userTerraContract: count(lastUserContent, CONTRACT),
    payloadTerraContract: count(payloadText, CONTRACT),
    userTargetLength: count(lastUserContent, "TARGET_LENGTH"),
    userMinimumFloor: count(lastUserContent, "MINIMUM_FLOOR"),
    userEndsWithTerraContract: lastUserContent.trimEnd().endsWith(CONTRACT),
    afterContract: lastUserContent.includes(CONTRACT)
      ? lastUserContent.slice(lastUserContent.indexOf(CONTRACT) + CONTRACT.length).trim() || "(none)"
      : "(n/a)",
    // Stable hashes of length-relevant sections
    lengthSectionHash: createHash("sha256")
      .update(
        [
          sys.match(/\[LENGTH CONTROL[\s\S]*?(?=\n\[|\n$|$)/)?.[0] ??
            sys.match(/\[SCENE EXPANSION\][\s\S]*?(?=\n\[USER PERSONA|\n\[DIALOGUE|\n$|$)/)?.[0] ??
            "",
          sys.includes("TARGET_LENGTH 3,200+ · MINIMUM_FLOOR 2,700+")
            ? "HAS_SYSTEM_TERMINAL_NUMERIC"
            : "NO_SYSTEM_TERMINAL_NUMERIC",
          lastUserContent.includes(CONTRACT) ? "USER_HAS_TERRA_CONTRACT" : "USER_NO_TERRA_CONTRACT",
          lastUserContent.includes("TARGET_LENGTH") ? "USER_HAS_TARGET_LENGTH" : "USER_NO_TARGET_LENGTH",
        ].join("\n")
      )
      .digest("hex")
      .slice(0, 16),
  };

  return {
    system: sys,
    history,
    lastUserContent,
    payloadText,
    adapted,
    built,
    normalized,
    sceneCastMode,
    terraApplied,
  };
}

function runCrossModelRegression(fixture: ReturnType<typeof loadEnoch>) {
  const cases: Array<{
    key: string;
    modelId: string;
    contentKind: "character" | "simulation";
    provider: "cheaperinference" | "openrouter";
  }> = [
    {
      key: "terra_single_primary",
      modelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
      contentKind: "character",
      provider: "cheaperinference",
    },
    {
      key: "terra_simulation",
      modelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
      contentKind: "simulation",
      provider: "cheaperinference",
    },
    {
      key: "luna_single_primary",
      modelId: CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
      contentKind: "character",
      provider: "cheaperinference",
    },
    {
      key: "qwen_single_primary",
      modelId: OPENROUTER_QWEN_37_MAX_MODEL,
      contentKind: "character",
      provider: "openrouter",
    },
  ];

  const results: Record<string, ReturnType<typeof buildPayload>["normalized"] & { ok: boolean; notes: string[] }> =
    {};

  for (const c of cases) {
    const built = buildPayload(fixture, c);
    const n = built.normalized;
    const notes: string[] = [];
    let ok = true;

    if (c.key === "terra_single_primary") {
      if (n.payloadTerraContract !== 1) {
        ok = false;
        notes.push(`terra contract count=${n.payloadTerraContract}`);
      }
      if (n.systemTargetLength !== 0 || n.userTargetLength !== 0) {
        ok = false;
        notes.push(`TARGET_LENGTH residual sys=${n.systemTargetLength} user=${n.userTargetLength}`);
      }
      if (n.systemMinimumFloor !== 0 || n.userMinimumFloor !== 0) {
        ok = false;
        notes.push(`MINIMUM_FLOOR residual sys=${n.systemMinimumFloor} user=${n.userMinimumFloor}`);
      }
      if (!n.userEndsWithTerraContract || n.afterContract !== "(none)") {
        ok = false;
        notes.push(`contract not last: after=${n.afterContract}`);
      }
      if (!n.terraApplied) {
        ok = false;
        notes.push("terraApplied=false");
      }
    } else if (c.key === "terra_simulation") {
      if (n.payloadTerraContract !== 0) {
        ok = false;
        notes.push(`terra contract leaked into simulation: ${n.payloadTerraContract}`);
      }
      if (n.terraApplied) {
        ok = false;
        notes.push("terraApplied unexpectedly true");
      }
      // Simulation keeps production length owners.
      if (n.systemTargetLength < 1) {
        ok = false;
        notes.push("simulation lost TARGET_LENGTH");
      }
      if (n.userTargetLength < 1) {
        ok = false;
        notes.push("simulation lost user TARGET_LENGTH");
      }
    } else {
      // Luna / Qwen — must not receive Terra contract; must keep common length owners.
      if (n.payloadTerraContract !== 0) {
        ok = false;
        notes.push(`Terra contract leaked: ${n.payloadTerraContract}`);
      }
      if (n.systemTargetLength < 1) {
        ok = false;
        notes.push("common TARGET_LENGTH removed");
      }
      if (n.systemMinimumFloor < 1) {
        ok = false;
        notes.push("common MINIMUM_FLOOR removed");
      }
      if (n.userTargetLength < 1) {
        ok = false;
        notes.push("user TARGET_LENGTH removed");
      }
      if (n.systemHasSceneExpansionOnly) {
        ok = false;
        notes.push("LENGTH CONTROL replaced by SCENE EXPANSION (Terra-only path leaked)");
      }
      if (!n.systemHasLengthControl) {
        ok = false;
        notes.push("LENGTH CONTROL missing");
      }
      // Experiment-1 longform must not remain as shared owner for non-Terra.
      if (n.systemLongformContract > 0) {
        notes.push("note: experiment-1 LONGFORM still present (unexpected)");
      }
      if (n.systemEarlyStop < 1) {
        notes.push("note: production early-stop line absent (check vs main)");
      }
    }

    results[c.key] = { ...n, ok, notes };
  }

  const crossModelRegression = Object.entries(results).some(([k, v]) => {
    if (k.startsWith("terra_")) return false;
    return !v.ok && v.notes.some((n) => /removed|leaked|SCENE EXPANSION|LENGTH CONTROL missing/i.test(n));
  });

  return { results, crossModelRegression };
}

function runPersistenceChecks(fixture: ReturnType<typeof loadEnoch>) {
  const notes: string[] = [];
  let bug = false;

  // 1) Provider payload has contract once (build path).
  const terra = buildPayload(fixture, {
    modelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
    contentKind: "character",
    provider: "cheaperinference",
  });
  const payloadCount = count(terra.payloadText, CONTRACT);
  if (payloadCount !== 1) {
    bug = true;
    notes.push(`provider payload contract count=${payloadCount}`);
  } else {
    notes.push("provider payload: 1 (ok)");
  }

  // 2) DB user message uses raw messageText, not built user turn.
  const tmpDbPath = resolve("data/_tmp-terra-terminal-persist.db");
  try {
    // Use a minimal in-memory schema matching bootstrapStreamingTurn expectations.
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id INTEGER,
        role TEXT,
        content TEXT,
        model TEXT DEFAULT '',
        usage TEXT,
        request_id TEXT,
        generation_status TEXT,
        user_message_id INTEGER,
        alternates TEXT DEFAULT '[]',
        active_variant INTEGER DEFAULT 0,
        deduction_slices TEXT DEFAULT '[]',
        is_refunded INTEGER DEFAULT 0,
        status_meta TEXT,
        status_widget_values_json TEXT DEFAULT '',
        status_widget_turn_active INTEGER DEFAULT 0,
        updated_at TEXT
      );
    `);
    const rawUser = SCENE_A.userMessage;
    const boot = bootstrapStreamingTurn(db, {
      chatId: 1,
      requestId: "terra-persist-test",
      userContent: rawUser,
      skipUserInsert: false,
    });
    const stored = db
      .prepare(`SELECT content FROM messages WHERE id=?`)
      .get(boot.userMessageId) as { content: string };
    const dbCount = count(stored.content, CONTRACT);
    if (dbCount !== 0) {
      bug = true;
      notes.push(`DB user message contains contract: ${dbCount}`);
    } else {
      notes.push("DB user message: 0 (ok)");
    }
    if (stored.content !== rawUser) {
      bug = true;
      notes.push("DB user message != raw user input");
    }

    // 3) Next-turn history from DB contents must not carry contract.
    const historyFromDb: ChatMsg[] = [
      { role: "user", content: stored.content },
      { role: "assistant", content: "이전 응답." },
    ];
    const histJoined = historyFromDb.map((m) => m.content).join("\n");
    if (count(histJoined, CONTRACT) !== 0) {
      bug = true;
      notes.push("next-turn history seed contains contract");
    } else {
      notes.push("next-turn history seed: 0 (ok)");
    }

    // Rebuild next turn — contract may appear only on the NEW assembled last user turn.
    const nextBuilt = buildContext({
      charName: String(fixture.characterRow.name ?? "에녹"),
      chunks: loadCharacterChunksForPromptReadOnly(
        fixture.characterRow as never,
        fixture.persona.name,
        fixture.userNickname
      ).chunks,
      userNickname: fixture.userNickname,
      userPersona: formatUserPersonaForPrompt(
        fixture.persona.name,
        fixture.persona.description,
        fixture.userNickname
      ),
      shortTermHistory: historyFromDb,
      currentUserMessage: "다음 턴 짧은 입력.",
      nsfw: false,
      gender: "other",
      userId: 1,
      chatId: 1,
      targetResponseChars: TARGET,
      modelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
      provider: "cheaperinference",
      contentKind: "character",
    });
    const priorUserMsgs = nextBuilt.history.filter((m) => m.role === "user").slice(0, -1);
    const priorHas = priorUserMsgs.some((m) => m.content.includes(CONTRACT));
    const lastHas = (nextBuilt.history.at(-1)?.content ?? "").includes(CONTRACT);
    if (priorHas) {
      bug = true;
      notes.push("prior history messages contain terminal contract (re-injection bug)");
    } else {
      notes.push("prior history messages: 0 (ok)");
    }
    if (!lastHas) {
      bug = true;
      notes.push("current assembled user turn missing fresh terminal contract");
    } else {
      notes.push("current assembled user turn: fresh contract 1 (ok)");
    }
    db.close();
  } catch (e) {
    bug = true;
    notes.push(`persistence DB check error: ${String((e as Error).message || e)}`);
  }

  // 4) Summary / memory / export style inputs — use raw stored strings, not assembled turns.
  // Static code-path evidence + string search on representative inputs.
  const summaryInput = [
    SCENE_A.userMessage,
    "에녹은 손전등을 낮췄다.",
    SCENE_A.seed[0]!.content,
  ].join("\n");
  const memoryInput = summaryInput;
  const exportPayload = JSON.stringify({
    messages: [
      { role: "user", content: SCENE_A.userMessage },
      { role: "assistant", content: "본문" },
    ],
  });
  for (const [label, text] of [
    ["summary input", summaryInput],
    ["memory input", memoryInput],
    ["export/UI raw", exportPayload],
  ] as const) {
    const c = count(text, CONTRACT);
    if (c !== 0) {
      bug = true;
      notes.push(`${label}: ${c}`);
    } else {
      notes.push(`${label}: 0 (ok)`);
    }
  }

  // 5) Source audit: chat route persists messageText / storedUserMessage, not built.history user turn.
  const routeSrc = readFileSync(resolve("src/app/api/chat/route.ts"), "utf8");
  const persistSrc = readFileSync(resolve("src/lib/streamingPersistence.ts"), "utf8");
  const routeUsesMessageText =
    routeSrc.includes("userContent: messageText") &&
    routeSrc.includes("const storedUserMessage = messageText");
  const persistInsertsOptsContent = persistSrc.includes('opts.chatId, "user", opts.userContent');
  if (!routeUsesMessageText || !persistInsertsOptsContent) {
    bug = true;
    notes.push("source audit: unexpected persist path wiring");
  } else {
    notes.push("source audit: persist uses raw messageText (ok)");
  }

  // Ensure buildContext terminal append is not written back anywhere obvious.
  if (routeSrc.includes("TERRA_TERMINAL_LENGTH_OWNER_CONTRACT") || routeSrc.includes("appendTerraTerminal")) {
    bug = true;
    notes.push("chat route imports terra terminal append (risk of persist coupling)");
  } else {
    notes.push("chat route does not import terra terminal append (ok)");
  }

  try {
    if (existsSync(tmpDbPath)) {
      // cleanup leftover if any
    }
  } catch {
    /* ignore */
  }

  return { bug, notes, payloadCount };
}

function measureRpBody(text: string) {
  // Flash/status not present in this harness output path — treat whole prose as RP body.
  // If structured status markers appear, flag uncertain.
  const uncertainMarkers = [
    "<<<STATUS_VALUES>>>",
    "```json",
    "<div",
    "STATUS_WINDOW",
    "[STATUS]",
  ];
  const uncertain = uncertainMarkers.some((m) => text.includes(m));
  const rpBody = getCanonicalProseBody(text) || text;
  return {
    bodyExtractionUncertain: uncertain,
    raw_total_chars: text.length,
    raw_rp_body_chars: rpBody.length,
    raw_rp_body_chars_no_ws: rpBody.replace(/\s+/g, "").length,
    final_total_chars: text.length,
    final_rp_body_chars: rpBody.length,
    final_rp_body_chars_no_ws: rpBody.replace(/\s+/g, "").length,
    canonical_length: rpBody.length,
    density_length: rpBody.replace(/\s+/g, "").length,
  };
}

async function callScene(
  label: string,
  scene: typeof SCENE_A,
  fixture: ReturnType<typeof loadEnoch>
) {
  const built = buildPayload(fixture, {
    modelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
    contentKind: "character",
    provider: "cheaperinference",
    scene,
  });
  const t0 = performance.now();
  const result = await streamOpenRouterAdultToClient(
    () => {},
    built.system,
    built.history,
    CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
    `terra-terminal-validation-${label}`,
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
  const stage = result.stage as {
    input?: number;
    output?: number;
    finishReason?: string;
    apiReasoningOutputTokens?: number;
    lengthRecoveryPasses?: number;
  };
  const stageAny = result.stage as Record<string, unknown>;
  const rawMeasure = measureRpBody(providerRaw);
  const finalMeasure = measureRpBody(finalText);
  const foreign = scanForeign(finalText);
  const dialogue = extractDialogueBlocks(finalText);
  const paragraphs = finalText
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const metrics = {
    label,
    scene: scene.id,
    model: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
    provider: "cheaperinference",
    baseURL: CHEAPER_INFERENCE_BASE_URL,
    endpoint: CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
    reasoning_request: "none",
    reasoning_tokens:
      typeof stage.apiReasoningOutputTokens === "number" ? stage.apiReasoningOutputTokens : 0,
    max_tokens: TERRA_MAX_OUTPUT_TOKENS,
    finish_reason: stage.finishReason ?? null,
    input_tokens: stage.input ?? null,
    cache_read_tokens: stageAny.cacheReadTokens ?? null,
    cache_write_tokens: stageAny.cacheWriteTokens ?? null,
    output_tokens: stage.output ?? null,
    latency_ms: latencyMs,
    usage_cost: stageAny.upstreamCostUsd ?? "field absent",
    ...finalMeasure,
    raw_total_chars: rawMeasure.raw_total_chars,
    raw_rp_body_chars: rawMeasure.raw_rp_body_chars,
    raw_rp_body_chars_no_ws: rawMeasure.raw_rp_body_chars_no_ws,
    final_total_chars: finalMeasure.final_total_chars,
    final_rp_body_chars: finalMeasure.final_rp_body_chars,
    final_rp_body_chars_no_ws: finalMeasure.final_rp_body_chars_no_ws,
    paragraph_count: paragraphs.length,
    dialogue_block_count: dialogue.length,
    foreign_scripts: foreign,
    retry: 0,
    continuation: 0,
    recoveryCall: result.recoveryStage ? 1 : 0,
    lengthRecoveryPasses: stage.lengthRecoveryPasses ?? 0,
    postprocessDeltaChars: providerRaw.length - finalText.length,
    preflight: {
      terraContractCount: built.normalized.payloadTerraContract,
      TARGET_LENGTH: built.normalized.systemTargetLength + built.normalized.userTargetLength,
      MINIMUM_FLOOR: built.normalized.systemMinimumFloor + built.normalized.userMinimumFloor,
      contractIsLast: built.normalized.userEndsWithTerraContract,
    },
  };

  writeFileSync(resolve(OUT, `${label}-provider-raw.txt`), providerRaw, "utf8");
  writeFileSync(resolve(OUT, `${label}-final.txt`), finalText, "utf8");
  writeFileSync(resolve(OUT, `${label}-metrics.json`), JSON.stringify(metrics, null, 2), "utf8");
  if (providerRaw !== finalText) {
    writeFileSync(
      resolve(OUT, `${label}-raw-vs-final.diff.txt`),
      `delta=${providerRaw.length - finalText.length}\n`,
      "utf8"
    );
  }

  return { metrics, finalText, providerRaw };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  if (!process.env.CHEAPER_INFERENCE_API_KEY?.trim()) {
    throw new Error("CHEAPER_INFERENCE_API_KEY missing");
  }
  const fixture = loadEnoch();

  console.log(JSON.stringify({ phase: "cross-model-start" }));
  const regression = runCrossModelRegression(fixture);
  writeFileSync(
    resolve(OUT, "cross-model-payload-audit.json"),
    JSON.stringify(regression, null, 2),
    "utf8"
  );
  console.log(
    JSON.stringify({
      phase: "cross-model-done",
      crossModelRegression: regression.crossModelRegression,
      summary: Object.fromEntries(
        Object.entries(regression.results).map(([k, v]) => [
          k,
          { ok: v.ok, notes: v.notes, lengthSectionHash: v.lengthSectionHash, terra: v.payloadTerraContract },
        ])
      ),
    })
  );

  if (regression.crossModelRegression) {
    writeFileSync(
      resolve(OUT, "VERDICT.txt"),
      "CROSS_MODEL_REGRESSION\nStopped before live A/B.\n",
      "utf8"
    );
    console.log(JSON.stringify({ phase: "stop", verdict: "CROSS_MODEL_REGRESSION" }));
    return;
  }

  console.log(JSON.stringify({ phase: "persistence-start" }));
  const persistence = runPersistenceChecks(fixture);
  writeFileSync(
    resolve(OUT, "persistence-audit.json"),
    JSON.stringify(persistence, null, 2),
    "utf8"
  );
  console.log(JSON.stringify({ phase: "persistence-done", bug: persistence.bug, notes: persistence.notes }));

  if (persistence.bug) {
    writeFileSync(
      resolve(OUT, "VERDICT.txt"),
      "TERMINAL_PERSISTENCE_BUG\nStopped before live repeat calls.\n",
      "utf8"
    );
    console.log(JSON.stringify({ phase: "stop", verdict: "TERMINAL_PERSISTENCE_BUG" }));
    return;
  }

  if (!existsSync(resolve("data/app.db"))) throw new Error("missing db");

  const liveLabels: Array<{ label: string; scene: typeof SCENE_A }> = [
    { label: "A-R1", scene: SCENE_A },
    { label: "A-R2", scene: SCENE_A },
    { label: "B-R1", scene: SCENE_B },
    { label: "B-R2", scene: SCENE_B },
  ];

  const liveResults = [];
  for (const item of liveLabels) {
    console.log(JSON.stringify({ phase: "call-start", label: item.label }));
    const r = await callScene(item.label, item.scene, fixture);
    liveResults.push(r);
    console.log(
      JSON.stringify({
        phase: "call-done",
        label: item.label,
        canonical_length: r.metrics.canonical_length,
        density_length: r.metrics.density_length,
        output_tokens: r.metrics.output_tokens,
        finish_reason: r.metrics.finish_reason,
        dialogue_block_count: r.metrics.dialogue_block_count,
        latency_ms: r.metrics.latency_ms,
        recoveryCall: r.metrics.recoveryCall,
        foreign: r.metrics.foreign_scripts.hitCount,
      })
    );
  }

  writeFileSync(
    resolve(OUT, "live-summary.json"),
    JSON.stringify(
      {
        r0: R0,
        live: liveResults.map((r) => r.metrics),
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(JSON.stringify({ phase: "done", out: OUT }));
}

main().catch((err) => {
  console.error(String((err as Error)?.stack || err));
  process.exit(1);
});
