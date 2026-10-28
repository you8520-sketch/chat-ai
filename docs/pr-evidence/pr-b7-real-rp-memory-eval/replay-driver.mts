/**
 * Appends scenario turns to the isolated chat through the same memory owners
 * /api/chat uses after a turn (no Main RP generation; assistant text is the
 * synthetic scenario prose):
 *   user row persisted -> ensureSummaryBarrier (request-start seal owner)
 *   -> assistant row completed -> runPostTurnRelationshipOnlyInitial (Shared
 *   Initial, real background model) -> scheduleMemoryUpdate (relationship
 *   ledger + episodic reconcile).
 *
 * Turns after the 90 scenario turns come from filler.mts (synthetic long history).
 * Global compaction runs inside the request-start seal exactly as in production.
 *
 * Usage:
 *   DATA_DIR=<dir> B7_CHAT_ID=1 B7_TO_TURN=30 node --conditions=react-server --import tsx replay-driver.mts
 */
import { BACKGROUND_OPENROUTER_MODEL } from "@/lib/ai";
import { getDb } from "@/lib/db";
import type { User } from "@/lib/auth-types";
import { formatCharacterIdentityForBackground, resolveCharacterGender } from "@/lib/characterGender";
import { loadCharacterChunksForPrompt } from "@/lib/characterChunks";
import { normalizeMemoryMeta, parseMemoryMeta } from "@/lib/chatMemory";
import { getChatMemoryCapacity } from "@/lib/memory/memory-capacity";
import { getOrCreateChatMemory } from "@/lib/memory/memory-db";
import { shouldRequestEpisodicInSharedInitial } from "@/lib/memory/memory-episodic-shared";
import { resolveMemoryTier, scheduleMemoryUpdate } from "@/lib/memory/memory-manager";
import { ensureSummaryBarrier } from "@/lib/memory/memory-rolling-summary";
import { countMemoryEligibleCompletedTurns } from "@/lib/memory/memory-turn-loader";
import { toPublicPersonaDescription } from "@/lib/personaSecretLegacyMarkers";
import { runPostTurnRelationshipOnlyInitial } from "@/lib/postTurnSharedInitial/run";
import { resolveRelationshipMetaNames } from "@/lib/relationshipMetaCharacterName";
import { formatSelectedPersonaIdentityForBackground } from "@/lib/userPersonas";

import { fillerTurn } from "./filler.mts";
import { TURNS } from "./scenario.mts";

const chatId = Number(process.env.B7_CHAT_ID ?? 1);
const toTurn = Number(process.env.B7_TO_TURN ?? TURNS.length);
const db = getDb();

const chat = db.prepare("SELECT * FROM chats WHERE id=?").get(chatId) as {
  id: number;
  user_id: number;
  character_id: number;
  selected_persona_id: number;
  mode: "safe" | "nsfw";
  memory_meta: string | null;
};
const user = db.prepare("SELECT * FROM users WHERE id=?").get(chat.user_id) as User;
const ch = db.prepare("SELECT * FROM characters WHERE id=?").get(chat.character_id) as Parameters<
  typeof loadCharacterChunksForPrompt
>[0] & { name: string; gender: string | null; system_prompt: string };
const persona = db.prepare("SELECT * FROM user_personas WHERE id=?").get(chat.selected_persona_id) as {
  name: string;
  gender: string | null;
  description: string;
  speech_examples: string | null;
};

const personaName = persona.name.trim();
const personaDescription = toPublicPersonaDescription(persona.description ?? "");
const backgroundPersonaIdentity = formatSelectedPersonaIdentityForBackground(
  personaName,
  (persona.gender ?? "other") as never
);
const backgroundCharacterIdentity = formatCharacterIdentityForBackground(
  ch.name,
  resolveCharacterGender(ch.gender)
);
const relationshipNames = resolveRelationshipMetaNames({
  displayName: ch.name,
  systemPrompt: ch.system_prompt,
  chunks: loadCharacterChunksForPrompt(ch, personaName, user.nickname).chunks,
  userName: personaName,
});
const tier = resolveMemoryTier(user);
const memoryCapacity = getChatMemoryCapacity(chatId);

