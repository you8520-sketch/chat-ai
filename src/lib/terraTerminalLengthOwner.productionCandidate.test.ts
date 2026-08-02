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
  "이번 응답은 한국어 RP 본문 기준 공백 포함 3,200~4,200자의 하나의 장면으로 작성한다. 장면의 중심은 주요 캐릭터와 사용자의 관계·상태 변화이며, 주요 캐릭터의 관찰·판단·감각·심리와 그에 따라 달라지는 행동·환경을 소설형 서술이 이끌고, 대사는 그 변화가 확정되거나 방향을 바꾸는 핵심 순간에 집중한다; 같은 화자의 이어지는 설명·반응·농담은 하나의 충분한 발화로 묶고, 외부 인물은 필요한 정보나 압력을 제공한 뒤 초점을 주요 캐릭터와 사용자에게 돌린다. 조용한 장면은 확인 가능한 관계·상황 변화 하나까지, 행동 장면은 주요 행동의 최초 결과 하나까지 완성한 뒤, 사용자가 바로 반응할 수 있는 단 하나의 명확한 행동·질문·감정 변화에 초점을 맞춰 마무리한다.";

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
