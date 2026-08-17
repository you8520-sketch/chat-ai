import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { buildTrpgBotActionUserBlock } from "./botActions";
import { TRPG_BOT_INTENT_OPEN } from "./botActionParse";
import { TRPG_GM_SYSTEM } from "./gmPrompt";
import {
  buildTrpgMemoryPromptBlock,
  buildTrpgSealUserBlock,
  roundsDueForSeal,
  TRPG_SEAL_SYSTEM,
} from "./memory";
import {
  buildArcMemoryBlock,
  buildBotCompactContinuity,
  buildHorizonPromptSections,
  formatMemoryLines,
  memoryEventFingerprint,
  parseTrpgSealMemory,
  persistMemoryEvents,
  loadMemoryEvents,
  scoreMemoryEvent,
  selectHistoricalRecall,
  TRPG_MEMORY_ANCHOR_MAX_CHARS,
  TRPG_MEMORY_BOT_RECALL_MAX_CHARS,
  TRPG_MEMORY_EVENT_FACT_MAX_CHARS,
  TRPG_MEMORY_RECALL_MAX_CHARS,
  TRPG_MEMORY_SCORE,
  type TrpgMemoryEvent,
  type TrpgMemoryEventDraft,
  type TrpgMemoryQuery,
} from "./memoryHorizon";
import { sealDroppedTrpgRounds } from "./memorySeal";
import { ensureTrpgTables } from "./schema";
import { TRPG_BOT_MODEL, TRPG_GM_MODEL, TRPG_RECENT_ROUND_RAW } from "./types";

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  ensureTrpgTables(db);
  return db;
}

function event(partial: Partial<TrpgMemoryEvent> & Pick<TrpgMemoryEvent, "id" | "fact" | "type" | "roundEnd">): TrpgMemoryEvent {
  const actors = partial.actors ?? [];
  const fact = partial.fact;
  return {
    campaignId: partial.campaignId ?? 1,
    roundStart: partial.roundStart ?? partial.roundEnd,
    importance: partial.importance ?? "normal",
    scope: partial.scope ?? "party_observed",
    actors,
    entities: partial.entities ?? [],
    keywords: partial.keywords ?? [],
    fingerprint: partial.fingerprint ?? memoryEventFingerprint({ campaignId: 1, type: partial.type, actors, fact }),
    round: partial.round ?? partial.roundEnd,
    ...partial,
    fact,
  };
}

function query(partial: Partial<TrpgMemoryQuery> = {}): TrpgMemoryQuery {
  return {
    names: ["렌", "강이현", "권태현"],
    actionText: "렌이 이현에게 성채에 돌아가면 편을 들겠다는 약속을 꺼낸다.",
    location: "성채 앞",
    quests: ["성채 귀환"],
    npcs: [],
    inventory: [],
    worldFlags: [],
    sceneText: "렌이 이현을 바라본다.",
    currentRound: 35,
    viewerKind: "gm",
    ...partial,
  };
}

function longHorizonEvents(totalRounds: number): TrpgMemoryEvent[] {
  const out: TrpgMemoryEvent[] = [
    event({
      id: 4,
      type: "promise",
      fact: "강이현은 성채에 돌아가면 렌의 편에 서겠다고 약속했다.",
      actors: ["강이현", "렌"],
      entities: ["성채"],
      keywords: ["성채", "약속", "귀환"],
      importance: "critical",
      scope: "party_observed",
      roundEnd: 4,
    }),
    event({
      id: 7,
      type: "item",
      fact: "파티가 고유 아이템 붉은 열쇠를 획득했다.",
      actors: ["렌"],
      entities: ["붉은 열쇠"],
      keywords: ["열쇠", "획득"],
      importance: "important",
      scope: "party_observed",
      roundEnd: 7,
    }),
    event({
      id: 13,
      type: "conflict",
      fact: "파티가 NPC 유진과 크게 갈등했다.",
      actors: ["렌"],
      entities: ["유진"],
      keywords: ["유진", "갈등"],
      importance: "important",
      scope: "party_observed",
      roundEnd: 13,
    }),
    event({
      id: 20,
      type: "item",
      fact: "붉은 열쇠가 소실되어 더 이상 파티 손에 없다.",
      actors: ["렌"],
      entities: ["붉은 열쇠"],
      keywords: ["열쇠", "소실"],
      importance: "critical",
      scope: "party_observed",
      roundEnd: 20,
    }),
    event({
      id: 31,
      type: "world_event",
      fact: "먼 시장에서 비가 내렸다.",
      actors: [],
      entities: ["시장"],
      keywords: ["비"],
      importance: "normal",
      scope: "public_world",
      roundEnd: 31,
    }),
    event({
      id: 99,
      type: "decision",
      fact: "강이현만 몰래 옛 편지를 읽었다.",
      actors: ["강이현"],
      entities: ["편지"],
      keywords: ["편지"],
      importance: "important",
      scope: "actor_only",
      roundEnd: 12,
    }),
  ];
  for (let round = 1; round <= totalRounds; round += 1) {
    if ([4, 7, 13, 20, 31, 12].includes(round)) continue;
    out.push(
      event({
        id: 1000 + round,
        type: "other",
        fact: `R${round} 일상적인 이동만 있었다.`,
        actors: [],
        entities: [`지점${round}`],
        keywords: ["이동"],
        importance: "normal",
        scope: "public_world",
        roundEnd: round,
      })
    );
  }
  return out;
}