async function main(): Promise<void> {
  getOrCreateChatMemory(chatId, user.id, ch.id, tier);
  const startTurn = countMemoryEligibleCompletedTurns(chatId) + 1;
  console.log(`[replay] chat=${chatId} from T${startTurn} to T${toTurn} background=${BACKGROUND_OPENROUTER_MODEL}`);

  for (let turn = startTurn; turn <= toTurn; turn++) {
    const spec = turn <= TURNS.length ? TURNS[turn - 1]! : fillerTurn(turn);
    const requestId = `b7-replay-${chatId}-${turn}`;

    const userMessageId = Number(
      db
        .prepare(
          `INSERT INTO messages (chat_id, role, content, model, request_id, generation_status) VALUES (?,?,?,?,?,?)`
        )
        .run(chatId, "user", spec.user, "", requestId, "submitted").lastInsertRowid
    );

    const barrier = await ensureSummaryBarrier({
      chatId,
      userId: user.id,
      characterId: ch.id,
      charName: ch.name,
      characterIdentity: backgroundCharacterIdentity,
      tier,
      memoryCapacity,
      userPersona: personaName,
      completedTurns: countMemoryEligibleCompletedTurns(chatId),
    });

    const assistantMessageId = Number(
      db
        .prepare(
          `INSERT INTO messages (chat_id, role, content, model, request_id, generation_status, status, user_message_id, alternates, active_variant)
           VALUES (?,?,?,?,?,?,?,?,?,?)`
        )
        .run(chatId, "assistant", spec.assistant, "synthetic-replay", requestId, "completed", "ok", userMessageId, "[]", 0)
          .lastInsertRowid
    );

    const memoryMeta = normalizeMemoryMeta(
      parseMemoryMeta(
        (db.prepare("SELECT memory_meta FROM chats WHERE id=?").get(chatId) as { memory_meta: string | null }).memory_meta
      ),
      relationshipNames
    );
    const includeEpisodic = shouldRequestEpisodicInSharedInitial({
      userMessage: spec.user,
      db,
      chatId,
      sourceUserMessageId: userMessageId,
    });
    const shared = await runPostTurnRelationshipOnlyInitial({
      charName: ch.name,
      personaName,
      userMessage: spec.user,
      assistantProse: spec.assistant,
      primaryModelId: BACKGROUND_OPENROUTER_MODEL,
      includeSuggestions: false,
      includeRelationship: true,
      includeEpisodic,
      userPersona: backgroundPersonaIdentity,
      personaDescription,
      personaSpeechExamples: persona.speech_examples ?? null,
      activePromises: memoryMeta?.promises.map((p) => p.text) ?? [],
    });
    const rel = shared.parsed?.relationship;
    const relUsable = rel?.present === true && rel.valid === true;

    await scheduleMemoryUpdate({
      chatId,
      userId: user.id,
      characterId: ch.id,
      relationshipNames,
      tier,
      memoryCapacity,
      characterIdentity: backgroundCharacterIdentity,
      userMessage: spec.user,
      assistantMessage: spec.assistant,
      assistantMessageId,
      sourceUserMessageId: userMessageId,
      userPersona: backgroundPersonaIdentity,
      isRegenerate: false,
      route: chat.mode,
      relationshipSharedParsed: relUsable,
      relationshipSharedDelta: relUsable ? rel.delta : null,
      relationshipSharedAttempted: shared.attempted,
      sharedInitialEpisodic: includeEpisodic ? (shared.parsed?.episodic ?? null) : null,
      episodicSharedAttempted: shared.attempted && includeEpisodic,
    });

    const episodicCount = (
      db.prepare("SELECT COUNT(*) n FROM episodic_memory_facts WHERE chat_id=?").get(chatId) as { n: number }
    ).n;
    const summaryCount = (
      db.prepare("SELECT COUNT(*) n FROM chat_turn_summaries WHERE chat_id=? AND COALESCE(inactive,0)=0").get(chatId) as {
        n: number;
      }
    ).n;
    console.log(
      `[replay] T${turn} shared=${shared.attempted ? (shared.transportOk ? "ok" : "fail") : "skip"} episodic_req=${includeEpisodic} rel=${relUsable} barrier=${barrier.ok ? barrier.summarizedThrough : barrier.reason} episodic_rows=${episodicCount} summaries=${summaryCount}`
    );
  }
}

await main();
