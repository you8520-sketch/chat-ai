/**
 * Synthetic-fixture probe for the B3 past-promise recall block (no provider call, no network).
 * Seeds the 79-turn chat (T10 promise, T20 cancel, ledger holds only a later promise, user-curated
 * Global without the cancelled promise), then prints the exact relationship-memory block the live
 * Main RP route would hand to contextBuilder for several user messages.
 *
 *   DATA_DIR=/tmp/x MEMORY_FEATURE_ENABLED=1 OPENROUTER_API_KEY= CHEAPER_INFERENCE_API_KEY= OPENAI_API_KEY= \
 *   node --conditions=react-server --import tsx docs/pr-evidence/pr-b3-source-evidence-recall/promise-recall-probe.mts
 *
 * Works on both trees: uses `loadPromiseHistoryForPromptCore` when present, else the pre-B3 pair.
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

if (!process.env.DATA_DIR) throw new Error("DATA_DIR must point at the isolated verification directory");
process.env.MEMORY_FEATURE_ENABLED = "1";

await import(`${process.cwd()}/scripts/seed-memory-recall-eval-chat.ts`);

const { getDb } = await import("@/lib/db");
const { formatMemoryMetaForPrompt, normalizeMemoryMeta, parseMemoryMeta } = await import("@/lib/chatMemory");
const timeline = (await import("@/lib/memory/memory-relationship-timeline")) as Record<string, unknown>;

const CHAT_ID = Number(process.env.EVAL_CHAT_ID ?? 99201);
const NAMES = { charName: "히유", userName: "데모유저" };
const db = getDb();

function promiseHistory(message: string): string[] {
  const load = timeline.loadPromiseHistoryForPromptCore as
    | ((...args: unknown[]) => string[])
    | undefined;
  if (load) return load(db, CHAT_ID, NAMES, message);
  const events = (timeline.loadRelationshipLedgerEventsCore as (...args: unknown[]) => unknown)(
    db,
    CHAT_ID,
    NAMES
  );
  return (timeline.selectPromiseHistoryForPrompt as (...args: unknown[]) => string[])(events, message);
}

const chat = db.prepare("SELECT memory_meta FROM chats WHERE id=?").get(CHAT_ID) as { memory_meta: string };
const meta = normalizeMemoryMeta(parseMemoryMeta(chat.memory_meta), NAMES);

const MESSAGES = [
  ["A recall promise", "그러고 보니 예전에 한강에서 야경 보기로 했던 거, 우리 어떻게 됐었지?"],
  ["B ask cancel reason", "그때 한강 야경 약속 왜 취소했더라?"],
  ["C propose a new promise", "이번 주말에 새로 약속 잡아볼까요? 영화 어때요?"],
  ["C2 unrelated scene", "오늘도 삼각김밥 하나 주세요."],
] as const;

for (const [label, message] of MESSAGES) {
  const t0 = performance.now();
  const endedPromises = promiseHistory(message);
  const ms = performance.now() - t0;
  const block = formatMemoryMetaForPrompt(meta, { endedPromises });
  console.log(`===== ${label} =====`);
  console.log(`user message: ${message}`);
  console.log(`promise-history lines: ${endedPromises.length}  chars: ${endedPromises.join("").length}  ms: ${ms.toFixed(2)}`);
  console.log("--- relationship memory block (exact) ---");
  console.log(block ?? "(none)");
  console.log("");
}
