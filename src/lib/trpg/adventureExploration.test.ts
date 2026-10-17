import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { evaluateAdventure, TRPG_ADVENTURE_CANON_START_MESSAGE, TrpgAdventureCanonError, type TrpgAdventure } from "./adventure";
import { loadCampaignContext } from "./campaignContext";
import { loadCampaignLedger } from "./campaignLedger";
import { EVEN_STATS, createTrpgCampaign, joinTrpgCampaign, saveTrpgSheet, writeSheet } from "./engineCreate";
import {
  advanceTrpgCampaign,
  regenerateTrpgNarration,
  startTrpgCampaign,
  submitTrpgAction,
  type TrpgEngineDeps,
} from "./engineAdvance";
import { loadTrpgSnapshot } from "./engineSnapshot";
import {
  adventureExplorationState,
  explorationRoomFacts,
  priceExplorationCommands,
  roomName,
  type ExplorationState,
} from "./explorationMap";
import { ensureExplorationMap, loadExplorationState, planExplorationCommit } from "./explorationStore";
import { buildTrpgGmStructuredWireText } from "./gmStructuredOutput";
import { ensureTrpgTables } from "./schema";
import { loadScenarioTemplate, insertScenarioTemplate, rowToScenarioTemplate, updateScenarioTemplate } from "./scenarioTemplates";
import { insertParticipant } from "./store";

const GHOST_TRAIN: TrpgAdventure = {
  start: "platform",
  places: [
    { key: "platform", name: "폐역 승강장", summary: "빗물이 고인 승강장에 낡은 기차가 멈춰 있다.", role: "start" },
    { key: "car3", name: "3호 객차", summary: "좌석마다 젖은 승차권이 놓여 있다.", role: "hub" },
    { key: "dining", name: "식당칸", summary: "식은 찻잔이 줄지어 놓인 식당칸.", role: "site" },
    { key: "mail", name: "우편칸", summary: "우편 자루가 천장까지 쌓여 있다.", role: "site" },
    { key: "engine", name: "기관실", summary: "멈춘 계기판이 푸르게 깜빡인다.", role: "goal" },
  ],
  links: [
    { from: "platform", to: "car3" },
    { from: "car3", to: "dining" },
    { from: "car3", to: "mail" },
    { from: "dining", to: "engine", opensBy: "conductor_key" },
    { from: "mail", to: "platform", hidden: true, opensBy: "mail_hatch" },
  ],
  events: [
    { key: "ticket", place: "car3", trigger: "search", kind: "clue", text: "승차권 뒷면에 '식당칸 찻잔 아래'라고 적혀 있다." },
    {
      key: "conductor_key",
      place: "dining",
      trigger: "search",
      kind: "item",
      text: "찻잔 아래에서 차장의 놋쇠 열쇠가 나온다.",
      item: "차장 열쇠",
      requires: ["ticket"],
    },
    { key: "mail_hatch", place: "mail", trigger: "careful_search", kind: "clue", text: "우편 자루 뒤 바닥 해치가 승강장 아래로 이어진다." },
    { key: "cold_steam", place: "engine", trigger: "enter", kind: "hazard", text: "기관실 문이 열리자 얼음 같은 증기가 쏟아진다." },
  ],
};

