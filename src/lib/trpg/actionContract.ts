import type Database from "better-sqlite3";
import {
  classifyActionClause,
  committedItemConsumptionSpans,
  committedItemTakeSpans,
  stripQuotedDialogue,
} from "./actionSemantics";
import { resolveTrpgActionCheckDecision } from "./actionCheck";
import {
  canonicalRoomId,
  displayExplorationAp,
  explorationCommandsFromMovementBody,
  priceExplorationCommands,
  type ExplorationState,
} from "./explorationMap";
import type { ExplorationCommand } from "./explorationPublic";
import { inventoryHasName, type TrpgInventoryEntry } from "./inventory";
import { clauseNamesOtherParticipant } from "./movementDeclaration";
import type { TrpgActionType } from "./actionTypes";

export type TrpgActKind =
  | "move"
  | "search"
  | "observe"
  | "talk"
  | "wait"
  | "item_take"
  | "item_use"
  | "attack"
  | "defend"
  | "other";

export type TrpgActCommitment = "committed" | "conditional" | "negated" | "quoted" | "mentioned";

export type TrpgEndingIntent = "none" | "farewell_npc" | "scene_close" | "campaign_close";

export type TrpgActionAct = {
  index: number;
  kind: TrpgActKind;
  actorParticipantId: number;
  /** Exact clause or UI command that produced this act. */
  evidence: string;
  commitment: TrpgActCommitment;
  searchDepth?: "normal" | "careful";
  target?: string;
  item?: string;
  destinationRoomId?: string;
  /** Explicit terminal departure through the map boundary. */
  depart?: boolean;
  /** Set when this act depends on an earlier act's success (e.g. "이동한 뒤"). */
  dependsOn?: number;
  source: "human_text" | "bot_text" | "ui_command" | "accepted_items";
};

export type TrpgActionProposal = {
  version: 1;
  actorParticipantId: number;
  sourceText: string;
  acts: TrpgActionAct[];
  endingIntent: TrpgEndingIntent;
  clarification: string | null;
  owner: "server-rule-v1";
};

export type TrpgPlannedAct = TrpgActionAct & {
  status: "planned" | "unexecuted";
  reason?: string;
  apCost: number;
  needsCheck: boolean;
  checkReason?: string;
};

export type TrpgActionPlan = {
  version: 1;
  proposal: TrpgActionProposal;
  acts: TrpgPlannedAct[];
  executedText: string;
  unexecuted: Array<{ index: number; kind: TrpgActKind; reason: string }>;
  endingIntent: TrpgEndingIntent;
  createdAt: string;
};

export type ProposeActionOpts = {
  body: string;
  actorParticipantId: number;
  participantKind: "human" | "ai_character";
  partyNames?: readonly string[];
  inventory?: readonly TrpgInventoryEntry[];
  offers?: readonly string[];
  commands?: readonly ExplorationCommand[];
  acceptedItems?: readonly string[];
  knownRooms?: readonly { id: string; name: string }[];
  movementState?: ExplorationState | null;
  fromRoomId?: string;
  activeEncounterName?: string | null;
  source?: "human_text" | "bot_text";
};

const CONDITIONAL = /만약|조건이\s*맞으면|상황에\s*따라|(?:있|없|하|되|오|가|보|치|리|나|자|두|르|맞|싶|쫓)(?:으)?면(?!서)|다면|라면|거든/;
const NEGATED = /(?:지\s*않|지\s*못|지\s*말|않는다|않다|안\s+[가-힣]{1,12}다|못\s+[가-힣]{1,12}다)(?:\s*고|\s*으며|\s*아서|\s*어서)?\s*$/;
const NEGATED_PLUS_REMAINDER = /(.+?)(?:지\s*않(?:고|으며|아서|어서))\s+(.+)$/;
const ITEM_USE_VERB =
  /(?:을|를)\s*(?:마시고|먹고|사용하고|쓰고|바르고|투여하고|꺼내|붓고|붓는다|들이켜고)/;
