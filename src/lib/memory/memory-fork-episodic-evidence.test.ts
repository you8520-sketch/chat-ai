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

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import {
  deleteEpisodicMemoryFactsByAssistantMessageIds,
  resolveEpisodicPromptFactText,
} from "@/lib/episodicMemoryFacts";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";
import {
  evaluateEpisodicFactEvidence,
  loadEpisodicEvidenceSources,
  readVerifiedEvidence,
} from "./memory-episodic-evidence";
import {
  parseSharedEpisodicSection,
  reconcileSharedEpisodicFactsForTurn,
} from "./memory-episodic-shared";
import { copyForkEpisodicMemoryFacts } from "./memory-fork-snapshot";
import { getOrCreateChatMemory } from "./memory-db";

const USER = 950002;
const CHAR = 950003;
let chatSeq = 950100;

type Turn = { userId: number; assistantId: number; userText: string; assistantText: string };

function newChat(): number {
  const db = getDb();
  chatSeq += 1;
  db.prepare(`INSERT INTO chats (id, user_id, character_id, mode) VALUES (?,?,?,'safe')`).run(
    chatSeq,
    USER,
    CHAR
  );
  getOrCreateChatMemory(chatSeq, USER, CHAR, "free");
  return chatSeq;
}

function addTurn(chatId: number, userText: string, assistantText: string): Turn {
  const db = getDb();
  const userId = Number(
    db
      .prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`)
      .run(chatId, "user", userText, "user").lastInsertRowid
  );
  const assistantId = Number(
    db
      .prepare(
        `INSERT INTO messages (chat_id, role, content, model, user_message_id, generation_status)
         VALUES (?,?,?,?,?,'completed')`
      )
      .run(chatId, "assistant", assistantText, "test", userId).lastInsertRowid
  );
  return { userId, assistantId, userText, assistantText };
}

type Proposal = {
  fact: Record<string, unknown>;
  role: "user" | "assistant";
  quote: string;
};

function remember(chatId: number, turn: Turn, proposal: Proposal) {
  const result = reconcileSharedEpisodicFactsForTurn(getDb(), {
    chatId,
    userId: USER,
    characterId: CHAR,
    assistantMessageId: turn.assistantId,
    sourceUserMessageId: turn.userId,
    sourceUserText: turn.userText,
    userPersona: "이름/호칭: 렌",
    episodic: parseSharedEpisodicSection({
      extracted_facts: [
        {
          category: "character",
          subject: "x",
          attribute: "a",
          value: "v",
          importance: "important",
          ...proposal.fact,
          evidence: { source_role: proposal.role, source_quote: proposal.quote },
        },
      ],
    }),
    isRegeneration: false,
  });
  assert.equal(result.inserted, 1, `parent write must succeed for "${proposal.quote}"`);
}

/** Same copy the fork route performs: every parent message is re-inserted into the child with a new id. */
function forkMessages(parentChatId: number, childChatId: number, copy?: (id: number) => boolean) {
  const db = getDb();
  const map = new Map<number, number>();
  const rows = db
    .prepare(
      `SELECT id, role, content, model, generation_status FROM messages WHERE chat_id=? ORDER BY id`
    )
    .all(parentChatId) as {
    id: number;
    role: string;
    content: string;
    model: string;
    generation_status: string;
  }[];
  for (const row of rows) {
    if (copy && !copy(row.id)) continue;
    map.set(
      row.id,
      Number(
        db
          .prepare(
            `INSERT INTO messages (chat_id, role, content, model, generation_status) VALUES (?,?,?,?,?)`
          )
          .run(childChatId, row.role, row.content, row.model, row.generation_status)
          .lastInsertRowid
      )
    );
  }
  return map;
}

function copyFacts(parent: number, child: number, map: Map<number, number>) {
  return copyForkEpisodicMemoryFacts(getDb(), {
    sourceChatId: parent,
    newChatId: child,
    forkTurnCount: 200,
    parentResetAfterMessageId: null,
    messageIdMap: map,
  });
}

type FactRow = { id: number; source_user_message_id: number | null; fact_text: string; metadata: string };
function factRows(chatId: number): FactRow[] {
  return getDb()
    .prepare(
      `SELECT id, source_user_message_id, fact_text, metadata FROM episodic_memory_facts WHERE chat_id=? ORDER BY id`
    )
    .all(chatId) as FactRow[];
}

function messageChat(id: number): number | undefined {
  return (getDb().prepare(`SELECT chat_id FROM messages WHERE id=?`).get(id) as
    | { chat_id: number }
    | undefined)?.chat_id;
}

const BREAKUP: Proposal = {
  role: "user",
  quote: "미안, 우리 그만 헤어지자.",
  fact: {
    category: "relationship",
    subject: "ren_user",
    attribute: "relationship_end",
    value: "breakup",
    evidence_type: "explicit_user_statement",
    fact_text: "렌은 라이크에게 이별을 통보했다.",
  },
};
const SISTER_CLAIM: Proposal = {
  role: "assistant",
  quote: "누나가 시장에서 널 알아봤대. 예전부터 알던 사이라더라.",
  fact: {
    category: "relationship",
    subject: "raik",
    attribute: "claim_about_sister",
    value: "sister_knew_user",
    evidence_type: "explicit_character_claim",
    fact_text: "라이크는 누나가 시장에서 렌을 알아봤고 예전부터 아는 사이라고 말했다.",
  },
};
const EMOTION: Proposal = {
  role: "assistant",
  quote: "라이크는 입술을 깨물며 시선을 피했다.",
  fact: {
    subject: "raik",
    attribute: "reaction",
    value: "bit_lip",
    evidence_type: "explicit_scene_event",
    fact_text: "라이크는 아마추어라는 말에 입술을 깨물며 시선을 피했다.",
  },
};
const NPC: Proposal = {
  role: "assistant",
  quote: "서린이 문을 열고 들어왔다. 그녀는 라이크에게 목례했다.",
  fact: {
    subject: "seorin",
    attribute: "arrival",
    value: "entered_nodded",
    evidence_type: "explicit_scene_event",
    fact_text: "서린이 문을 열고 들어와 라이크에게 목례했다.",
  },
};

before(() => {
  installIsolatedTestDatabase();
  const db = getDb();
  db.prepare(`INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`).run(
    USER,
    `fork-ev-${USER}@test.local`,
    "렌",
    "x"
  );
  db.prepare(`INSERT INTO characters (id, name) VALUES (?,?)`).run(CHAR, "라이크");
});
after(() => uninstallIsolatedTestDatabase());

describe("fork keeps episodic evidence bound to the child chat's own messages", () => {
  it("rebinds evidence.message_id to the child message and re-verifies the same quote there (fork-evidence-id-probe regression)", () => {
    const parent = newChat();
    const turn = addTurn(parent, BREAKUP.quote, "라이크는 말없이 시선을 떨궜다.");
    remember(parent, turn, BREAKUP);
    const child = newChat();
    const map = forkMessages(parent, child);
    assert.notEqual(map.get(turn.userId), turn.userId, "child ids differ from parent ids");

    assert.equal(copyFacts(parent, child, map), 1);
    const [row] = factRows(child);
    const metadata = JSON.parse(row!.metadata);
    const childUserId = map.get(turn.userId)!;
    assert.equal(row!.source_user_message_id, childUserId);
    assert.equal(metadata.assistant_message_id, map.get(turn.assistantId));
    assert.equal(metadata.evidence.message_id, childUserId);
    assert.equal(messageChat(metadata.evidence.message_id), child);
    assert.deepEqual(
      { ...metadata.evidence, message_id: 0 },
      { role: "user", message_id: 0, quote: BREAKUP.quote, authority: "USER_EXPLICIT", match: "normalized_exact" }
    );

    const reproposed = parseSharedEpisodicSection({
      extracted_facts: [
        {
          category: "relationship",
          importance: "important",
          ...BREAKUP.fact,
          evidence: { source_role: BREAKUP.role, source_quote: BREAKUP.quote },
        },
      ],
    }).facts[0];
    assert.ok(reproposed, "same proposal parses");
    const decision = evaluateEpisodicFactEvidence(
      reproposed,
      loadEpisodicEvidenceSources(getDb(), child, {
        userMessageId: childUserId,
        assistantMessageId: map.get(turn.assistantId)!,
      })
    );
    assert.equal(decision.accepted, true);
    if (decision.accepted) assert.equal(decision.evidence.message_id, childUserId);
  });

  it("keeps the parent chat's own evidence untouched", () => {
    const parent = newChat();
    const turn = addTurn(parent, BREAKUP.quote, "라이크는 말없이 시선을 떨궜다.");
    remember(parent, turn, BREAKUP);
    const before = factRows(parent)[0]!.metadata;
    const child = newChat();
    copyFacts(parent, child, forkMessages(parent, child));
    assert.equal(factRows(parent)[0]!.metadata, before);
    assert.equal(JSON.parse(before).evidence.message_id, turn.userId);
    assert.equal(messageChat(turn.userId), parent);
  });

  it("preserves every authority, quote and prompt text: user speech, character claim, emotion, NPC", () => {
    const parent = newChat();
    const t1 = addTurn(parent, "솔직히 너 좀 아마추어 같아.", `${EMOTION.quote} "…그래."`);
    const t2 = addTurn(parent, "문 쪽을 바라본다.", NPC.quote);
    const t3 = addTurn(parent, "시장에 다녀왔어.", `라이크는 고개를 끄덕였다. "${SISTER_CLAIM.quote}"`);
    const t4 = addTurn(parent, BREAKUP.quote, "라이크는 말없이 시선을 떨궜다.");
    remember(parent, t1, EMOTION);
    remember(parent, t2, NPC);
    remember(parent, t3, SISTER_CLAIM);
    remember(parent, t4, BREAKUP);
    const child = newChat();
    addTurn(child, "unrelated", "unrelated");
    const map = forkMessages(parent, child);

    assert.equal(copyFacts(parent, child, map), 4);
    const parentRows = factRows(parent);
    const childRows = factRows(child);
    assert.equal(childRows.length, 4);
    childRows.forEach((childRow, index) => {
      const parentRow = parentRows[index]!;
      const parentEvidence = readVerifiedEvidence(parentRow.metadata)!;
      const childEvidence = readVerifiedEvidence(childRow.metadata)!;
      assert.ok(childEvidence, "child row is still verified");
      assert.equal(childEvidence.authority, parentEvidence.authority);
      assert.equal(childEvidence.role, parentEvidence.role);
      assert.equal(childEvidence.quote, parentEvidence.quote);
      assert.equal(childEvidence.message_id, map.get(parentEvidence.message_id));
      assert.equal(messageChat(childEvidence.message_id), child);
      assert.equal(
        resolveEpisodicPromptFactText({ fact_text: childRow.fact_text, metadata: childRow.metadata }),
        resolveEpisodicPromptFactText({ fact_text: parentRow.fact_text, metadata: parentRow.metadata })
      );
    });
    assert.deepEqual(
      childRows.map((r) => readVerifiedEvidence(r.metadata)!.authority),
      ["CURRENT_SCENE", "CURRENT_SCENE", "CHARACTER_CLAIM", "USER_EXPLICIT"]
    );
  });

  it("does not copy a verified row whose evidence message was not forked (partial fork)", () => {
    const parent = newChat();
    const kept = addTurn(parent, BREAKUP.quote, "라이크는 말없이 시선을 떨궜다.");
    const cut = addTurn(parent, "시장에 다녀왔어.", `"${SISTER_CLAIM.quote}"`);
    remember(parent, kept, BREAKUP);
    remember(parent, cut, SISTER_CLAIM);
    const child = newChat();
    const map = forkMessages(parent, child, (id) => id < cut.userId);

    assert.equal(copyFacts(parent, child, map), 1);
    assert.deepEqual(
      factRows(child).map((r) => readVerifiedEvidence(r.metadata)!.quote),
      [BREAKUP.quote]
    );
  });

  it("does not copy a verified assistant row when only its user message was forked", () => {
    const parent = newChat();
    const turn = addTurn(parent, "시장에 다녀왔어.", `"${SISTER_CLAIM.quote}"`);
    remember(parent, turn, SISTER_CLAIM);
    const child = newChat();
    const map = forkMessages(parent, child, (id) => id === turn.userId);
    assert.equal(copyFacts(parent, child, map), 0);
    assert.equal(factRows(child).length, 0);
  });

  it("does not copy evidence that the child message cannot prove (quote absent or role differs)", () => {
    const parent = newChat();
    const turn = addTurn(parent, BREAKUP.quote, "라이크는 말없이 시선을 떨궜다.");
    remember(parent, turn, BREAKUP);

    const absent = newChat();
    const absentMap = forkMessages(parent, absent);
    getDb()
      .prepare(`UPDATE messages SET content=? WHERE id=?`)
      .run("오늘은 날씨가 좋네.", absentMap.get(turn.userId));
    assert.equal(copyFacts(parent, absent, absentMap), 0);

    const swapped = newChat();
    const swappedMap = forkMessages(parent, swapped);
    swappedMap.set(turn.userId, swappedMap.get(turn.assistantId)!);
    assert.equal(copyFacts(parent, swapped, swappedMap), 0);

    const foreign = newChat();
    const foreignMap = forkMessages(parent, foreign);
    foreignMap.set(turn.userId, turn.userId);
    assert.equal(copyFacts(parent, foreign, foreignMap), 0, "a parent message is never a child's proof");
    assert.equal(factRows(foreign).length + factRows(absent).length + factRows(swapped).length, 0);
  });

  it("keeps legacy rows and malformed evidence on the existing compatibility path", () => {
    const parent = newChat();
    const turn = addTurn(parent, "좋아.", "라이크는 웃었다.");
    const db = getDb();
    const insert = db.prepare(
      `INSERT INTO episodic_memory_facts
        (chat_id, character_id, user_id, source_turn, source_user_message_id, category, subject, attribute, value, importance, fact_text, metadata)
       VALUES (?, ?, ?, 1, ?, 'item', '레온', ?, 'v', 'important', ?, ?)`
    );
    insert.run(parent, CHAR, USER, turn.userId, "legacy", "레거시 사실", JSON.stringify({ assistant_message_id: turn.assistantId }));
    insert.run(
      parent,
      CHAR,
      USER,
      turn.userId,
      "malformed",
      "손상된 근거 사실",
      JSON.stringify({ assistant_message_id: turn.assistantId, evidence: { role: "user", message_id: "x" } })
    );
    const child = newChat();
    const map = forkMessages(parent, child);

    assert.equal(copyFacts(parent, child, map), 2);
    const rows = factRows(child);
    assert.equal(rows[0]!.fact_text, "레거시 사실");
    assert.equal(readVerifiedEvidence(rows[0]!.metadata), null);
    assert.equal(JSON.parse(rows[0]!.metadata).evidence, undefined);
    assert.equal(rows[1]!.fact_text, "손상된 근거 사실");
    assert.equal(readVerifiedEvidence(rows[1]!.metadata), null);
    assert.equal(JSON.parse(rows[1]!.metadata).assistant_message_id, map.get(turn.assistantId));
  });

  it("fails closed when the child-message lookup throws: no verified row keeps the parent's evidence id", () => {
    const parent = newChat();
    const breakup = addTurn(parent, BREAKUP.quote, "라이크는 말없이 시선을 떨궜다.");
    const claim = addTurn(parent, "시장에 다녀왔어.", `"${SISTER_CLAIM.quote}"`);
    remember(parent, breakup, BREAKUP);
    remember(parent, claim, SISTER_CLAIM);
    getDb()
      .prepare(
        `INSERT INTO episodic_memory_facts
          (chat_id, character_id, user_id, source_turn, source_user_message_id, category, subject, attribute, value, importance, fact_text, metadata)
         VALUES (?, ?, ?, 1, ?, 'item', '레온', 'legacy', 'v', 'important', '레거시 사실', ?)`
      )
      .run(parent, CHAR, USER, breakup.userId, JSON.stringify({ assistant_message_id: breakup.assistantId }));
    const child = newChat();
    const map = forkMessages(parent, child);

    const realDb = getDb();
    const lookupFails = new Proxy(realDb, {
      get(target, prop, receiver) {
        if (prop === "prepare") {
          return (sql: string) => {
            if (/FROM messages/i.test(sql)) throw new Error("simulated child message lookup failure");
            return target.prepare(sql);
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const copied = copyForkEpisodicMemoryFacts(lookupFails, {
      sourceChatId: parent,
      newChatId: child,
      forkTurnCount: 200,
      parentResetAfterMessageId: null,
      messageIdMap: map,
    });

    const rows = factRows(child);
    const parentIds = new Set([breakup.userId, claim.assistantId]);
    assert.equal(
      rows.some((row) => {
        const evidence = readVerifiedEvidence(row.metadata);
        return evidence != null && parentIds.has(evidence.message_id);
      }),
      false,
      "no copied row may carry a parent evidence.message_id"
    );
    assert.equal(rows.filter((row) => readVerifiedEvidence(row.metadata) != null).length, 0);
    assert.equal(copied, 1, "only the legacy row is copied");
    assert.equal(rows[0]!.fact_text, "레거시 사실");
    assert.equal(factRows(parent).length, 3, "parent rows are untouched");
  });

  it("regen/delete invalidation still reaches the child's rows through the remapped assistant id", () => {
    const parent = newChat();
    const turn = addTurn(parent, BREAKUP.quote, "라이크는 말없이 시선을 떨궜다.");
    remember(parent, turn, BREAKUP);
    const child = newChat();
    const map = forkMessages(parent, child);
    copyFacts(parent, child, map);

    assert.equal(
      deleteEpisodicMemoryFactsByAssistantMessageIds(getDb(), child, [map.get(turn.assistantId)!]),
      1
    );
    assert.equal(factRows(child).length, 0);
    assert.equal(factRows(parent).length, 1, "parent row is not affected by child-side invalidation");
    assert.equal(
      deleteEpisodicMemoryFactsByAssistantMessageIds(getDb(), child, [turn.assistantId]),
      0,
      "a parent assistant id cannot invalidate or match child rows"
    );
  });
});