const HARBOR_PLOT: TrpgAdventure = {
  start: "pier",
  places: [
    { key: "pier", name: "부두 3번 선착장", summary: "밧줄과 젖은 상자가 뒤엉킨 밤의 선착장.", role: "start" },
    { key: "tavern", name: "닻줄 선술집", summary: "선원들이 낮은 목소리로 떠드는 선술집.", role: "hub" },
    { key: "office", name: "항만 관리소", summary: "도장과 장부가 쌓인 관리소 창구.", role: "site" },
    { key: "warehouse", name: "세관 창고", summary: "봉인된 상자가 늘어선 세관 창고.", role: "site" },
    { key: "ship", name: "밀수선 갑판", summary: "등불을 끈 밀수선의 갑판.", role: "goal" },
  ],
  links: [
    { from: "pier", to: "tavern" },
    { from: "tavern", to: "office" },
    { from: "pier", to: "warehouse", opensBy: "seal_order" },
    { from: "warehouse", to: "ship", hidden: true, opensBy: "ledger_gap" },
  ],
  events: [
    { key: "gossip", place: "tavern", trigger: "search", kind: "clue", text: "선원들이 관리소 도장이 찍힌 반출 명령서 이야기를 한다." },
    {
      key: "seal_order",
      place: "office",
      trigger: "search",
      kind: "item",
      text: "서랍 속에서 세관 창고 반출 명령서를 찾는다.",
      item: "반출 명령서",
      requires: ["gossip"],
    },
    { key: "ledger_gap", place: "warehouse", trigger: "careful_search", kind: "clue", text: "장부의 빈칸이 가리키는 바닥 문 아래로 밀수선이 보인다." },
    { key: "deck_blades", place: "ship", trigger: "enter", kind: "hazard", text: "갑판 위 선원들이 칼을 뽑아 든다." },
  ],
};

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, nickname TEXT, points INTEGER NOT NULL DEFAULT 0)`);
  db.prepare(`INSERT INTO users (id, email, nickname, points) VALUES (1,'a@t','현이',50000),(2,'b@t','도윤',50000)`).run();
  ensureTrpgTables(db);
  return db;
}

function participantId(db: Database.Database, campaignId: number, userId: number): number {
  return (db.prepare(`SELECT id FROM trpg_participants WHERE campaign_id=? AND user_id=?`).get(campaignId, userId) as { id: number }).id;
}

function sheet(db: Database.Database, id: number): { location: string; hp: number; inventory: Array<{ name: string; quantity: number }> } {
  const row = db.prepare(`SELECT location, hp, inventory_json FROM trpg_character_sheets WHERE participant_id=?`).get(id) as {
    location: string;
    hp: number;
    inventory_json: string;
  };
  return { location: row.location, hp: row.hp, inventory: JSON.parse(row.inventory_json) };
}

function itemQty(db: Database.Database, ids: readonly number[], name: string): number {
  return ids.reduce((sum, id) => sum + (sheet(db, id).inventory.find((item) => item.name === name)?.quantity ?? 0), 0);
}

/** Shortest walk on ways that are open now. */
function pathTo(state: ExplorationState, fromKey: string, goalKey: string): string[] {
  const open = state.map.edges.filter((edge) => (!edge.hidden && !edge.opensBy) || state.revealedEdgeIds.includes(edge.id));
  const previous = new Map<string, string | null>([[fromKey, null]]);
  const queue = [fromKey];
  while (queue.length) {
    const current = queue.shift()!;
    for (const edge of open) {
      const next = edge.from === current ? edge.to : edge.to === current ? edge.from : "";
      if (!next || previous.has(next)) continue;
      previous.set(next, current);
      queue.push(next);
    }
  }
  if (!previous.has(goalKey)) return [];
  const steps: string[] = [];
  for (let cursor: string | null = goalKey; cursor && cursor !== fromKey; cursor = previous.get(cursor) ?? null) steps.push(cursor);
  return steps.reverse();
}

function keyOf(state: ExplorationState, label: string): string {
  return state.map.rooms.find((room) => (room.name ?? room.id) === label)?.id ?? label;
}

function wire(narration: string, location: string): string {
  return buildTrpgGmStructuredWireText(narration, { players: [], location, next_round_context: "다음", campaign_finished: false });
}

type Evidence = Record<string, unknown>;

async function playAdventure(genre: string, adventure: TrpgAdventure): Promise<Evidence> {
  const canon = evaluateAdventure(adventure);
  assert.deepEqual(canon.issues, [], `${genre} fixture is a valid canon`);
  const db = memoryDb();
  const startName = adventure.places.find((place) => place.key === adventure.start)!.name;
  const templateId = insertScenarioTemplate(db, 1, {
    title: genre,
    summary: `${genre} 테스트`,
    content: `${genre} 모험.`,
    visibility: "private",
    startLocation: "모델이 적은 다른 시작",
    scenarioPlan: { startingSituation: "도착한다", centralConflict: "숨은 진실", goal: "목표 장소에 닿는다", endingConditions: ["목표 장소에 닿는다"], adventure },
  });
  const reloaded = rowToScenarioTemplate(loadScenarioTemplate(db, templateId)!, { includeSecret: true });
  assert.deepEqual(reloaded.scenarioPlan?.adventure, canon.adventure, "private save and reload keep the canon");
  assert.equal(reloaded.startLocation, startName, "saved start location is the canon start place");

  const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "현이", viewerUserId: 1, templateId });
  saveTrpgSheet(db, { campaignId, userId: 1, name: "현이", stats: EVEN_STATS });
  const invite = (db.prepare(`SELECT invite_code FROM trpg_campaigns WHERE id=?`).get(campaignId) as { invite_code: string }).invite_code;
  joinTrpgCampaign(db, { code: invite, userId: 2, nickname: "도윤" });
  saveTrpgSheet(db, { campaignId, userId: 2, name: "도윤", stats: EVEN_STATS });
  const host = participantId(db, campaignId, 1);
  const guest = participantId(db, campaignId, 2);
  const bot = insertParticipant(db, { campaignId, slotIndex: 2, kind: "ai_character", userId: null, characterId: null, displayName: "서하" });
  writeSheet(db, campaignId, bot, "서하", EVEN_STATS, startName);
  const seats = [host, guest, bot];

  const gmPrompts: string[] = [];
  const botPrompts: string[] = [];
  const deps: TrpgEngineDeps = {
    skipBilling: true,
    rollD20: () => 16,
    rollDie: () => 2,
    botCall: async (_system, user) => {
      botPrompts.push(user);
      return { text: "제자리에 서서 동료의 선택을 지켜본다." };
    },
    gmCall: async ({ user }) => {
      gmPrompts.push(user);
      const turn = gmPrompts.length;
      return { text: wire(`${turn}번째 장면. 서버가 확정한 자리와 결과만 잇는다. GM: 무엇을 하겠는가.`, loadCampaignLedger(db, campaignId).location || startName) };
    },
  };
  const state = () => loadExplorationState(db, campaignId)!;
  const locationKey = (id: number) => keyOf(state(), sheet(db, id).location);
  const play = async (left: { commands?: unknown; body?: string }, right: { commands?: unknown; body?: string }) => {
    submitTrpgAction(db, { campaignId, userId: 1, body: left.body ?? "", explorationCommands: left.commands });
    submitTrpgAction(db, { campaignId, userId: 2, body: right.body ?? "", explorationCommands: right.commands });
    const before = state();
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    return before;
  };
  const wait = { body: "숨을 고르며 주변을 살핀다." };
  const walk = (id: number, goal: string) => {
    const steps = pathTo(state(), locationKey(id), goal).slice(0, 3);
    assert.ok(steps.length > 0, `${genre}: open route to ${goal}`);
    return { commands: steps.map((roomId) => ({ op: "move", roomId })) };
  };

  // Start: one start place across definition, server state, sheets, GM, and map.
  await startTrpgCampaign(db, { campaignId, userId: 1, deps });
  const opened = state();
  assert.equal(opened.version, 2);
  assert.equal(opened.startRoomId, adventure.start);
  for (const id of seats) assert.equal(sheet(db, id).location, startName);
  assert.equal(loadCampaignLedger(db, campaignId).location, startName);
  const openingGm = gmPrompts[0] ?? "";
  assert.ok(openingGm.includes(`The party begins in ${startName}.`), openingGm);
  const startFacts = explorationRoomFacts(opened, adventure.start);
  assert.ok(openingGm.includes(`Open passages from ${startName}: ${startFacts.exits.join(", ")}.`), openingGm);
  const openingSnap = loadTrpgSnapshot(db, campaignId, 1)!.exploration!;
  assert.equal(openingSnap.rooms.find((room) => room.current)?.label, startName);
  const secretTexts = adventure.events.map((event) => event.text);
  const hiddenPlaces = adventure.links
    .filter((link) => link.hidden)
    .flatMap((link) => [link.from, link.to])
    .filter((key) => key !== adventure.start)
    .filter((key) => ![...startFacts.exits, ...startFacts.lockedExits].includes(roomName(opened.map, key)))
    .map((key) => roomName(opened.map, key));
  const openingWire = JSON.stringify(openingSnap) + openingGm;
  for (const secret of [...secretTexts, ...hiddenPlaces]) assert.equal(openingWire.includes(secret), false, `${genre} leaks ${secret}`);

  // Pricing: non-adjacent and still-shut ways are rejected by the server, with no AP spent.
  const far = adventure.places.find((place) => place.role === "goal")!;
  assert.throws(
    () => submitTrpgAction(db, { campaignId, userId: 1, body: "", explorationCommands: [{ op: "move", roomId: far.name }] }),
    /연결되지 않은 곳으로는 이동할 수 없습니다|아직 발견하지 못한 통로입니다/
  );
  assert.throws(
    () => submitTrpgAction(db, { campaignId, userId: 1, body: `${far.name}으로 이동한다.` }),
    /연결되지 않은 곳으로는 이동할 수 없습니다|아직 발견하지 못한 통로입니다/
  );
  const lockedLink = adventure.links.find((link) => link.opensBy && !link.hidden)!;
  assert.throws(
    () => priceExplorationCommands({ state: opened, fromRoomId: lockedLink.from, commands: [{ op: "move", roomId: lockedLink.to }], apRemaining: 3 }),
    /아직 열리지 않은 통로입니다/
  );
  assert.equal(state().pending.length, 0);
  assert.equal(state().apRemaining[String(host)], undefined);

  // Round 1: free-text move by name for one seat and a map command for the other.
  const hub = adventure.places.find((place) => place.role === "hub")!;
  const hubPublicId = opened.map.rooms.find((room) => room.id === hub.key)!.publicId;
  const beforeR1 = await play({ body: `${hub.name}로 이동한다.` }, { commands: [{ op: "move", roomId: hubPublicId }] });
  assert.equal(sheet(db, host).location, hub.name);
  assert.equal(sheet(db, guest).location, hub.name);
  assert.equal(sheet(db, bot).location, startName);
  const botBrief = botPrompts.at(-1) ?? "";
  assert.ok(botBrief.includes(`Open passages: ${explorationRoomFacts(beforeR1, adventure.start).exits.join(", ")}.`), botBrief);
  const afterR1 = state();
  assert.ok((gmPrompts.at(-1) ?? "").includes(`Open passages from ${hub.name}: ${explorationRoomFacts(afterR1, hub.key).exits.join(", ")}.`));
  assert.ok((gmPrompts.at(-1) ?? "").includes(`Open passages from ${startName}: ${explorationRoomFacts(afterR1, adventure.start).exits.join(", ")}.`));

  // Round 2: both humans search the hub in the same round; the clue fires once.
  const clue = adventure.events.find((event) => event.place === hub.key && event.kind === "clue")!;
  await play({ commands: [{ op: "search", depth: "normal" }] }, { commands: [{ op: "search", depth: "normal" }] });
  assert.equal(state().revealedEventIds.filter((id) => id === clue.key).length, 1);
  assert.equal((gmPrompts.at(-1) ?? "").split("found this clue exactly once").length - 1, 1);
  assert.equal(state().apRemaining[String(host)], 2);

  // Round 3: both walk to the item place and search there together; one item, one opened way.
  const itemEvent = adventure.events.find((event) => event.kind === "item")!;
  const itemPlace = itemEvent.place;
  const toItem = pathTo(state(), hub.key, itemPlace);
  await play(
    { commands: [...toItem.map((roomId) => ({ op: "move", roomId })), { op: "search", depth: "normal" }] },
    { commands: [...toItem.map((roomId) => ({ op: "move", roomId })), { op: "search", depth: "normal" }] }
  );
  assert.equal(itemQty(db, seats, itemEvent.item!), 1, "one-shot item granted once");
  const unlockedEdge = state().map.edges.find((edge) => edge.opensBy === itemEvent.key)!;
  assert.ok(state().revealedEdgeIds.includes(unlockedEdge.id), "item event opened its way");
  const holder = seats.find((id) => itemQty(db, [id], itemEvent.item!) === 1)!;

  // Reprocessing: the committed round replans to nothing, and regenerating narration changes no state.
  const lastRound = db
    .prepare(`SELECT id FROM trpg_rounds WHERE campaign_id=? AND phase='ROUND_COMPLETE' ORDER BY round_number DESC LIMIT 1`)
    .get(campaignId) as { id: number };
  assert.equal(
    planExplorationCommit(db, {
      campaignId,
      roundId: lastRound.id,
      opening: false,
      actors: seats.map((id) => ({ participantId: id, name: "", tier: "SUCCESS" })),
      sheetIds: seats,
    }),
    null
  );
  const frozen = JSON.stringify(state());
  await regenerateTrpgNarration(db, { campaignId, userId: 1, deps });
  assert.equal(JSON.stringify(state()), frozen);
  assert.equal(itemQty(db, [holder], itemEvent.item!), 1);

  // Template edit after start: the running campaign keeps its frozen canon and map.
  const edited: TrpgAdventure = JSON.parse(JSON.stringify(adventure));
  edited.places = edited.places.map((place) => ({ ...place, name: `${place.name} (개정)` }));
  updateScenarioTemplate(db, templateId, 1, {
    title: `${genre} 개정`,
    summary: "s",
    content: "c",
    visibility: "private",
    startLocation: "",
    scenarioPlan: { startingSituation: "도착한다", centralConflict: "숨은 진실", goal: "목표 장소에 닿는다", endingConditions: ["목표 장소에 닿는다"], adventure: edited },
  });
  assert.equal(JSON.stringify(state()), frozen);
  assert.equal(loadCampaignContext(db, campaignId)?.directorPlan?.adventure?.places[0]?.name, startName);
  ensureExplorationMap(db, campaignId);
  assert.equal(JSON.stringify(state()), frozen);

  // Secret passage: walk to it, search carefully, then pass through it.
  const passage = adventure.events.find((event) => adventure.links.some((link) => link.hidden && link.opensBy === event.key))!;
  const hiddenEdge = state().map.edges.find((edge) => edge.opensBy === passage.key)!;
  const hiddenFar = hiddenEdge.from === passage.place ? hiddenEdge.to : hiddenEdge.from;
  for (let guard = 0; guard < 3 && locationKey(host) !== passage.place; guard += 1) await play(walk(host, passage.place), wait);
  assert.equal(locationKey(host), passage.place);
  const beforeHatch = loadTrpgSnapshot(db, campaignId, 1)!.exploration!;
  assert.equal(JSON.stringify(beforeHatch).includes(passage.text), false);
  await play({ commands: [{ op: "search", depth: "careful" }] }, wait);
  assert.ok(state().revealedEdgeIds.includes(hiddenEdge.id), "careful search stored the opened passage");
  assert.ok(explorationRoomFacts(state(), passage.place).exits.includes(roomName(state().map, hiddenFar)));
  await play({ commands: [{ op: "move", roomId: hiddenFar }] }, wait);
  assert.equal(locationKey(host), hiddenFar);

  // Hazard on arrival: recorded once, the GM is told no damage was applied, HP is unchanged.
  const hazard = adventure.events.find((event) => event.kind === "hazard")!;
  const hpBefore = sheet(db, host).hp;
  let hazardPrompt = gmPrompts.at(-1) ?? "";
  for (let guard = 0; guard < 3 && locationKey(host) !== hazard.place; guard += 1) {
    await play(walk(host, hazard.place), wait);
    hazardPrompt = gmPrompts.at(-1) ?? "";
  }
  assert.equal(locationKey(host), hazard.place);
  assert.ok(state().revealedEventIds.includes(hazard.key));
  assert.match(hazardPrompt, /set off a danger exactly once/);
  assert.match(hazardPrompt, /server applied no damage/);
  assert.equal(sheet(db, host).hp, hpBefore);

  // Reconnect: a fresh snapshot for the other player shows the same facts.
  const reconnectA = loadTrpgSnapshot(db, campaignId, 2)!.exploration!;
  const reconnectB = loadTrpgSnapshot(db, campaignId, 2)!.exploration!;
  assert.deepEqual(reconnectA, reconnectB);
  assert.deepEqual(
    reconnectA.discoveries.map((item) => item.text),
    state().revealedEventIds.map((id) => adventure.events.find((event) => event.key === id)!.text)
  );
  assert.equal(reconnectA.legacy, undefined);
  const companion = botPrompts.at(-1) ?? "";
  assert.match(companion, /Party discoveries so far:/);
  assert.ok(companion.includes(clue.text));

  const evidence: Evidence = {
    genre,
    places: adventure.places.map((place) => place.name),
    events: adventure.events.map((event) => `${event.kind}@${event.place}: ${event.text}`),
    storedState: {
      version: state().version,
      startRoomId: state().startRoomId,
      visitedRoomIds: state().visitedRoomIds,
      revealedEventIds: state().revealedEventIds,
      grantedEventIds: state().grantedEventIds,
      revealedEdgeIds: state().revealedEdgeIds,
      appliedKeys: state().appliedKeys.length,
    },
    sheets: seats.map((id) => ({ id, ...sheet(db, id) })),
    openingGmExploration: openingGm.slice(openingGm.indexOf("[EXPLORATION")).split("\n").slice(0, 12),
    hazardGmExploration: hazardPrompt.slice(hazardPrompt.indexOf("[EXPLORATION")).split("\n").slice(0, 16),
    companionBrief: companion.slice(companion.indexOf("[EXPLORATION")).split("\n").slice(0, 9),
    publicMap: reconnectA,
  };
  db.close();
  return evidence;
}

describe("adventure exploration (B2+B3)", () => {
  it("plays a ghost-train mystery from private save through events and reconnect", async () => {
    const evidence = await playAdventure("유령 기차 미스터리", GHOST_TRAIN);
    console.log(JSON.stringify(evidence, null, 2));
  });

  it("plays a harbor-city intrigue from private save through events and reconnect", async () => {
    const evidence = await playAdventure("항구 도시 음모극", HARBOR_PLOT);
    console.log(JSON.stringify(evidence, null, 2));
  });

  it("starts a single-place adventure without a map", async () => {
    const db = memoryDb();
    const templateId = insertScenarioTemplate(db, 1, {
      title: "한 방",
      summary: "s",
      content: "c",
      visibility: "private",
      startLocation: "",
      scenarioPlan: {
        startingSituation: "여관에 모인다",
        goal: "범인을 찾는다",
        endingConditions: ["범인을 찾는다"],
        adventure: { start: "inn", places: [{ key: "inn", name: "비 내리는 여관", summary: "", role: "start" }], links: [], events: [] },
      },
    });
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "현이", viewerUserId: 1, templateId });
    saveTrpgSheet(db, { campaignId, userId: 1, name: "현이", stats: EVEN_STATS });
    const prompts: string[] = [];
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 16,
      gmCall: async ({ user }) => {
        prompts.push(user);
        return { text: wire("여관의 등불이 흔들린다. GM: 무엇을 하겠는가.", "비 내리는 여관") };
      },
    };
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(loadExplorationState(db, campaignId), null);
    assert.equal(loadTrpgSnapshot(db, campaignId, 1)?.exploration, null);
    submitTrpgAction(db, { campaignId, userId: 1, body: "주인에게 말을 건다." });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(prompts.some((prompt) => prompt.includes("[EXPLORATION")), false);
    assert.equal(sheet(db, participantId(db, campaignId, 1)).location, "비 내리는 여관");
    db.close();
  });

  it("starts a campaign without a template or adventure without a map", async () => {
    const db = memoryDb();
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "현이", viewerUserId: 1 });
    saveTrpgSheet(db, { campaignId, userId: 1, name: "현이", stats: EVEN_STATS });
    await startTrpgCampaign(db, {
      campaignId,
      userId: 1,
      deps: { skipBilling: true, rollD20: () => 16, gmCall: async () => ({ text: wire("바람이 분다. GM: 무엇을 하겠는가.", "들판") }) },
    });
    assert.equal(loadExplorationState(db, campaignId), null);
    db.close();
  });

  it("blocks the start of an invalid frozen canon before any GM call, round, or charge, and again on retry", async () => {
    const variants: Array<[string, (raw: Record<string, any>) => void]> = [
      ["string requires", (raw) => void (raw.events[1].requires = "ticket")],
      ["string hidden", (raw) => void (raw.links[4].hidden = "true")],
      ["unknown start", (raw) => void (raw.start = "roof")],
    ];
    for (const [label, mutate] of variants) {
      const db = memoryDb();
      const plan = { startingSituation: "역", goal: "기관실", endingConditions: ["기관실에 닿는다"] };
      const templateId = insertScenarioTemplate(db, 1, {
        title: "유령 기차",
        summary: "s",
        content: "c",
        visibility: "private",
        startLocation: "",
        scenarioPlan: { ...plan, adventure: GHOST_TRAIN },
      });
      const raw = JSON.parse(JSON.stringify(GHOST_TRAIN)) as Record<string, any>;
      mutate(raw);
      db.prepare(`UPDATE trpg_scenario_templates SET scenario_plan_json=? WHERE id=?`).run(JSON.stringify({ ...plan, adventure: raw }), templateId);
      const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "현이", viewerUserId: 1, templateId });
      saveTrpgSheet(db, { campaignId, userId: 1, name: "현이", stats: EVEN_STATS });
      const statusBefore = (db.prepare(`SELECT status FROM trpg_campaigns WHERE id=?`).get(campaignId) as { status: string }).status;
      const pointsBefore = (db.prepare(`SELECT points FROM users WHERE id=1`).get() as { points: number }).points;
      let gmCalls = 0;
      const deps: TrpgEngineDeps = {
        rollD20: () => 16,
        gmCall: async () => {
          gmCalls += 1;
          return { text: wire("열차가 멈춘다. GM: 무엇을 하겠는가.", "폐역 승강장") };
        },
      };
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        await assert.rejects(startTrpgCampaign(db, { campaignId, userId: 1, deps }), (error: unknown) => {
          assert.ok(error instanceof TrpgAdventureCanonError, `${label}: canon error`);
          assert.equal(error.message, TRPG_ADVENTURE_CANON_START_MESSAGE);
          for (const secret of [...GHOST_TRAIN.events.map((event) => event.text), "우편칸", "mail_hatch"]) {
            assert.equal(error.message.includes(secret), false, `${label}: message leaks ${secret}`);
          }
          return true;
        });
      }
      assert.equal(gmCalls, 0, `${label}: no GM call`);
      assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM trpg_rounds WHERE campaign_id=?`).get(campaignId) as { n: number }).n, 0);
      assert.equal(loadExplorationState(db, campaignId), null);
      assert.equal(loadCampaignContext(db, campaignId), null, `${label}: nothing frozen from a broken canon`);
      assert.equal((db.prepare(`SELECT status FROM trpg_campaigns WHERE id=?`).get(campaignId) as { status: string }).status, statusBefore);
      assert.equal((db.prepare(`SELECT points FROM users WHERE id=1`).get() as { points: number }).points, pointsBefore);
      db.close();
    }
  });

  it("starts an adventure whose author removed the places on purpose, without a map", async () => {
    const db = memoryDb();
    const plan = { startingSituation: "역", goal: "기관실", endingConditions: ["기관실에 닿는다"] };
    const templateId = insertScenarioTemplate(db, 1, {
      title: "유령 기차",
      summary: "s",
      content: "c",
      visibility: "private",
      startLocation: "",
      scenarioPlan: { ...plan, adventure: GHOST_TRAIN },
    });
    updateScenarioTemplate(db, templateId, 1, {
      title: "유령 기차",
      summary: "s",
      content: "c",
      visibility: "private",
      startLocation: "폐역 승강장",
      scenarioPlan: plan,
    });
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "현이", viewerUserId: 1, templateId });
    saveTrpgSheet(db, { campaignId, userId: 1, name: "현이", stats: EVEN_STATS });
    let gmCalls = 0;
    await startTrpgCampaign(db, {
      campaignId,
      userId: 1,
      deps: {
        skipBilling: true,
        rollD20: () => 16,
        gmCall: async () => {
          gmCalls += 1;
          return { text: wire("승강장에 비가 내린다. GM: 무엇을 하겠는가.", "폐역 승강장") };
        },
      },
    });
    assert.equal(gmCalls, 1);
    assert.equal(loadExplorationState(db, campaignId), null);
    assert.equal(loadTrpgSnapshot(db, campaignId, 1)?.exploration, null);
    db.close();
  });

  it("refuses to build a map from an invalid frozen canon instead of falling back to the test map", () => {
    const db = memoryDb();
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "현이", viewerUserId: 1 });
    const broken = { ...GHOST_TRAIN, start: "roof" };
    db.prepare(
      `INSERT INTO trpg_campaign_context (campaign_id, source_mode, scenario_snapshot_json, director_plan_json, updated_at)
       VALUES (?, 'scenario', ?, NULL, datetime('now'))`
    ).run(campaignId, JSON.stringify({ plan: { startingSituation: "역", goal: "기관실", exploration: true, adventure: broken } }));
    assert.throws(() => ensureExplorationMap(db, campaignId), TrpgAdventureCanonError);
    assert.equal(loadExplorationState(db, campaignId), null);
    db.close();
  });

  it("compiles a stable layout with the start in the first column and opaque public ids", () => {
    const state = adventureExplorationState(GHOST_TRAIN, "seed");
    const start = state.map.rooms.find((room) => room.id === "platform")!;
    assert.equal(start.x, 0);
    assert.deepEqual(
      state.map.rooms.map((room) => room.publicId).sort(),
      ["r1", "r2", "r3", "r4", "r5"]
    );
    assert.deepEqual(adventureExplorationState(GHOST_TRAIN, "other").map, state.map);
  });
});