const ITEM_TAKE_VERB = /(?:을|를)\s*(?:받아\s*들고|받아\s*든다|받아\s*들|받고|받는다|챙기고|집어\s*들고|건네받고)/;
const ATTACK = /공격|벤다|베어|때린다|찌른다|쏜다|마체테|도끼|찍는다|후려친다/;
const DEFEND = /방어|막는다|막아|피한다|회피|엄폐|숨는다/;
const SEARCH = /조사|살핀|뒤진|찾|수색|장부|궤짝|단서|탐색|확인한다/;
const TALK = /말한다|묻는다|외친다|대답|소리친다|속삭|말을\s*건넨다|인사/;
const WAIT = /기다|숨을\s*고르|머문|남아|서\s*있|대기/;
const OBSERVE = /보다|지켜|알아차|관찰|응시|둘러본다|듣는다/;
const CAMPAIGN_CLOSE = /(?:이\s*)?모험을\s*끝|캠페인을\s*끝|여정을\s*끝|여기서\s*끝|이\s*장면을\s*끝|완전히\s*끝|마무리한다/;
const FAREWELL = /작별\s*인사|마지막\s*인사|잘\s*가|안녕히|이별|작별/;

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Preserves clause order and splits Korean sequential connectors without dropping the connector. */
export function splitActionClauses(body: string): string[] {
  const normalized = normalize(body);
  if (!normalized) return [];
  // Quoted dialogue is one opaque span: sentence punctuation and connectors
  // inside a quote must not become separate acts.
  const quoted: string[] = [];
  const protectedText = normalized.replace(
    /"(?:[^"\\]|\\.)*"|“[^”]*”|「[^」]*」|『[^』]*』|'(?:[^'\\]|\\.)*'/g,
    (match) => {
      const index = quoted.push(match) - 1;
      return `\u0001${index}\u0001`;
    }
  );
  const restore = (part: string) =>
    part.replace(/\u0001(\d+)\u0001/g, (_, index: string) => quoted[Number(index)] ?? "");
  const sentences = protectedText
    .split(/(?<=[.!?。！？])\s+/u)
    .map((part) => part.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const sentence of sentences) {
    const parts = sentence
      .split(
        /(?:(?<=고)(?<!라고)|(?<=서)(?<![에게로]서)|(?<=뒤)|(?<=후)|(?<=다음))\s+|,\s+/u
      )
      .map((part) => part.trim())
      .filter(Boolean);
    out.push(...(parts.length > 0 ? parts : [sentence]).map(restore));
  }
  return out;
}

function itemMatch(text: string, names: readonly string[]): string | null {
  const key = normalize(text);
  const exact = [...names].filter(Boolean).sort((a, b) => b.length - a.length).find((name) => key.includes(name));
  if (exact) return exact;
  for (const name of [...names].filter(Boolean).sort((a, b) => b.length - a.length)) {
    const head = normalize(name).split(" ").filter(Boolean).at(-1) ?? "";
    if (head.length >= 2 && key.includes(head)) return name;
  }
  return null;
}

function actKindForClause(opts: {
  clause: string;
  rooms: readonly { id: string; name: string }[];
  inventoryNames: readonly string[];
  offers: readonly string[];
  activeEncounterName?: string | null;
  movementState?: ExplorationState | null;
  fromRoomId?: string;
}): { kind: TrpgActKind; item?: string; destinationRoomId?: string; target?: string; depart?: boolean } {
  const text = stripQuotedDialogue(opts.clause);
  if (!text) return { kind: "talk" };
  const inventoryItem = itemMatch(text, opts.inventoryNames);
  if (
    inventoryItem &&
    /(?:마시|먹|사용|쓰|바르|투여|꺼내|붓|들이켜)(?:고|서|면|다|는|요|,|\.|\s|$)/.test(text)
  ) {
    return { kind: "item_use", item: inventoryItem };
  }
  if (committedItemConsumptionSpans(text).length > 0 || ITEM_USE_VERB.test(text)) {
    const item = itemMatch(text, opts.inventoryNames);
    if (item) return { kind: "item_use", item };
  }
  if (committedItemTakeSpans(text).length > 0 || ITEM_TAKE_VERB.test(text)) {
    const item = itemMatch(text, [...opts.offers, ...opts.inventoryNames]);
    if (item) return { kind: "item_take", item };
  }
  if (ATTACK.test(text)) return { kind: "attack", ...(opts.activeEncounterName ? { target: opts.activeEncounterName } : {}) };
  if (DEFEND.test(text)) return { kind: "defend", ...(opts.activeEncounterName ? { target: opts.activeEncounterName } : {}) };
  if (opts.movementState) {
    const moveText = text
      .replace(/(?:뒤|후|나서)\s*$/, "")
      .replace(/(이동|걸어|내려|올라|들어|나가|도착)한\s*$/, "$1한다")
      .trim();
    const commands = explorationCommandsFromMovementBody(
      opts.movementState.map,
      moveText,
      opts.fromRoomId
    );
    const move = commands.find((command) => command.op === "move");
    if (move && move.op === "move") {
      return { kind: "move", destinationRoomId: move.roomId };
    }
    if (commands.some((command) => command.op === "depart")) {
      return { kind: "move", depart: true };
    }
  }
  if (SEARCH.test(text)) return { kind: "search" };
  if (TALK.test(text)) return { kind: "talk" };
  if (WAIT.test(text)) return { kind: "wait" };
  if (OBSERVE.test(text)) return { kind: "observe" };
  return { kind: "other" };
}