describe("TRPG long-horizon memory invariants", () => {
  it("keeps GM/Bot models, recent RAW=3, and a single MEMORY owner", () => {
    assert.equal(TRPG_GM_MODEL, "deepseek-v4-pro-0813");
    assert.equal(TRPG_BOT_MODEL, "deepseek-v4-pro-0813");
    assert.equal(TRPG_RECENT_ROUND_RAW, 3);
    assert.deepEqual(roundsDueForSeal([0, 1, 2, 3], -1), [0]);
    const memoryMentions = TRPG_GM_SYSTEM.match(/MEMORY:/g) ?? [];
    assert.equal(memoryMentions.length, 1);
    assert.match(TRPG_GM_SYSTEM, /Current structured state overrides historical state/);
    assert.match(TRPG_SEAL_SYSTEM, /"events"/);
    assert.doesNotMatch(TRPG_SEAL_SYSTEM, /No JSON/);
  });

  it("parses structured seal JSON and falls back without events on plain text", () => {
    const parsed = parseTrpgSealMemory(
      JSON.stringify({
        summary: "이현이 성채 귀환을 약속함.",
        events: [
          {
            type: "promise",
            fact: "강이현은 성채에 돌아가면 렌의 편에 서겠다고 약속했다.",
            actors: ["강이현", "렌"],
            entities: ["성채"],
            keywords: ["성채", "약속"],
            importance: "critical",
            scope: "party_observed",
            round: 4,
          },
        ],
      })
    );
    assert.equal(parsed.parsedJson, true);
    assert.equal(parsed.events.length, 1);
    assert.equal(parsed.events[0]?.type, "promise");
    assert.ok(Array.from(parsed.events[0]!.fact).length <= TRPG_MEMORY_EVENT_FACT_MAX_CHARS);
    const plain = parseTrpgSealMemory("문이 열렸다. 렌이 들어갔다.");
    assert.equal(plain.parsedJson, false);
    assert.deepEqual(plain.events, []);
    assert.match(plain.summary, /문이 열렸다/);
  });

  it("does not store duplicate fingerprints but keeps later broken-promise history", () => {
    const db = memoryDb();
    db.prepare(`INSERT INTO trpg_campaigns (host_user_id, title) VALUES (1, '기억')`).run();
    const campaignId = Number(db.prepare(`SELECT id FROM trpg_campaigns`).get()!.id);
    const draft: TrpgMemoryEventDraft = {
      type: "promise",
      fact: "강이현은 성채에 돌아가면 렌의 편에 서겠다고 약속했다.",
      actors: ["강이현", "렌"],
      entities: ["성채"],
      keywords: ["약속"],
      importance: "critical",
      scope: "party_observed",
      round: 4,
    };
    assert.equal(persistMemoryEvents(db, { campaignId, roundStart: 4, roundEnd: 4, events: [draft, draft] }), 1);
    assert.equal(persistMemoryEvents(db, { campaignId, roundStart: 4, roundEnd: 4, events: [draft] }), 0);
    const broken: TrpgMemoryEventDraft = {
      ...draft,
      type: "betrayal",
      fact: "강이현은 성채 귀환 약속을 깨뜨렸다.",
      keywords: ["약속", "파기"],
      round: 22,
    };
    assert.equal(persistMemoryEvents(db, { campaignId, roundStart: 22, roundEnd: 22, events: [broken] }), 1);
    const rows = loadMemoryEvents(db, campaignId);
    assert.equal(rows.length, 2);
    db.close();
  });

  it("recalls the R4 promise over recent unrelated events at R35 / R60 / R100", () => {
    for (const total of [40, 60, 100]) {
      const events = longHorizonEvents(total);
      const gm = query({ currentRound: total === 40 ? 35 : total });
      const recalled = selectHistoricalRecall(events, gm);
      assert.ok(
        recalled.some((row) => row.id === 4 && row.type === "promise"),
        `R${total} GM recall must include the R4 promise`
      );
      assert.ok(recalled[0]?.id === 4 || recalled.some((row) => row.id === 4 && row.score > (recalled.find((r) => r.id === 31)?.score ?? 0)));
      const r4 = recalled.find((row) => row.id === 4)!;
      const recentNormal = scoreMemoryEvent(events.find((row) => row.id === 31)!, gm);
      assert.ok(r4.score > recentNormal, "recency must not outrank a matching critical promise");
      const ihyeon = selectHistoricalRecall(events, { ...gm, viewerKind: "bot", viewerName: "강이현" });
      assert.ok(ihyeon.some((row) => row.id === 4));
      const other = selectHistoricalRecall(events, { ...gm, viewerKind: "bot", viewerName: "권태현" });
      assert.ok(other.some((row) => row.id === 4), "party_observed promise is visible to the other PC");
      assert.ok(!other.some((row) => row.id === 99), "actor_only private letter stays with 이현");
      assert.ok(ihyeon.some((row) => row.id === 99));
    }
  });

  it("keeps current inventory canonical over a past key-acquisition event", () => {
    const events = longHorizonEvents(40);
    const gm = query({ inventory: [], currentRound: 35 });
    const horizon = buildHorizonPromptSections({ events, query: gm });
    const block = buildTrpgMemoryPromptBlock({
      structured: {
        roundNumber: 35,
        location: "성채 앞",
        nextRoundContext: "약속을 지킬지",
        sheets: [{ name: "렌", hp: 18, maxHp: 25, conditions: [], inventory: [] }],
        quests: ["성채 귀환"],
        npcs: [],
        worldFlags: [],
      },
      sealedSummary: "과거 요약",
      recentRounds: [],
      campaignAnchors: horizon.anchors,
      relevantPastEvents: horizon.relevant,
      arcMemory: horizon.arc,
    });
    assert.match(block, /STRUCTURED STATE/);
    assert.match(block, /items=$|렌: HP 18\/25$/m);
    assert.doesNotMatch(block.split("[TRPG STRUCTURED STATE")[1]?.split("[CAMPAIGN ANCHORS]")[0] ?? "", /붉은 열쇠/);
    assert.match(`${horizon.anchors}\n${horizon.relevant}`, /R4:.*약속/);
    assert.match(`${horizon.anchors}\n${horizon.relevant}`, /R20:.*소실|R7:.*획득/);
    assert.ok(Array.from(horizon.anchors).length <= TRPG_MEMORY_ANCHOR_MAX_CHARS);
    assert.ok(Array.from(horizon.relevant).length <= TRPG_MEMORY_RECALL_MAX_CHARS);
    assert.ok(Array.from(horizon.botMemories).length <= TRPG_MEMORY_BOT_RECALL_MAX_CHARS);
  });

  it("clips recall lines to the configured budget", () => {
    const events = Array.from({ length: 20 }, (_, i) =>
      event({
        id: i + 1,
        type: "other",
        fact: "아주 긴 과거 사실이다. ".repeat(8),
        importance: "critical",
        actors: ["렌"],
        entities: ["성채"],
        keywords: ["약속"],
        roundEnd: i + 1,
      })
    );
    const lines = formatMemoryLines(events, 200);
    assert.ok(Array.from(lines).length <= 200);
  });

  it("builds compact bot continuity from INTENT instead of full prose", () => {
    const built = buildBotCompactContinuity(
      [
        {
          roundNumber: 30,
          actions: [
            {
              actorName: "유진",
              text: `${"긴 산문 ".repeat(40)}\n${TRPG_BOT_INTENT_OPEN}\n문을 어깨로 민다.`,
            },
          ],
          gmNarration: "문이 삐걱였다.",
        },
        {
          roundNumber: 31,
          actions: [{ actorName: "렌", text: "성채를 가리킨다." }],
          gmNarration: "바람이 돈다.",
        },
      ],
      "직전 장면 전문",
      800
    );
    assert.match(built.compact, /문을 어깨로 민다/);
    assert.doesNotMatch(built.compact, /긴 산문 긴 산문 긴 산문 긴 산문 긴 산문/);
    const user = buildTrpgBotActionUserBlock({
      characterName: "강이현",
      description: "차갑다",
      greeting: "그래",
      systemPrompt: "짧게",
      previousGmNarration: built.previousScene,
      campaignMemory: "[CAMPAIGN STATE]",
      longTermMemories: "- R4: 강이현은 성채에 돌아가면 렌의 편에 서겠다고 약속했다.",
      compactContinuity: built.compact,
      humanActions: [{ playerName: "렌", text: "약속을 꺼낸다." }],
    });
    assert.match(user, /MY LONG-TERM MEMORIES/);
    assert.match(user, /RECENT CONTINUITY/);
    assert.match(user, /PREVIOUS GM SCENE/);
  });

  it("adds chapter arc memory only for recalled older chapters", () => {
    const events = longHorizonEvents(40);
    const recalled = selectHistoricalRecall(events, query());
    const arc = buildArcMemoryBlock(events, recalled, 35);
    assert.match(arc, /R0–10|R4:/);
    assert.doesNotMatch(arc, /SECRET|Blueprint|ending/i);
  });

  it("seals JSON events with one memory call and falls back without failing", async () => {
    const db = memoryDb();
    db.prepare(`INSERT INTO trpg_campaigns (host_user_id, title) VALUES (1, '기억')`).run();
    const campaignId = Number((db.prepare(`SELECT id FROM trpg_campaigns`).get() as { id: number }).id);
    db.prepare(
      `INSERT INTO trpg_campaign_state (campaign_id, round_number, location) VALUES (?, 4, '성채')`
    ).run(campaignId);
    db.prepare(`INSERT INTO trpg_campaign_memories (campaign_id) VALUES (?)`).run(campaignId);
    for (let n = 0; n <= 3; n += 1) {
      const info = db.prepare(`INSERT INTO trpg_rounds (campaign_id, round_number, phase) VALUES (?,?, 'ROUND_COMPLETE')`).run(campaignId, n);
      db.prepare(`INSERT INTO trpg_gm_messages (round_id, narration) VALUES (?, ?)`).run(info.lastInsertRowid, `R${n} 장면`);
    }
    let calls = 0;
    await sealDroppedTrpgRounds(db, campaignId, async () => {
      calls += 1;
      return {
        text: JSON.stringify({
          summary: "이현이 성채 귀환을 약속함.",
          events: [
            {
              type: "promise",
              fact: "강이현은 성채에 돌아가면 렌의 편에 서겠다고 약속했다.",
              actors: ["강이현", "렌"],
              entities: ["성채"],
              keywords: ["약속"],
              importance: "critical",
              scope: "party_observed",
              round: 0,
            },
          ],
        }),
      };
    });
    assert.equal(calls, 1);
    assert.equal(loadMemoryEvents(db, campaignId).length, 1);
    await sealDroppedTrpgRounds(db, campaignId, async () => {
      throw new Error("should not run; nothing due");
    });
    const db2 = memoryDb();
    db2.prepare(`INSERT INTO trpg_campaigns (host_user_id, title) VALUES (1, '실패')`).run();
    const id2 = Number((db2.prepare(`SELECT id FROM trpg_campaigns`).get() as { id: number }).id);
    db2.prepare(`INSERT INTO trpg_campaign_state (campaign_id, round_number) VALUES (?, 4)`).run(id2);
    db2.prepare(`INSERT INTO trpg_campaign_memories (campaign_id) VALUES (?)`).run(id2);
    for (let n = 0; n <= 3; n += 1) {
      const info = db2.prepare(`INSERT INTO trpg_rounds (campaign_id, round_number, phase) VALUES (?,?, 'ROUND_COMPLETE')`).run(id2, n);
      db2.prepare(`INSERT INTO trpg_gm_messages (round_id, narration) VALUES (?, ?)`).run(info.lastInsertRowid, `R${n}`);
    }
    await sealDroppedTrpgRounds(db2, id2, async () => {
      throw new Error("model down");
    });
    assert.equal(loadMemoryEvents(db2, id2).length, 0);
    const summary = db2.prepare(`SELECT summary FROM trpg_round_summaries WHERE campaign_id=?`).get(id2) as { summary: string };
    assert.ok(summary.summary.length > 0);
    db.close();
    db2.close();
  });

  it("does not put hidden GM secrets into the seal user block", () => {
    const block = buildTrpgSealUserBlock([
      { roundNumber: 1, actions: [{ actorName: "렌", text: "문을 연다." }], gmNarration: "문이 열린다." },
    ]);
    assert.doesNotMatch(block, /gm_secret|Blueprint|ending candidate|systemPrompt/i);
    assert.match(block, /JSON/);
  });
});
