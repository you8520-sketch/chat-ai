import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import {
  CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
  CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
  OPENROUTER_QWEN_37_MAX_MODEL,
} from "@/lib/chatModels";
import { LUNA_TERMINAL_OUTPUT_CONTRACT } from "@/lib/lunaSinglePrimaryAdapter";
import {
  resolveTerraTerminalLengthOwnerContract,
  TERRA_TERMINAL_LENGTH_OWNER_CONTRACT,
} from "@/lib/sharedNovelProseModelAdapters";
import { bootstrapStreamingTurn } from "@/lib/streamingPersistence";
import {
  appendTerraTerminalLengthOwnerToUserTurn,
  USER_TAIL_LENGTH_OWNER_SENTENCE,
} from "@/lib/responseLength";

async function withServerOnlyMock<T>(fn: () => Promise<T>): Promise<T> {
  const require = createRequire(import.meta.url);
  require.cache[require.resolve("server-only")] = {
    exports: {},
    loaded: true,
    id: "server-only",
    filename: "server-only",
  } as NodeModule;
  return fn();
}

const FROZEN_CONTRACT =
  "이번 응답은 한국어 RP 본문만 3,200~4,200자로 작성한다. 현재 상호작용을 관찰·행동·대사·감각·심리의 인과적 연쇄로 전개하여, 조용한 장면에서는 관계나 상황의 확인 가능한 변화 하나에 도달하고, 행동 장면에서는 이번 턴에 시작된 주요 행동의 최초로 확인 가능한 결과에 도달한 뒤 마무리한다.";

describe("Terra terminal length owner — production candidate gates", () => {
  it("keeps frozen contract text byte-identical", () => {
    assert.equal(TERRA_TERMINAL_LENGTH_OWNER_CONTRACT, FROZEN_CONTRACT);
    assert.equal(
      resolveTerraTerminalLengthOwnerContract({
        modelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
        contentKind: "character",
      }),
      FROZEN_CONTRACT
    );
  });

  it("Terra single_primary → contract; Terra simulation → null", () => {
    assert.equal(
      resolveTerraTerminalLengthOwnerContract({
        modelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
        contentKind: "character",
      }),
      FROZEN_CONTRACT
    );
    assert.equal(
      resolveTerraTerminalLengthOwnerContract({
        modelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
        contentKind: "simulation",
      }),
      null
    );
  });

  it("Luna and Qwen never receive Terra contract", () => {
    assert.equal(
      resolveTerraTerminalLengthOwnerContract({
        modelId: CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
        contentKind: "character",
      }),
      null
    );
    assert.equal(
      resolveTerraTerminalLengthOwnerContract({
        modelId: OPENROUTER_QWEN_37_MAX_MODEL,
        contentKind: "character",
      }),
      null
    );
    // Terra-unique second sentence must not appear in Luna terminal contract.
    assert.doesNotMatch(
      LUNA_TERMINAL_OUTPUT_CONTRACT,
      /최초로 확인 가능한 결과에 도달한 뒤 마무리한다/
    );
    assert.notEqual(LUNA_TERMINAL_OUTPUT_CONTRACT, FROZEN_CONTRACT);
  });

  it("DB-persisted user message does not store terminal contract", () => {
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
    const raw = '*발소리를 죽이며 한 걸음 더 들어간다.* "왼쪽 갈림길."';
    const assembled = appendTerraTerminalLengthOwnerToUserTurn(raw);
    assert.ok(assembled.includes(FROZEN_CONTRACT));

    const boot = bootstrapStreamingTurn(db, {
      chatId: 1,
      requestId: "terra-candidate-persist",
      userContent: raw,
      skipUserInsert: false,
    });
    const stored = db
      .prepare(`SELECT content FROM messages WHERE id=?`)
      .get(boot.userMessageId) as { content: string };
    assert.equal(stored.content, raw);
    assert.equal(stored.content.includes(FROZEN_CONTRACT), false);
    db.close();
  });

  it("buildContext: Terra single_primary ends with Terra contract; Luna keeps Luna owner", async () => {
    await withServerOnlyMock(async () => {
      const { buildContext } = await import("@/services/contextBuilder");
      const terra = buildContext({
        charName: "에녹",
        chunks: [],
        userNickname: "유저",
        shortTermHistory: [],
        currentUserMessage: "왼쪽 갈림길.",
        nsfw: false,
        modelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
        provider: "cheaperinference",
        contentKind: "character",
        targetResponseChars: 3200,
      });
      const terraUser = terra.history.at(-1)?.content ?? "";
      assert.ok(terraUser.trimEnd().endsWith(FROZEN_CONTRACT));
      assert.equal((terra.systemPrompt.match(/TARGET_LENGTH/g) ?? []).length, 0);
      assert.equal((terraUser.match(/TARGET_LENGTH/g) ?? []).length, 0);
      assert.equal(terraUser.includes(LUNA_TERMINAL_OUTPUT_CONTRACT), false);

      const terraSim = buildContext({
        charName: "회색 생태권",
        chunks: [],
        userNickname: "유저",
        shortTermHistory: [],
        currentUserMessage: "문을 살핀다.",
        nsfw: false,
        modelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
        provider: "cheaperinference",
        contentKind: "simulation",
        targetResponseChars: 3200,
      });
      const simUser = terraSim.history.at(-1)?.content ?? "";
      assert.equal(simUser.includes(FROZEN_CONTRACT), false);
      assert.ok(simUser.includes(USER_TAIL_LENGTH_OWNER_SENTENCE));

      const luna = buildContext({
        charName: "에녹",
        chunks: [],
        userNickname: "유저",
        shortTermHistory: [],
        currentUserMessage: "왼쪽 갈림길.",
        nsfw: false,
        modelId: CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
        provider: "cheaperinference",
        contentKind: "character",
        targetResponseChars: 3200,
      });
      const lunaUser = luna.history.at(-1)?.content ?? "";
      assert.equal(lunaUser.includes(FROZEN_CONTRACT), false);
      assert.ok(lunaUser.trimEnd().endsWith(LUNA_TERMINAL_OUTPUT_CONTRACT));
      assert.equal((luna.systemPrompt.match(/TARGET_LENGTH/g) ?? []).length, 0);
    });
  });
});
