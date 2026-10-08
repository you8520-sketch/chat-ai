import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { contextualStatusTreatDraft } from "./mechanicsIntent";
import { partyDetailedSheetCards, viewerSelfSheetCard } from "./partySheetPresentation";
import { inventoryFromUnits } from "./inventory";
import type { TrpgSheetHudCard } from "./sheetView";
import {
  initialTrpgCommandDockView,
  ongoingEffectActionDraft,
  openTrpgCommandDockMode,
  reconcileTrpgCommandDockLifecycle,
  selectPartySheetParticipantId,
  selectTrpgCommandDockMode,
  trpgCommandDockOcclusion,
  trpgCommandDockPresentationBusy,
  useItemActionDraft,
  type TrpgCommandDockView,
} from "./commandDock";

function card(participantId: number, name: string, isSelf: boolean): TrpgSheetHudCard {
  return {
    participantId,
    isSelf,
    html: `<div>${name}</div>`,
    sheet: {
      participantId,
      name,
      playerName: name,
      level: 1,
      hp: 12,
      maxHp: 20,
      stats: { str: 8 },
      conditions: [],
      inventory: inventoryFromUnits(["붕대"]),
      location: "폐역",
      modifiersNote: "",
    },
  };
}

function view(partial: Partial<TrpgCommandDockView> = {}): TrpgCommandDockView {
  return {
    mode: "action",
    expanded: true,
    explicitHold: null,
    ...partial,
  };
}