function commitmentForClause(clause: string, partyNames: readonly string[]): TrpgActCommitment {
  const visible = stripQuotedDialogue(clause);
  if (!visible) return "quoted";
  if (CONDITIONAL.test(visible) || classifyActionClause(clause).kind === "conditional") return "conditional";
  if (NEGATED.test(visible) || classifyActionClause(clause).kind === "declined") return "negated";
  if (clauseNamesOtherParticipant(clause, partyNames)) return "mentioned";
  return "committed";
}

function endingIntentFor(body: string): TrpgEndingIntent {
  if (CAMPAIGN_CLOSE.test(body)) return "campaign_close";
  if (FAREWELL.test(body)) return "farewell_npc";
  if (/장면을\s*끝|여기서\s*마무리/.test(body)) return "scene_close";
  return "none";
}

/**
 * Deterministic server proposal builder. UI command IDs are authoritative and
 * are not re-read from prose. Free text supplies only the remaining act
 * evidence, commitment, target, and order. This is not a JEV call and never
 * invents a destination or item that is absent from the known state.
 */
export function proposeTrpgAction(opts: ProposeActionOpts): TrpgActionProposal {
  const body = normalize(opts.body);
  const rooms = opts.knownRooms ?? [];
  const inventoryNames = (opts.inventory ?? []).map((entry) => entry.name);
  const offers = opts.offers ?? [];
  const partyNames = opts.partyNames ?? [];
  const acts: TrpgActionAct[] = [];
  const add = (act: Omit<TrpgActionAct, "index" | "actorParticipantId">) => {
    acts.push({ ...act, index: acts.length, actorParticipantId: opts.actorParticipantId });
  };
  let commandsInserted = false;
  const insertUiCommands = () => {
    if (commandsInserted) return;
    commandsInserted = true;
    for (const command of opts.commands ?? []) {
      if (command.op === "move") {
        const room = rooms.find((row) => row.id === command.roomId);
        add({
          kind: "move",
          evidence: room ? `${room.name}으로 이동한다.` : `[UI] move ${command.roomId}`,
          commitment: "committed",
          destinationRoomId: command.roomId,
          ...(room ? { target: room.name } : {}),
          source: "ui_command",
        });
      } else if (command.op === "search") {
        add({
          kind: "search",
          evidence: "주변을 조사한다.",
          commitment: "committed",
          searchDepth: command.depth,
          source: "ui_command",
        });
      } else if (command.op === "depart") {
        add({
          kind: "move",
          evidence: "[UI] depart",
          commitment: "committed",
          depart: true,
          source: "ui_command",
        });
      }
    }
  };

  for (const item of opts.acceptedItems ?? []) {
    add({
      kind: "item_take",
      item,
      evidence: `[accepted] ${item}`,
      commitment: "committed",
      source: "accepted_items",
    });
  }

  const clauses = splitActionClauses(body);
  let previousMoveIndex: number | null = null;
  let previousClauseDeclaresDependency = false;
  for (const clause of clauses) {
    const visible = stripQuotedDialogue(clause);
    if (!visible) {
      add({
        kind: "talk",
        evidence: clause,
        commitment: "committed",
        source: opts.source === "bot_text" ? "bot_text" : "human_text",
      });
      continue;
    }
    const dependsOnPreviousClause = previousClauseDeclaresDependency;
    const negated = NEGATED_PLUS_REMAINDER.exec(visible);
    if (negated) {
      const negatedPart = negated[1]!.trim();
      const remainder = negated[2]!.trim();
      const negatedKind = actKindForClause({
        clause: negatedPart,
        rooms,
        inventoryNames,
        offers,
        activeEncounterName: opts.activeEncounterName,
        movementState: opts.movementState ?? null,
        fromRoomId: opts.fromRoomId,
      });
      add({
        kind: negatedKind.kind,
        evidence: negatedPart,
        commitment: "negated",
        ...(negatedKind.item ? { item: negatedKind.item } : {}),
        ...(negatedKind.destinationRoomId ? { destinationRoomId: negatedKind.destinationRoomId } : {}),
        source: opts.source === "bot_text" ? "bot_text" : "human_text",
      });
      const remainderKind = actKindForClause({
        clause: remainder,
        rooms,
        inventoryNames,
        offers,
        activeEncounterName: opts.activeEncounterName,
        movementState: opts.movementState ?? null,
        fromRoomId: opts.fromRoomId,
      });
      add({
        kind: remainderKind.kind,
        evidence: remainder,
        commitment: "committed",
        ...(remainderKind.item ? { item: remainderKind.item } : {}),
        ...(remainderKind.destinationRoomId ? { destinationRoomId: remainderKind.destinationRoomId } : {}),
        ...(remainderKind.target ? { target: remainderKind.target } : {}),
        source: opts.source === "bot_text" ? "bot_text" : "human_text",
      });
      if (remainderKind.kind === "move") previousMoveIndex = acts.length - 1;
      previousClauseDeclaresDependency = /(?:뒤|후|나서|가서)\s*$/.test(visible);
      continue;
    }
    const explicitMoveOrSearch = (opts.commands ?? []).some(
      (command) => command.op === "move" || command.op === "search"
    );
    const kind = actKindForClause({
      clause,
      rooms,
      inventoryNames,
      offers,
      activeEncounterName: opts.activeEncounterName,
      movementState: opts.movementState ?? null,
      fromRoomId: opts.fromRoomId,
    });
    if (
      explicitMoveOrSearch &&
      (kind.kind === "move" ||
        kind.kind === "search" ||
        /이동|걸어|내려|올라|들어|나가|도착|향한|간다|나선|넘|통과|열고|조사|살핀|찾|수색/.test(visible))
    ) {
      // The UI command already owns this movement/search. The prose is a method note.
      insertUiCommands();
      let lastMove: number = previousMoveIndex ?? -1;
      for (let i = 0; i < acts.length; i += 1) {
        if (acts[i]!.kind === "move") lastMove = i;
      }
      if (lastMove >= 0) previousMoveIndex = lastMove;
      previousClauseDeclaresDependency = /(?:뒤|후|나서|가서)\s*$/.test(visible);
      continue;
    }
    const commitment = commitmentForClause(clause, partyNames);
    const dependsOn =
      previousMoveIndex != null &&
      kind.kind !== "move" &&
      (dependsOnPreviousClause || /뒤|후|도착|나서|가서|들어가|올라가/.test(visible))
        ? previousMoveIndex
        : undefined;
    add({
      kind: kind.kind,
      evidence: visible,
      commitment,
      ...(kind.item ? { item: kind.item } : {}),
      ...(kind.destinationRoomId ? { destinationRoomId: kind.destinationRoomId } : {}),
      ...(kind.depart ? { depart: true } : {}),
      ...(kind.target ? { target: kind.target } : {}),
      ...(dependsOn != null ? { dependsOn } : {}),
      source: opts.source === "bot_text" ? "bot_text" : "human_text",
    });
    if (kind.kind === "move") previousMoveIndex = acts.length - 1;
    previousClauseDeclaresDependency = /(?:뒤|후|나서|가서)\s*$/.test(visible);
  }

  if (!commandsInserted) insertUiCommands();

  const endingIntent = endingIntentFor(body);
  return {
    version: 1,
    actorParticipantId: opts.actorParticipantId,
    sourceText: body,
    acts,
    endingIntent,
    clarification: null,
    owner: "server-rule-v1",
  };
}

