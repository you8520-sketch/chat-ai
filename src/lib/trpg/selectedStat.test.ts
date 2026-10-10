import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { decideJsxHostBridgeAction } from "../jsxComponent/hostBridge";
import { analyzeJsxCapabilities } from "../jsxComponent/capabilities";
import { jsxSurfacePolicyError } from "../jsxComponent/surface";
import {
  clearUserInputDraft,
  loadTrpgActionDraft,
  saveTrpgActionDraft,
  trpgActionDraftKey,
} from "../userInputDraft";
import { pickStatForActionDetailed } from "./actionTypes";
import { resolveTrpgSelectedStat, trpgActionComposerForRound } from "./actionComposer";
import { EVEN_STATS, createTrpgCampaign, saveTrpgSheet } from "./engineCreate";
import { startTrpgCampaign, submitTrpgAction } from "./engineAdvance";
import { loadTrpgSnapshot } from "./engineSnapshot";
import { applyReplySuggestionClick } from "./replySuggestionShared";
import { adjudicateLockedHumanSubmissions, ensureRoundAdjudicationContext } from "./roundAdjudication";
import { ensureTrpgTables } from "./schema";
import { buildTrpgGmStructuredWireText } from "./gmStructuredOutput";
import { loadLatestRound } from "./store";
import { defsFromKeys, DEFAULT_TRPG_STAT_DEFS } from "./stats";

function installSessionStorageStub() {
  const store = new Map<string, string>();
  const stub = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
  (globalThis as Record<string, unknown>).window ??= {};
  (globalThis as Record<string, unknown>).sessionStorage = stub;
  store.clear();
}

