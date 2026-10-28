/**
 * One-shot B22 probe. Not a runner.
 * Uses production Shared Initial owners, benchmark key only, no retry.
 * Recorded result: docs/pr-evidence/pr-b22-shared-initial-live/live.json
 * The live flag below was added after that single call.
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

import { mkdirSync, writeFileSync } from "node:fs";
import { BACKGROUND_OPENROUTER_MODEL } from "@/lib/ai";
import { isCheaperInferenceModel } from "@/lib/chatModels";
import { getDb } from "@/lib/db";
import { sanitizeEpisodicExtractedFacts } from "@/lib/memory/memory-episodic-normalize";
import {
  parseSharedEpisodicSection,
  reconcileSharedEpisodicFactsForTurn,
  shouldRequestEpisodicInSharedInitial,
} from "@/lib/memory/memory-episodic-shared";
import { getOrCreateChatMemory } from "@/lib/memory/memory-db";
import {
  buildPostTurnSharedInitialSystem,
  buildPostTurnSharedInitialUserBlock,
} from "@/lib/postTurnSharedInitial/prompt";
import { buildPostTurnSharedInitialResponseFormat } from "@/lib/postTurnSharedInitial/schema";
import { runPostTurnSharedInitial } from "@/lib/postTurnSharedInitial/run";
import type { PostTurnSharedInitialInput } from "@/lib/postTurnSharedInitial/types";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";

const USER_TEXT = "나 열두 살 때 창고에 갇힌 뒤로, 닫힌 문 소리만 나도 숨이 막혀.";
const ASSISTANT_TEXT =
  "라이크가 문고리에서 손을 떼고 한 걸음 물러섰다. \"열두 살 때 창고에 갇힌 거구나. 닫힌 문 소리에 숨이 막힌다는 말, 그냥 넘기지 않을게.\"";

const CHAT = 922001;
const USER = 922002;
const CHAR = 922003;
const USER_MESSAGE_ID = 922010;
const ASSISTANT_MESSAGE_ID = 922011;

function assertPreflight(input: PostTurnSharedInitialInput): void {
  installIsolatedTestDatabase();
  const db = getDb();
  db.prepare(`INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`).run(
    USER,
    "b22@test.local",
    "렌",
    "x"
  );
  db.prepare(`INSERT INTO characters (id, name) VALUES (?,?)`).run(CHAR, "라이크");
  db.prepare(`INSERT INTO chats (id, user_id, character_id, mode) VALUES (?,?,?,'safe')`).run(
    CHAT,
    USER,
    CHAR
  );
  getOrCreateChatMemory(CHAT, USER, CHAR, "free");
  db.prepare(`INSERT INTO messages (id, chat_id, role, content) VALUES (?,?,?,?)`).run(
    USER_MESSAGE_ID,
    CHAT,
    "user",
    USER_TEXT
  );
  db.prepare(
    `INSERT INTO messages (id, chat_id, role, content, user_message_id, generation_status, model)
     VALUES (?, ?, 'assistant', ?, ?, 'completed', 'probe')`
  ).run(ASSISTANT_MESSAGE_ID, CHAT, ASSISTANT_TEXT, USER_MESSAGE_ID);

  const eligible = shouldRequestEpisodicInSharedInitial({
    userMessage: USER_TEXT,
    db,
    chatId: CHAT,
    sourceUserMessageId: USER_MESSAGE_ID,
  });
  if (!eligible) throw new Error("PREFLIGHT_EPISODIC_ELIGIBILITY_FALSE");

  const system = buildPostTurnSharedInitialSystem(input);
  const userBlock = buildPostTurnSharedInitialUserBlock(input);
  const format = buildPostTurnSharedInitialResponseFormat(input);
  const schema = JSON.stringify(format);
  if (!input.includeEpisodic) throw new Error("PREFLIGHT_INCLUDE_EPISODIC_FALSE");
  if (!schema.includes("extracted_facts")) throw new Error("PREFLIGHT_SCHEMA_MISSING_EPISODIC");
  if (!userBlock.includes(USER_TEXT) || !userBlock.includes(ASSISTANT_TEXT)) {
    throw new Error("PREFLIGHT_SOURCE_TEXT_MISSING");
  }
  if (!system.includes("extracted_facts")) throw new Error("PREFLIGHT_SYSTEM_MISSING_EPISODIC");
  writeFileSync(
    "/tmp/b22-preflight.json",
    JSON.stringify({
      eligible,
      includeEpisodic: input.includeEpisodic,
      includeRelationship: input.includeRelationship,
      includeSuggestions: input.includeSuggestions,
      mode: input.mode,
      model: input.primaryModelId,
      cheaperInferenceModel: isCheaperInferenceModel(input.primaryModelId),
      systemChars: system.length,
      userChars: userBlock.length,
    })
  );
}

async function main(): Promise<void> {
  if (process.env.B22_SHARED_INITIAL_LIVE !== "1") {
    throw new Error("STOP_LIVE_FLAG_REQUIRED");
  }
  const benchmark = process.env.CHEAPER_INFERENCE_BENCHMARK_API_KEY?.trim() ?? "";
  const production = process.env.CHEAPER_INFERENCE_API_KEY?.trim() ?? "";
  if (!benchmark) throw new Error("STOP_NO_BENCHMARK_KEY");
  if (benchmark === production) throw new Error("STOP_BENCHMARK_EQUALS_PRODUCTION");
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.CHEAPER_INFERENCE_API_KEY;
  process.env.CHEAPER_INFERENCE_API_KEY = benchmark;

  const input: PostTurnSharedInitialInput = {
    mode: "relationship_only",
    charName: "라이크",
    personaName: "렌",
    userPersona: null,
    personaDescription: null,
    personaSpeechExamples: null,
    userMessage: USER_TEXT,
    assistantProse: ASSISTANT_TEXT,
    primaryModelId: BACKGROUND_OPENROUTER_MODEL,
    includeSuggestions: true,
    includeRelationship: true,
    includeEpisodic: true,
    relationshipRegenContext: null,
    activePromises: [],
    episodicCorrectionCandidates: [],
  };

  assertPreflight(input);
  const system = buildPostTurnSharedInitialSystem(input);
  const userBlock = buildPostTurnSharedInitialUserBlock(input);
  const responseFormat = buildPostTurnSharedInitialResponseFormat(input);

  const result = await runPostTurnSharedInitial(input);
  let rawFacts: unknown = null;
  try {
    const parsedJson = JSON.parse(result.text) as { episodic?: { extracted_facts?: unknown } };
    rawFacts = parsedJson.episodic?.extracted_facts ?? null;
  } catch {
    rawFacts = null;
  }
  const rawCount = Array.isArray(rawFacts) ? rawFacts.length : null;
  const sanitized =
    Array.isArray(rawFacts)
      ? sanitizeEpisodicExtractedFacts(rawFacts, { requireEvidence: true, requireSourceQuote: true })
      : [];
  const parsed = result.parsed?.episodic ?? parseSharedEpisodicSection(null);

  let persisted: { inserted: number; skipped: boolean; contentRoute: string | null } | null = null;
  if (parsed.valid && parsed.facts.length > 0) {
    const reconciled = reconcileSharedEpisodicFactsForTurn(getDb(), {
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      assistantMessageId: ASSISTANT_MESSAGE_ID,
      sourceUserMessageId: USER_MESSAGE_ID,
      sourceUserText: USER_TEXT,
      episodic: parsed,
      isRegeneration: false,
      contentRoute: "safe",
    });
    const row = getDb()
      .prepare(
        `SELECT metadata FROM episodic_memory_facts WHERE chat_id=? ORDER BY id DESC LIMIT 1`
      )
      .get(CHAT) as { metadata: string } | undefined;
    const meta = row ? (JSON.parse(row.metadata) as { content_route?: string }) : {};
    persisted = {
      inserted: reconciled.inserted,
      skipped: reconciled.skipped,
      contentRoute: meta.content_route ?? null,
    };
  }

  const usage = result.usage;
  const usd = usage?.cheaperInferenceBilledCostUsd ?? usage?.upstreamCostUsd ?? null;
  const artifact = {
    model: BACKGROUND_OPENROUTER_MODEL,
    temperature: 0.4,
    requestKind: "background-post-turn-shared-initial",
    scene: "synthetic SAFE fear disclosure; not a production user RP",
    characterName: "라이크",
    personaName: "렌",
    privateCardIncluded: false,
    statusWidgetIncluded: false,
    consumers: {
      mode: input.mode,
      includeRelationship: true,
      includeSuggestions: true,
      includeEpisodic: true,
    },
    system,
    userBlock,
    responseFormat,
    providerText: result.text,
    transportOk: result.transportOk,
    attempted: result.attempted,
    httpStatus: result.httpStatus,
    finishReason: result.finishReason,
    errorCode: result.errorCode,
    usage: usage
      ? {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          estimated: usage.estimated,
          finishReason: usage.finishReason ?? null,
          billedUsd: usd,
          responseModelId: usage.responseModelId ?? null,
        }
      : null,
    rawExtractedFactCount: rawCount,
    sanitizedFactCount: sanitized.length,
    parse: parsed,
    persisted,
  };
  mkdirSync("/opt/cursor/artifacts", { recursive: true });
  writeFileSync("/opt/cursor/artifacts/b22-shared-initial-live.json", JSON.stringify(artifact, null, 2));
  console.log(
    JSON.stringify({
      transportOk: result.transportOk,
      rawExtractedFactCount: rawCount,
      sanitizedFactCount: sanitized.length,
      parsePresent: parsed.present,
      parseValid: parsed.valid,
      parseFacts: parsed.facts.length,
      persisted,
      billedUsd: usd,
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
      finishReason: result.finishReason,
      errorCode: result.errorCode,
    })
  );
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message.slice(0, 400));
    process.exitCode = 1;
  })
  .finally(() => {
    try {
      uninstallIsolatedTestDatabase();
    } catch {
      /* isolated db may already be closed */
    }
  });