function checkForAct(
  act: TrpgActionAct,
  statValue?: number | null,
  actionTypeOverride?: TrpgActionType | null
): { needsCheck: boolean; reason?: string } {
  const actionType: TrpgActionType =
    actionTypeOverride ??
    (act.kind === "attack"
      ? "attack"
      : act.kind === "defend"
        ? "defend"
        : act.kind === "search"
          ? "investigate"
          : act.kind === "item_use" || act.kind === "item_take"
            ? "use_item"
            : "free");
  const decision = resolveTrpgActionCheckDecision({
    body: act.evidence,
    actionType,
    statValue: statValue ?? null,
  });
  return { needsCheck: decision.needsCheck, reason: decision.reason };
}

/**
 * Plan acts against the existing map/AP owner. No state is mutated. A failed
 * earlier act marks a dependent later act unexecuted; an illegal act is
 * reported with a reason instead of rejecting the whole sentence.
 */
export function planTrpgAction(opts: {
  proposal: TrpgActionProposal;
  state: ExplorationState | null;
  roundNumber: number;
  fromRoomId: string;
  inventory: readonly TrpgInventoryEntry[];
  offers: readonly string[];
  activeEncounterName?: string | null;
  statValue?: number | null;
  participantKind?: "human" | "ai_character";
  actionType?: TrpgActionType | null;
}): TrpgActionPlan {
  const inventory = [...opts.inventory];
  const actionOverride =
    opts.actionType && opts.actionType !== "use_item" ? opts.actionType : null;
  const overrideForAct = (act: TrpgActionAct): TrpgActionType | null =>
    act.kind === "item_use" || act.kind === "item_take" ? null : actionOverride;
  const acts: TrpgPlannedAct[] = [];
  let ap = opts.state ? displayExplorationAp(opts.state, opts.proposal.actorParticipantId, opts.roundNumber) : 0;
  let roomId = opts.fromRoomId;
  let firstCheckUsed = false;
  const unexecuted: TrpgActionPlan["unexecuted"] = [];

  for (const act of opts.proposal.acts) {
    const push = (planned: TrpgPlannedAct) => {
      acts.push(planned);
      if (planned.status === "unexecuted") unexecuted.push({ index: act.index, kind: act.kind, reason: planned.reason ?? "unexecuted" });
    };
    if (act.commitment !== "committed") {
      push({ ...act, status: "unexecuted", reason: `commitment:${act.commitment}`, apCost: 0, needsCheck: false });
      continue;
    }
    if (act.dependsOn != null) {
      const dependency = acts.find((row) => row.index === act.dependsOn);
      if (!dependency || dependency.status !== "planned") {
        push({ ...act, status: "unexecuted", reason: "prerequisite_failed", apCost: 0, needsCheck: false });
        continue;
      }
    }
    if (act.kind === "move") {
      if (!opts.state || !opts.state.map.rooms.length) {
        push({ ...act, status: "unexecuted", reason: "no_map", apCost: 0, needsCheck: false });
        continue;
      }
      if (!act.destinationRoomId && !act.depart) {
        push({ ...act, status: "unexecuted", reason: "unknown_destination", apCost: 0, needsCheck: false });
        continue;
      }
      try {
        const priced = priceExplorationCommands({
          state: opts.state,
          fromRoomId: roomId,
          commands: [act.depart ? { op: "depart" } : { op: "move", roomId: act.destinationRoomId! }],
          apRemaining: ap,
        });
        ap -= priced.spent;
        if (!act.depart) roomId = canonicalRoomId(opts.state.map, act.destinationRoomId!) ?? roomId;
        push({ ...act, status: "planned", apCost: priced.spent, needsCheck: false });
      } catch (error) {
        const message = (error as Error).message;
        push({
          ...act,
          status: "unexecuted",
          reason: message.includes("행동력") ? "ap" : message,
          apCost: 0,
          needsCheck: false,
        });
      }
      continue;
    }
    if (act.kind === "search") {
      // Free-text "살핀다" is a normal investigate action. Only an explicit
      // exploration UI command spends AP and fires map events.
      if (act.source !== "ui_command" || !opts.state) {
        if (act.source === "ui_command") {
          push({ ...act, status: "unexecuted", reason: "no_map", apCost: 0, needsCheck: false });
          continue;
        }
        const check = checkForAct(act, opts.statValue, overrideForAct(act));
        push({
          ...act,
          status: "planned",
          apCost: 0,
          needsCheck: check.needsCheck && !firstCheckUsed,
          checkReason: check.reason,
          ...(check.needsCheck && firstCheckUsed ? { reason: "one_check_per_turn" } : {}),
        });
        if (check.needsCheck) firstCheckUsed = true;
        continue;
      }
      try {
        const priced = priceExplorationCommands({
          state: opts.state,
          fromRoomId: roomId,
          commands: [{ op: "search", depth: act.searchDepth ?? "normal" }],
          apRemaining: ap,
        });
        ap -= priced.spent;
        const check = checkForAct(act, opts.statValue, overrideForAct(act));
        push({
          ...act,
          status: "planned",
          apCost: priced.spent,
          needsCheck: check.needsCheck && !firstCheckUsed,
          checkReason: check.reason,
          ...(check.needsCheck && firstCheckUsed ? { reason: "one_check_per_turn" } : {}),
        });
        if (check.needsCheck) firstCheckUsed = true;
      } catch (error) {
        const message = (error as Error).message;
        push({
          ...act,
          status: "unexecuted",
          reason: message.includes("행동력") ? "ap" : message,
          apCost: 0,
          needsCheck: false,
        });
      }
      continue;
    }
    if (act.kind === "item_use") {
      if (!act.item || !inventoryHasName(inventory, act.item)) {
        push({ ...act, status: "unexecuted", reason: "item_missing", apCost: 0, needsCheck: false });
        continue;
      }
      const check = checkForAct(act, opts.statValue, overrideForAct(act));
      push({ ...act, status: "planned", apCost: 0, needsCheck: check.needsCheck, checkReason: check.reason });
      continue;
    }
    if (act.kind === "item_take") {
      const inInventory = Boolean(act.item && inventoryHasName(inventory, act.item));
      const offered = Boolean(act.item && opts.offers.includes(act.item));
      const accepted = act.source === "accepted_items";
      const available = inInventory || accepted || (opts.participantKind !== "human" && offered);
      if (!available) {
        push({
          ...act,
          status: "unexecuted",
          reason: offered ? "needs_acceptance" : "item_not_available",
          apCost: 0,
          needsCheck: false,
        });
        continue;
      }
      push({ ...act, status: "planned", apCost: 0, needsCheck: false });
      continue;
    }
    if (act.kind === "attack" || act.kind === "defend") {
      const check = checkForAct(act, opts.statValue, overrideForAct(act));
      push({
        ...act,
        status: "planned",
        apCost: 0,
        needsCheck: check.needsCheck && !firstCheckUsed,
        checkReason: check.reason,
        ...(check.needsCheck && firstCheckUsed ? { reason: "one_check_per_turn" } : {}),
      });
      if (check.needsCheck) firstCheckUsed = true;
      continue;
    }
    const check = checkForAct(act, opts.statValue, overrideForAct(act));
    push({ ...act, status: "planned", apCost: 0, needsCheck: check.needsCheck && !firstCheckUsed, checkReason: check.reason });
    if (check.needsCheck) firstCheckUsed = true;
  }

  const planned = acts.filter((act) => act.status === "planned");
  return {
    version: 1,
    proposal: opts.proposal,
    acts,
    executedText: planned.map((act) => act.evidence).join(" ").trim(),
    unexecuted,
    endingIntent: opts.proposal.endingIntent,
    createdAt: new Date().toISOString(),
  };
}

export function loadActionPlan(
  db: Database.Database,
  roundId: number,
  participantId: number
): TrpgActionPlan | null {
  const row = db
    .prepare(`SELECT action_plan_json FROM trpg_action_submissions WHERE round_id=? AND participant_id=?`)
    .get(roundId, participantId) as { action_plan_json?: string | null } | undefined;
  if (!row?.action_plan_json) return null;
  try {
    return JSON.parse(row.action_plan_json) as TrpgActionPlan;
  } catch {
    return null;
  }
}