describe("selectedStat live owner", () => {
  it("A/M. null and stale keys keep the automatic resolver", () => {
    const investigate = defsFromKeys(["str", "dex", "con", "int", "per", "ins", "wis"]);
    const intent = "포자 흐름을 확인해서 안전한 도주 경로를 찾는다";
    const method = pickStatForActionDetailed({
      actionType: "investigate",
      selectedStat: null,
      body: intent,
      defs: investigate,
    });
    assert.equal(method.reason, "method");
    assert.deepEqual(
      pickStatForActionDetailed({
        actionType: "investigate",
        selectedStat: "not-a-stat",
        body: intent,
        defs: investigate,
      }),
      method
    );

    const pref = pickStatForActionDetailed({
      actionType: "attack",
      selectedStat: null,
      body: "",
      defs: DEFAULT_TRPG_STAT_DEFS,
    });
    assert.deepEqual(pref, { statKey: "str", reason: "action_pref" });
    assert.deepEqual(
      pickStatForActionDetailed({
        actionType: "attack",
        selectedStat: " ",
        body: "",
        defs: DEFAULT_TRPG_STAT_DEFS,
      }),
      pref
    );
  });

  it("D. a valid selectedStat is the top override", () => {
    const result = pickStatForActionDetailed({
      actionType: "attack",
      selectedStat: "cha",
      body: "검으로 벤다.",
      defs: DEFAULT_TRPG_STAT_DEFS,
    });
    assert.deepEqual(result, { statKey: "cha", reason: "selected" });
    const automatic = pickStatForActionDetailed({
      actionType: "attack",
      selectedStat: null,
      body: "검으로 벤다.",
      defs: DEFAULT_TRPG_STAT_DEFS,
    });
    assert.notEqual(automatic.statKey, "cha");
  });

  it("K/M. locked server selection beats local, and unknown keys are automatic", () => {
    const defs = [{ key: "str" }, { key: "dex" }];
    assert.equal(
      resolveTrpgSelectedStat({
        locked: true,
        serverSelectedStat: "dex",
        localSelectedStat: "str",
        statDefs: defs,
      }),
      "dex"
    );
    assert.equal(
      resolveTrpgSelectedStat({
        locked: true,
        serverSelectedStat: null,
        localSelectedStat: "str",
        statDefs: defs,
      }),
      null
    );
    assert.equal(
      resolveTrpgSelectedStat({
        locked: false,
        serverSelectedStat: "dex",
        localSelectedStat: "str",
        statDefs: defs,
      }),
      "str"
    );
    assert.equal(
      resolveTrpgSelectedStat({
        locked: false,
        serverSelectedStat: null,
        localSelectedStat: "nope",
        statDefs: defs,
      }),
      null
    );
  });

  it("J/L. current-round local stat persists, and a new round does not inherit it", () => {
    installSessionStorageStub();
    const current = trpgActionDraftKey(7, 3);
    saveTrpgActionDraft(
      current,
      { body: "", actionType: "free", inputOrigin: "manual", selectedStat: "dex" },
      1500
    );
    assert.equal(loadTrpgActionDraft(current, 1500)?.selectedStat, "dex");
    assert.equal(loadTrpgActionDraft(trpgActionDraftKey(7, 4), 1500), null);
    assert.equal(trpgActionComposerForRound(3, 4, null)?.selectedStat, null);
    assert.equal(trpgActionComposerForRound(3, 4, { body: "", selectedStat: "dex" })?.selectedStat, "dex");
    clearUserInputDraft(current);
    assert.equal(loadTrpgActionDraft(current, 1500), null);
  });

  it("O. a reply suggestion fills body and type without a stat field", () => {
    const filled = applyReplySuggestionClick({
      stance: "good",
      actionType: "attack",
      text: "검을 휘두른다.",
      stage: "",
      speech: "",
    });
    assert.deepEqual(filled, {
      actionType: "attack",
      actionBody: "검을 휘두른다.",
      inputOrigin: "reply_suggestion",
      autoSubmit: false,
    });
    const client = readFileSync("src/app/trpg/[id]/TrpgRoomClient.tsx", "utf8");
    const pick = client.slice(client.indexOf("onPickSuggestion={(item)"), client.indexOf("onSendAction"));
    assert.match(pick, /setActionType\(filled\.actionType\)/);
    assert.doesNotMatch(pick, /setSelectedStat/);
  });

  it("B/H/I. send posts body only and clears the local draft only after success", () => {
    const client = readFileSync("src/app/trpg/[id]/TrpgRoomClient.tsx", "utf8");
    const send = client.slice(client.indexOf("async function sendAction"), client.indexOf("const requestSuggestions"));
    assert.match(send, /body: actionBody/);
    assert.match(send, /inputOrigin/);
    assert.doesNotMatch(send, /actionType,/);
    assert.doesNotMatch(send, /selectedStat/);
    assert.match(send, /if \(ok\) clearUserInputDraft\(trpgActionDraftKey\(campaignId, roundNumber\)\)/);
    assert.doesNotMatch(send, /clearUserInputDraft\([\s\S]*if \(ok\)/);
    const route = readFileSync("src/app/api/trpg/campaigns/[id]/action/route.ts", "utf8");
    assert.match(route, /Stale client fields are ignored/);
    assert.doesNotMatch(route, /actionType: typeof body\.actionType === "string"/);
    assert.doesNotMatch(route, /selectedStat: typeof body\.selectedStat === "string"/);
    assert.doesNotMatch(route, /normalizeTrpgSelectedStat/);
    const engine = readFileSync("src/lib/trpg/engineAdvance.ts", "utf8");
    assert.doesNotMatch(engine, /normalizeTrpgSelectedStat/);
    assert.match(engine, /resolveHumanSubmittedActionType\(text\)/);
    assert.match(
      engine,
      /upsertLockedAction\(db, opts\.roundId, bot\.id, body, parseTrpgBotAction\(body\)\.actionType, null, "bot_model"\)/
    );
  });

  it("E/F/G/P/Q. SELF can still draft a stat locally; composer chips are gone; PARTY has no handler", () => {
    const dock = readFileSync("src/app/trpg/TrpgCommandDock.tsx", "utf8");
    const select = dock.slice(dock.indexOf("function selectStat"), dock.indexOf("const selfSurface"));
    assert.match(select, /onSelectedStatChange\(key\)/);
    assert.match(select, /openTrpgCommandDockMode\(current, "action"/);
    assert.doesNotMatch(select, /onActionTypeChange|onActionBodyChange|onInputOriginChange|onSendAction/);
    assert.doesNotMatch(dock, /data-trpg-stat-selector/);
    assert.doesNotMatch(dock, /data-trpg-action-chip/);
    assert.doesNotMatch(dock, /TRPG_VISIBLE_ACTION_TYPES\.map/);
    assert.match(dock, /onTrpgSelectedStat=\{onFillAction \? onTrpgSelectedStat : null\}/);
    assert.match(dock, /onFillAction=\{null\}/);
    assert.match(dock, /onSelectStat=\{null\}/);
    assert.doesNotMatch(dock, /fetch\(|\/action[`'"]/);
  });

  it("Q. setTrpgSelectedStat is a sheet draft intent and is ignored when empty", () => {
    assert.deepEqual(analyzeJsxCapabilities("setTrpgSelectedStat('str')"), ["trpg_action_draft"]);
    assert.match(
      jsxSurfacePolicyError("chat", ["trpg_action_draft"]) ?? "",
      /setTrpgActionDraft는 TRPG 캐릭터 시트 컴포넌트에서만/
    );
    assert.equal(jsxSurfacePolicyError("trpg_sheet", ["trpg_action_draft"]), null);
    const fresh = { lastAcceptedAt: 0, burst: 0 };
    const ok = decideJsxHostBridgeAction({
      kind: "setTrpgSelectedStat",
      text: "",
      statKey: "str",
      chatSendEnabled: false,
      now: 1_000,
      rate: fresh,
    });
    assert.deepEqual(ok.decision, { action: "setTrpgSelectedStat", statKey: "str" });
    const empty = decideJsxHostBridgeAction({
      kind: "setTrpgSelectedStat",
      text: "str",
      statKey: "  ",
      chatSendEnabled: false,
      now: 1_000,
      rate: fresh,
    });
    assert.deepEqual(empty.decision, { action: "ignore", reason: "empty" });
  });

  it("C/D. a locked submission stores selected_stat and the roll uses that stat", async () => {
    const db = new Database(":memory:");
    ensureTrpgTables(db);
    const deps = {
      skipBilling: true,
      rollD20: () => 16,
      gmCall: async () => ({
        text: buildTrpgGmStructuredWireText("문이 열린다.", {
          players: [],
          location: "",
          next_round_context: "",
          questsAdd: [],
          flagsAdd: [],
          campaign_finished: false,
        }),
      }),
    };
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
    saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    submitTrpgAction(db, {
      campaignId,
      userId: 1,
      body: "검으로 벤다.",
      actionType: "attack",
      selectedStat: "cha",
    });
    const stored = db.prepare(`SELECT action_type, selected_stat, locked FROM trpg_action_submissions`).get() as {
      action_type: string;
      selected_stat: string | null;
      locked: number;
    };
    assert.equal(stored.action_type, "attack");
    assert.equal(stored.selected_stat, null);
    assert.equal(stored.locked, 1);
    const snap = loadTrpgSnapshot(db, campaignId, 1);
    assert.equal(snap?.myDraft?.locked, true);
    assert.equal(snap?.myDraft?.selectedStat, null);
    const round = loadLatestRound(db, campaignId)!;
    const ctx = ensureRoundAdjudicationContext(db, {
      campaignId,
      roundId: round.id,
      roundNumber: round.round_number,
      deps,
    });
    adjudicateLockedHumanSubmissions(db, {
      campaignId,
      roundId: round.id,
      pre: ctx.pre,
      deps,
    });
    const roll = db.prepare(`SELECT stat_key FROM trpg_dice_rolls WHERE round_id=?`).get(round.id) as
      | { stat_key: string }
      | undefined;
    assert.equal(roll?.stat_key, "str");
    db.close();
  });
});
