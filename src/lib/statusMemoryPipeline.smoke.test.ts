import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import {
  ensureEpisodicMemoryFactsTable,
  getEpisodicMemoryForPrompt,
  persistEpisodicMemoryFactsBestEffort,
  summarizeEpisodicFactPersistCandidates,
} from "@/lib/episodicMemoryFacts";
import {
  serializeStatusWidgetValuesJson,
  splitProseAndStatusWidgetValues,
} from "@/lib/statusWidget/parseValues";
import { sanitizeExtractedFacts } from "@/lib/statusWidget/extractedFacts";

/**
 * End-to-end smoke: status JSON parse → values JSON → episodic insert → recall.
 * Does not call live LLMs.
 */
describe("status widget → episodic memory pipeline smoke", () => {
  const assistantWithStatus = `렌은 외투 안쪽에 손을 넣어 은색 단검의 손잡이를 확인했다.

"오늘은 조심해야겠어."

<<<STATUS_VALUES>>>
{"현재상황":"렌이 은색 단검을 숨긴 채 이동 중이다.","속마음":"들키면 곤란해진다.","의식의흐름":"왜 이렇게 손잡이가 차갑지.","extracted_facts":[{"category":"item","subject":"ren","attribute":"hidden_weapon","value":"silver_dagger_concealed","importance":"important","fact_text":"렌은 은색 단검을 숨기고 다닌다."},{"category":"item","subject":"ren","attribute":"trigger_noise","value":"status_key_dday","importance":"normal","fact_text":"트리거 trigger_id 가 발동하면 디데이가 줄어든다."},{"category":"item","subject":"ren","attribute":"bad_major","value":"은색 단검을 숨기고 다님","importance":"major","fact_text":"렌은 은색 단검을 숨기고 다닌다."}]}
<<<END_STATUS>>>`;

  it("parses status values before strip and keeps extracted_facts", () => {
    const { prose, values } = splitProseAndStatusWidgetValues(assistantWithStatus);
    assert.doesNotMatch(prose, /STATUS_VALUES/);
    assert.equal(values.character?.["현재상황"], "렌이 은색 단검을 숨긴 채 이동 중이다.");
    assert.equal(values.character?.["속마음"], "들키면 곤란해진다.");
    assert.equal(values.character?.["의식의흐름"], "왜 이렇게 손잡이가 차갑지.");
    assert.ok(Array.isArray(values.extracted_facts));
    // schema-valid only (contamination filtered at episodic persist)
    assert.equal(values.extracted_facts?.length, 2);
    assert.ok(values.extracted_facts?.some((f) => f.attribute === "hidden_weapon"));
    assert.equal(
      values.extracted_facts?.some((f) => (f as { importance: string }).importance === "major"),
      false
    );
  });

  it("rejects invalid fixture shapes (spaces in value, importance major)", () => {
    const rejected = sanitizeExtractedFacts([
      {
        category: "item",
        subject: "ren",
        attribute: "hidden_weapon",
        value: "은색 단검을 숨기고 다님",
        importance: "major",
        fact_text: "렌은 은색 단검을 숨기고 다닌다.",
      },
    ]);
    assert.equal(rejected.length, 0);

    const summary = summarizeEpisodicFactPersistCandidates([
      {
        category: "item",
        subject: "ren",
        attribute: "hidden_weapon",
        value: "silver_dagger_concealed",
        importance: "important",
        fact_text: "렌은 은색 단검을 숨기고 다닌다.",
      },
      {
        category: "rule",
        subject: "system",
        attribute: "trigger_meta",
        value: "trigger_id_dday",
        importance: "normal",
        fact_text: "트리거 trigger_id 가 발동하면 디데이가 줄어든다.",
      },
    ]);
    assert.equal(summary.validCount, 2);
    assert.equal(summary.insertableCount, 1);
    assert.ok(summary.skippedReasons.some((r) => r.startsWith("contamination:")));
  });

  it("stores status JSON snapshot and inserts only the valid story fact", () => {
    const db = new Database(":memory:");
    ensureEpisodicMemoryFactsTable(db);

    const { prose, values } = splitProseAndStatusWidgetValues(assistantWithStatus);
    const statusJson = serializeStatusWidgetValuesJson(values);
    const stored = JSON.parse(statusJson) as typeof values;

    assert.match(prose, /은색 단검/);
    assert.equal(stored.character?.["현재상황"]?.includes("단검"), true);
    assert.equal(stored.extracted_facts?.length, 2);

    const inserted = persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 101,
      characterId: 18,
      userId: 4,
      sourceTurn: 5,
      facts: stored.extracted_facts,
      metadata: { assistant_message_id: 9001, regenerated: false },
    });
    assert.equal(inserted, 1);

    const rows = db
      .prepare(
        `SELECT category, subject, attribute, value, fact_text FROM episodic_memory_facts WHERE chat_id=101`
      )
      .all() as Array<{ attribute: string; value: string; fact_text: string }>;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.attribute, "hidden_weapon");
    assert.equal(rows[0]!.value, "silver_dagger_concealed");
    assert.doesNotMatch(rows[0]!.fact_text, /trigger_id|디데이|STATUS/i);

    const recall = getEpisodicMemoryForPrompt(
      db,
      {
        chatId: 101,
        characterId: 18,
        userId: 4,
        currentTurn: 6,
        currentUserMessage: "단검은 어디에 숨겼어?",
        minAgeTurns: 0,
      },
      { ...process.env, NODE_ENV: "development", EPISODIC_MEMORY_RECALL_ENABLED: "1" }
    );
    assert.equal(recall.facts.length, 1);
    assert.match(recall.promptBlock, /은색 단검/);
    assert.match(recall.promptBlock, /\[EPISODIC MEMORY - RETRIEVED FACTS\]/);
  });
});