describe("TRPG command dock", () => {
  it("A. solo human keeps an empty party list and an action surface", () => {
    const sheets = [card(1, "렌", true)];
    assert.equal(viewerSelfSheetCard(sheets, 1)?.participantId, 1);
    assert.deepEqual(partyDetailedSheetCards(sheets, 1), []);
    const dock = readFileSync("src/app/trpg/TrpgCommandDock.tsx", "utf8");
    assert.match(dock, /다른 파티원이 없습니다\./);
    assert.match(dock, /data-trpg-command-dock-tab="action"|data-trpg-command-dock-tab=\{mode\}/);
    const opened = initialTrpgCommandDockView({ actionInput: true, presentationBusy: false });
    assert.equal(opened.mode, "action");
    assert.equal(opened.expanded, true);
  });

  it("B. human plus two AI sheets switch by participant id and exclude self", () => {
    const sheets = [card(1, "렌", true), card(2, "권태현", false), card(3, "강이현", false)];
    const others = partyDetailedSheetCards(sheets, 1);
    assert.deepEqual(others.map((item) => item.participantId), [2, 3]);
    assert.equal(selectPartySheetParticipantId(others, null), 2);
    assert.equal(selectPartySheetParticipantId(others, 3), 3);
    assert.equal(selectPartySheetParticipantId(others, 1), 2);
  });

  it("C. two humans plus AI keep the viewer out of the other-party list", () => {
    const sheets = [card(10, "뷰어", true), card(11, "다른 사람", false), card(12, "AI", false)];
    const others = partyDetailedSheetCards(sheets, 10);
    assert.deepEqual(others.map((item) => item.participantId), [11, 12]);
    const dock = readFileSync("src/app/trpg/TrpgCommandDock.tsx", "utf8");
    const client = readFileSync("src/app/trpg/[id]/TrpgRoomClient.tsx", "utf8");
    assert.match(dock, /onSendParty=\{onSendParty\}/);
    assert.match(client, /\/party-chat/);
  });

  it("D. same-name participants stay distinct by participantId", () => {
    const sheets = [card(21, "동명이인", true), card(22, "동명이인", false), card(23, "동명이인", false)];
    const others = partyDetailedSheetCards(sheets, 21);
    assert.deepEqual(others.map((item) => item.participantId), [22, 23]);
    assert.equal(selectPartySheetParticipantId(others, 23), 23);
    assert.notEqual(others[0]?.sheet.name, "");
    assert.equal(others[0]?.sheet.name, others[1]?.sheet.name);
    const dock = readFileSync("src/app/trpg/TrpgCommandDock.tsx", "utf8");
    assert.match(dock, /key=\{card\.participantId\}/);
    assert.doesNotMatch(dock, /key=\{card\.sheet\.name\}/);
  });

  it("E/F. action draft custody and round reset stay on the room client", () => {
    const client = readFileSync("src/app/trpg/[id]/TrpgRoomClient.tsx", "utf8");
    const dock = readFileSync("src/app/trpg/TrpgCommandDock.tsx", "utf8");
    assert.match(client, /resolveTrpgActionInitialBody/);
    assert.match(client, /saveTrpgActionDraft/);
    assert.match(client, /trpgActionComposerForRound/);
    assert.match(client, /clearUserInputDraft\(trpgActionDraftKey\(campaignId, roundNumber\)\)/);
    assert.doesNotMatch(dock, /saveTrpgActionDraft/);
    assert.doesNotMatch(dock, /trpgActionComposerForRound/);
    assert.doesNotMatch(dock, /sessionStorage/);
  });

  it("G. OOC and action drafts do not share state or submit endpoints", () => {
    const client = readFileSync("src/app/trpg/[id]/TrpgRoomClient.tsx", "utf8");
    const dock = readFileSync("src/app/trpg/TrpgCommandDock.tsx", "utf8");
    assert.match(client, /const \[actionBody, setActionBody\]/);
    assert.match(client, /const \[partyBody, setPartyBody\]/);
    const sendAction = client.slice(client.indexOf("async function sendAction"), client.indexOf("const requestSuggestions"));
    const sendParty = client.slice(client.indexOf("async function sendParty"), client.indexOf("const editing"));
    assert.match(sendAction, /\/action`/);
    assert.doesNotMatch(sendAction, /party-chat/);
    assert.match(sendParty, /party-chat/);
    assert.doesNotMatch(sendParty, /\/action/);
    assert.doesNotMatch(dock, /fetch\(/);
    assert.doesNotMatch(dock, /party-chat/);
    assert.doesNotMatch(dock, /\/action[`'"]/);
    const opened = openTrpgCommandDockMode(view(), "ooc", false);
    const back = selectTrpgCommandDockMode(opened, "action", false);
    assert.equal(back.mode, "action");
    assert.equal("body" in back, false);
    assert.equal(reconcileTrpgCommandDockLifecycle(opened, {
      presentationBusy: false,
      actionInput: true,
      lifecycleChanged: false,
    }).mode, "ooc");
  });

  it("H. item interaction fills a use_item draft and does not mutate inventory", () => {
    const inventory = ["붕대", "구급키트"];
    const bandage = useItemActionDraft(inventory[0] ?? "");
    const kit = useItemActionDraft(inventory[1] ?? "");
    assert.deepEqual(inventory, ["붕대", "구급키트"]);
    assert.equal(bandage?.actionType, "use_item");
    assert.equal(bandage?.body, "붕대를 사용한다.");
    assert.equal(kit?.body, "구급키트를 사용한다.");
    assert.equal(useItemActionDraft("  "), null);
    assert.equal("submit" in (bandage ?? {}), false);
    const dock = readFileSync("src/app/trpg/TrpgCommandDock.tsx", "utf8");
    const surface = readFileSync("src/lib/trpg/sheetSurface.ts", "utf8");
    assert.match(surface, /useItemActionDraft\(entry\.name\)/);
    assert.doesNotMatch(dock, /inventoryRemove/);
    assert.doesNotMatch(dock, /onSendAction\(\)/);
    assert.match(dock, /function HostEquipmentDock/);
    assert.match(dock, /data-trpg-equip-entry=\{item\.key\}/);
    assert.match(dock, /data-trpg-equip-slot=\{item\.key\}/);
    assert.match(dock, /onSetEquipped\(item\.key, !equipped\)/);
    assert.match(dock, /data-trpg-inventory-slot=\{item\.slot/);
    const strip = dock.slice(dock.indexOf("function HostEquipmentDock"), dock.indexOf("function SheetSurfaceView"));
    assert.doesNotMatch(strip, /<button[\s\S]*<button/);
    assert.doesNotMatch(dock, /setInventory\(|mutateItem\(|function setEquipped|function setSlot/);
    assert.doesNotMatch(strip, /\/action/);
    const party = dock.slice(dock.indexOf('case "party"'), dock.indexOf('case "ooc"'));
    assert.doesNotMatch(party, /HostEquipmentDock|onSetInventoryEquipped/);
  });

  it("I. treatable conditions reuse the contextual helper and other kinds stay informational", () => {
    const poison = ongoingEffectActionDraft({ kind: "periodic_harm", label: "중독" });
    assert.equal(poison?.actionType, "support");
    assert.equal(poison?.body, contextualStatusTreatDraft(["중독"]).body);
    assert.equal(ongoingEffectActionDraft({ kind: "control", label: "마비" })?.body, contextualStatusTreatDraft(["마비"]).body);
    assert.equal(ongoingEffectActionDraft({ kind: "narrative", label: "긴장" }), null);
    assert.equal(ongoingEffectActionDraft({ kind: "duration", label: "출혈" }), null);
  });

  it("J. presentation compacts the dock without a scroll owner, and an explicit OOC hold stays", () => {
    assert.equal(trpgCommandDockPresentationBusy({
      cinematicMotion: true,
      generating: false,
      botGenerationInFlight: false,
      gmNarrationRevealing: false,
    }), true);
    const action = initialTrpgCommandDockView({ actionInput: true, presentationBusy: false });
    const compact = reconcileTrpgCommandDockLifecycle(action, {
      presentationBusy: true,
      actionInput: false,
      lifecycleChanged: true,
    });
    assert.equal(compact.expanded, false);
    const held = openTrpgCommandDockMode(action, "ooc", true);
    const still = reconcileTrpgCommandDockLifecycle(held, {
      presentationBusy: true,
      actionInput: false,
      lifecycleChanged: true,
    });
    assert.equal(still.mode, "ooc");
    assert.equal(still.expanded, true);
    const dock = readFileSync("src/app/trpg/TrpgCommandDock.tsx", "utf8");
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.doesNotMatch(dock, /scrollIntoView|scrollTo\(|scrollBy\(/);
    assert.match(room, /manualScrollDetachedRef/);
    assert.match(room, /if \(!followLatestRef\.current \|\| manualScrollDetachedRef\.current\) return/);
    assert.match(room, /trpgCommandDockScrollMarginBottom\(dockOcclusion\)/);
  });

  it("K. mobile dock stays a compact/expanded surface with safe area and keyboard inset", () => {
    const dock = readFileSync("src/app/trpg/TrpgCommandDock.tsx", "utf8");
    assert.match(dock, /min-h-11/);
    assert.match(dock, /env\(safe-area-inset-bottom\)/);
    assert.match(dock, /visualViewport/);
    assert.match(dock, /max-h-\[min\(42dvh,24rem\)\]/);
    assert.doesNotMatch(dock, /role="dialog"/);
    assert.doesNotMatch(dock, /hover-only|sm:hidden[\s\S]{0,40}group-hover/);
    const occlusion = trpgCommandDockOcclusion(88, 240);
    assert.deepEqual(occlusion, { dockPx: 88, keyboardPx: 240, scrollMarginPx: 328 });
    assert.deepEqual(trpgCommandDockOcclusion(Number.NaN, -4), { dockPx: 0, keyboardPx: 0, scrollMarginPx: 0 });
  });

  it("keeps JSX chat bridge unwired and drops the stale model copy", () => {
    const dock = readFileSync("src/app/trpg/TrpgCommandDock.tsx", "utf8");
    const client = readFileSync("src/app/trpg/[id]/TrpgRoomClient.tsx", "utf8");
    assert.doesNotMatch(dock, /setChatDraft|requestChatSend|JsxHostBridgeProvider|bridge=|chatSendEnabled/);
    assert.doesNotMatch(client, /DeepSeek V4 Pro/);
    assert.doesNotMatch(client, /Flash는 쓰지/);
    assert.doesNotMatch(client, /Gemini/);
    assert.match(client, /TRPG_GM_GROSS_MARGIN/);
  });

  it("collapses ACTION during narration and restores it when action input returns", () => {
    const during = reconcileTrpgCommandDockLifecycle(
      initialTrpgCommandDockView({ actionInput: true, presentationBusy: false }),
      { presentationBusy: true, actionInput: false, lifecycleChanged: true }
    );
    assert.equal(during.expanded, false);
    const after = reconcileTrpgCommandDockLifecycle(during, {
      presentationBusy: false,
      actionInput: true,
      lifecycleChanged: true,
    });
    assert.deepEqual(after, { mode: "action", expanded: true, explicitHold: null });
    const self = openTrpgCommandDockMode(after, "self", false);
    const polled = reconcileTrpgCommandDockLifecycle(self, {
      presentationBusy: false,
      actionInput: true,
      lifecycleChanged: false,
    });
    assert.equal(polled.mode, "self");
    assert.equal(polled.expanded, true);
  });
});
