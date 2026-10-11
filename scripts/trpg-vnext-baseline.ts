/**
 * TRPG vNext Phase 0 — deterministic baseline probes against the CURRENT main code.
 * No provider call, no DB, no network. Output is evidence for docs/architecture/trpg-vnext/RFC.md.
 *
 * Run:
 *   node --conditions=react-server --import tsx --import ./src/lib/test/regularTestEgressPolicy.ts \
 *     scripts/trpg-vnext-baseline.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveTrpgActionCheckDecision } from "../src/lib/trpg/actionCheck.ts";
import { parseStoredInventory } from "../src/lib/trpg/inventory.ts";
import {
  buildHorizonPromptSections,
  eventVisibleToViewer,
  selectHistoricalRecall,
  type TrpgMemoryEvent,
  type TrpgMemoryQuery,
} from "../src/lib/trpg/memoryHorizon.ts";
import { hpOwnershipOf, mergeMechanicsOwnedDelta } from "../src/lib/trpg/mechanicsMerge.ts";
import { resolveRoundMechanics } from "../src/lib/trpg/mechanicsResolve.ts";
import type { MechanicsActorInput, MechanicsResolution } from "../src/lib/trpg/mechanicsTypes.ts";
import { derivePostGmOngoingSeeds } from "../src/lib/trpg/postGmOngoing.ts";
import type { TrpgActionType } from "../src/lib/trpg/actionTypes.ts";
import type { TrpgSheetSnapshot, TrpgStateDelta } from "../src/lib/trpg/types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolvePath(here, "..");
const outDir = resolvePath(root, "docs/architecture/trpg-vnext/baseline");
const baseCommit = process.env.BASELINE_COMMIT ?? "796d279f";

function sheet(partial: Partial<TrpgSheetSnapshot> & { inventory?: readonly string[] } = {}): TrpgSheetSnapshot {
  const { inventory, ...rest } = partial;
  return {
    participantId: 1,
    name: "강이현",
    playerName: "현",
    level: 1,
    hp: 30,
    maxHp: 30,
    stats: { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8, res: 8 },
    conditions: [],
    inventory: parseStoredInventory(inventory ?? []),
    location: "",
    modifiersNote: "",
    ...rest,
  };
}

function actor(partial: Partial<MechanicsActorInput> = {}): MechanicsActorInput {
  return {
    participantId: 1,
    name: "강이현",
    actionType: "attack",
    body: "적을 공격한다",
    tier: "SUCCESS",
    d20: 14,
    modifier: 1,
    finalScore: 15,
    dc: 12,
    statKey: "str",
    ...partial,
  };
}

function resolveMech(partial: Partial<Parameters<typeof resolveRoundMechanics>[0]> = {}): MechanicsResolution {
  return resolveRoundMechanics({
    campaignId: 1,
    roundId: 900,
    roundNumber: 6,
    sheets: [sheet()],
    effects: [],
    actors: [actor()],
    flash: null,
    fallback: "gm_legacy",
    calledFlash: false,
    model: null,
    latencyMs: 0,
    baseDc: 12,
    rng: () => 4,
    recoveryRng: () => 1,
    scene: "적대적 위협이 눈앞에 있다.",
    ...partial,
  });
}

type HpProbe = {
  id: string;
  situation: string;
  gmDelta: string;
  startHp: number;
  endHp: number | null;
  expectedByContract: number;
  verdict: "DEFECT" | "PRESERVED" | "DECISION_NEEDED";
  note: string;
};

function runMerge(
  sheets: TrpgSheetSnapshot[],
  delta: TrpgStateDelta,
  res: MechanicsResolution | null
): { next: TrpgSheetSnapshot[] } | null {
  const out = mergeMechanicsOwnedDelta(sheets, delta, res);
  return out.ok ? { next: out.next } : null;
}

function hpProbes(): HpProbe[] {
  const probes: HpProbe[] = [];
  const hpOf = (next: TrpgSheetSnapshot[] | undefined, id: number) => next?.find((s) => s.participantId === id)?.hp ?? null;

  {
    const res = resolveMech({ actors: [actor({ actionType: "free", body: "그 자리에 서서 골목 소리를 듣는다.", tier: "SUCCESS" })] });
    const out = runMerge([sheet()], { players: [{ participantId: 1, hp: 8 }] } as TrpgStateDelta, res);
    probes.push({
      id: "H1",
      situation: "PC listens (no hazard, no threat provenance). GM writes hp 30 -> 8 in structured output.",
      gmDelta: "players[1].hp=8",
      startHp: 30,
      endHp: hpOf(out?.next, 1),
      expectedByContract: 30,
      verdict: hpOf(out?.next, 1) === 30 ? "PRESERVED" : "DEFECT",
      note: "GM_LEGACY owner is permissive: any in-range integer below start HP commits. This is the #1494 class-C gap.",
    });
  }
  {
    const res = resolveMech({ actors: [actor({ actionType: "attack", body: "적을 공격한다", tier: "FAILURE" })] });
    const out = runMerge([sheet()], { players: [{ participantId: 1, hp: 30 }] } as TrpgStateDelta, res);
    probes.push({
      id: "H2",
      situation: "PC attacks and FAILS; GM narrates a counter-hit but omits hp (server has no hit-damage owner while referee is OFF).",
      gmDelta: "players[1].hp omitted",
      startHp: 30,
      endHp: hpOf(out?.next, 1),
      expectedByContract: 30,
      verdict: "DECISION_NEEDED",
      note: "Server has no pre-approved damage source for NPC attacks, so a legitimate counter-hit omitted by the GM is silently lost. Contract needs a server-owned threat event (RFC §5).",
    });
  }
  {
    const res = resolveMech({ actors: [actor({ actionType: "attack", body: "적을 공격한다", tier: "FAILURE" })] });
    const out = runMerge([sheet()], { players: [{ participantId: 1, hp: 22 }] } as TrpgStateDelta, res);
    probes.push({
      id: "H3",
      situation: "PC attacks and fails; GM writes hp 30 -> 22 (legitimate counter-hit).",
      gmDelta: "players[1].hp=22",
      startHp: 30,
      endHp: hpOf(out?.next, 1),
      expectedByContract: 22,
      verdict: hpOf(out?.next, 1) === 22 ? "PRESERVED" : "DEFECT",
      note: "Legitimate combat damage must keep working. Same code path as H1 — the owner cannot distinguish H1 from H3.",
    });
  }
  {
    const sheets = [sheet({ participantId: 1 }), sheet({ participantId: 2, name: "렌", playerName: "AI" })];
    const res = resolveMech({ sheets, actors: [actor({ participantId: 1, actionType: "free", body: "문 앞에서 기다린다", tier: "SUCCESS" })] });
    const out = runMerge(sheets, { players: [{ participantId: 2, hp: 12 }] } as TrpgStateDelta, res);
    probes.push({
      id: "H4",
      situation: "Non-actor seat (렌) gets hp 30 -> 12 from GM with no scene threat.",
      gmDelta: "players[2].hp=12",
      startHp: 30,
      endHp: hpOf(out?.next, 2),
      expectedByContract: 30,
      verdict: hpOf(out?.next, 2) === 30 ? "PRESERVED" : "DEFECT",
      note: `hpOwnership(p2)=${JSON.stringify(hpOwnershipOf(res, 2))}. The merge accepts GM hp for a seat that submitted no action and has no server layer.`,
    });
  }
  {
    const base = resolveMech({ actors: [actor({ actionType: "free", body: "소리를 듣는다", tier: "SUCCESS" })] });
    const incomplete: MechanicsResolution = { ...base, complete: false };
    const out = runMerge([sheet()], { players: [{ participantId: 1, hp: 8 }] } as TrpgStateDelta, incomplete);
    probes.push({
      id: "H5",
      situation: "Mechanics resolution incomplete (referee failure path) + GM hp 8.",
      gmDelta: "players[1].hp=8",
      startHp: 30,
      endHp: hpOf(out?.next, 1),
      expectedByContract: 30,
      verdict: hpOf(out?.next, 1) === 30 ? "PRESERVED" : "DEFECT",
      note: "The incomplete path assigns clampHp(gmHp) unconditionally; failure recovery widens GM authority.",
    });
  }
  {
    const hurt = sheet({ hp: 10 });
    const res = resolveMech({ sheets: [hurt], actors: [actor({ actionType: "free", body: "소리를 듣는다", tier: "SUCCESS" })] });
    const out = runMerge([hurt], { players: [{ participantId: 1, hp: 30 }] } as TrpgStateDelta, res);
    probes.push({
      id: "H6",
      situation: "PC at hp 10 only listens; GM writes hp 30 (free full heal).",
      gmDelta: "players[1].hp=30",
      startHp: 10,
      endHp: hpOf(out?.next, 1),
      expectedByContract: 10,
      verdict: hpOf(out?.next, 1) === 10 ? "PRESERVED" : "DEFECT",
      note: "GM heal without a server recovery roll or item provenance is accepted (fallbackHpAfterTickAndGmHeal / direct assign).",
    });
  }
  {
    const s = sheet();
    const seeds = derivePostGmOngoingSeeds({
      startingSheets: [s],
      delta: { players: [{ participantId: 1, conditions: ["중독"] }] } as TrpgStateDelta,
    });
    probes.push({
      id: "H7",
      situation: "GM adds condition '중독' to a PC with no hazard provenance.",
      gmDelta: "players[1].conditions=['중독']",
      startHp: 30,
      endHp: null,
      expectedByContract: 0,
      verdict: seeds.length === 0 ? "PRESERVED" : "DEFECT",
      note: `derivePostGmOngoingSeeds returned ${JSON.stringify(seeds)} — a GM-only condition string self-authorizes a server DOT effect that will tick HP in later rounds.`,
    });
  }
  {
    const res = resolveMech({ actors: [actor({ actionType: "free", body: "소리를 듣는다", tier: "SUCCESS" })] });
    const out = runMerge([sheet()], { players: [{ participantId: 1, inventoryAdd: ["용의 심장"] }] } as TrpgStateDelta, res);
    const names = out?.next[0]?.inventory.map((e) => e.name) ?? [];
    probes.push({
      id: "H8",
      situation: "GM adds inventory item '용의 심장' on a listen action.",
      gmDelta: "players[1].inventoryAdd=['용의 심장']",
      startHp: 30,
      endHp: null,
      expectedByContract: 0,
      verdict: names.some((n) => n.includes("용의 심장")) ? "DECISION_NEEDED" : "PRESERVED",
      note: `inventory after merge: ${JSON.stringify(names)}. Item grants have no provenance check either; same authority class as HP.`,
    });
  }
  {
    const res = resolveMech({
      actors: [actor({ actionType: "attack", body: "적을 공격한다", tier: "FAILURE" })],
      flash: { effects: [{ participantId: 1, directEffect: "harm", directClass: "MEDIUM", cause: "enemy_counter" }] },
      fallback: "none",
      calledFlash: true,
    });
    const out = runMerge([sheet()], { players: [{ participantId: 1, hp: 29 }] } as TrpgStateDelta, res);
    const stored = res.hpAfter["1"];
    probes.push({
      id: "H9",
      situation: "Referee ON (default OFF): authoritative harm exists; GM tries a milder hp.",
      gmDelta: "players[1].hp=29",
      startHp: 30,
      endHp: hpOf(out?.next, 1),
      expectedByContract: stored ?? -1,
      verdict: hpOf(out?.next, 1) === stored ? "PRESERVED" : "DEFECT",
      note: `hpOwnership=${JSON.stringify(hpOwnershipOf(res, 1))}. Server-owned harm beats the GM when a server owner exists.`,
    });
  }
  {
    const hurt = sheet({ hp: 10 });
    const res = resolveMech({
      sheets: [hurt],
      actors: [actor({ actionType: "support", body: "상처를 응급처치한다", tier: "SUCCESS", statKey: "wis" })],
    });
    const out = runMerge([hurt], { players: [{ participantId: 1, hp: 3 }] } as TrpgStateDelta, res);
    const floor = res.hpAfter["1"];
    probes.push({
      id: "H10",
      situation: "PC heals self (server recovery roll); GM writes a lower stale hp.",
      gmDelta: "players[1].hp=3",
      startHp: 10,
      endHp: hpOf(out?.next, 1),
      expectedByContract: floor ?? -1,
      verdict: (hpOf(out?.next, 1) ?? -1) >= (floor ?? 0) ? "PRESERVED" : "DEFECT",
      note: `recovery floor=${floor}; a stale lower GM hp does not undercut the server recovery floor when the seat is a recovery actor.`,
    });
  }
  return probes;
}

type ActionProbe = {
  id: string;
  text: string;
  target: string;
  class: string;
  confidence: string;
  free: { needsCheck: boolean; reason: string };
  chipAttack: { needsCheck: boolean; reason: string };
  freeMatches: boolean;
  chipMatches: boolean;
};

function actionProbes(): { items: ActionProbe[]; summary: Record<string, number> } {
  const corpus = JSON.parse(
    readFileSync(resolvePath(root, "docs/architecture/trpg-vnext/fixtures/action-corpus.json"), "utf8")
  ) as { items: Array<{ id: string; text: string; target: string; class: string; confidence: string }> };
  const items: ActionProbe[] = corpus.items.map((item) => {
    const free = resolveTrpgActionCheckDecision({ body: item.text, actionType: "free" as TrpgActionType });
    const chip = resolveTrpgActionCheckDecision({ body: item.text, actionType: "attack" as TrpgActionType });
    const wantRoll = item.target === "roll";
    return {
      ...item,
      free,
      chipAttack: chip,
      freeMatches: item.target === "clarify" ? true : free.needsCheck === wantRoll,
      chipMatches: item.target === "clarify" ? true : chip.needsCheck === wantRoll,
    };
  });
  const scored = items.filter((i) => i.target !== "clarify");
  const summary = {
    total: items.length,
    scored: scored.length,
    freeMatch: scored.filter((i) => i.freeMatches).length,
    chipAttackMatch: scored.filter((i) => i.chipMatches).length,
    noRollItems: scored.filter((i) => i.target === "no_roll").length,
    noRollItemsChipForcedRoll: scored.filter((i) => i.target === "no_roll" && i.chipAttack.needsCheck).length,
    rollItems: scored.filter((i) => i.target === "roll").length,
    rollItemsMissedWhenFree: scored.filter((i) => i.target === "roll" && !i.free.needsCheck).length,
    clarifyItems: items.filter((i) => i.target === "clarify").length,
    clarifyPathExistsInCurrentOwner: false,
    probeContext: "localScene=null, intent=null (production passes both; absolute rates are indicative, not production rates)",
  };
  return { items, summary };
}

function ev(
  id: number,
  round: number,
  partial: Partial<TrpgMemoryEvent> & Pick<TrpgMemoryEvent, "type" | "fact">
): TrpgMemoryEvent {
  return {
    id,
    campaignId: 1,
    roundStart: round,
    roundEnd: round,
    round,
    fingerprint: `fp-${id}`,
    actors: [],
    entities: [],
    keywords: [],
    importance: "important",
    scope: "party_observed",
    ...partial,
  };
}

function memoryProbes() {
  const events: TrpgMemoryEvent[] = [
    ev(1, 3, { type: "relationship", fact: "렌은 유나를 처음으로 신뢰한다고 말했다.", actors: ["렌", "유나"], entities: ["렌", "유나"], keywords: ["신뢰"] }),
    ev(2, 12, { type: "item", fact: "현이 은색 열쇠를 얻었다.", actors: ["강이현"], entities: ["은색 열쇠"], keywords: ["열쇠"] }),
    ev(3, 30, {
      type: "betrayal",
      fact: "렌은 몰래 길드에 파티 위치를 넘겼다.",
      actors: ["렌"],
      entities: ["길드"],
      keywords: ["배신", "길드"],
      importance: "critical",
      scope: "actor_only",
      knownParticipantIds: [2],
    }),
    ev(4, 45, { type: "item", fact: "현이 은색 열쇠를 잃어버렸다.", actors: ["강이현"], entities: ["은색 열쇠"], keywords: ["열쇠"] }),
    ev(5, 60, { type: "reveal", fact: "길드장이 렌의 배신을 공개적으로 폭로했다.", actors: ["길드장", "렌"], entities: ["길드"], keywords: ["배신", "길드"], importance: "critical" }),
  ];
  const baseQuery = (currentRound: number, viewerKind: "gm" | "bot", viewerName?: string): TrpgMemoryQuery => ({
    names: ["렌", "유나", "강이현"],
    actionText: "렌에게 길드와 열쇠에 대해 묻는다",
    location: "",
    quests: [],
    npcs: [],
    inventory: ["은색 열쇠"],
    worldFlags: [],
    sceneText: "",
    currentRound,
    viewerKind,
    viewerName,
  });

  const rows = [5, 20, 50, 100].map((round) => {
    // Production seals events only after the 3-round RAW window.
    const sealed = events.filter((e) => e.roundEnd <= round - 3);
    const view = (kind: "gm" | "bot", name?: string) =>
      selectHistoricalRecall(sealed, baseQuery(round, kind, name)).map((e) => ({
        id: e.id,
        round: e.round,
        score: Math.round(e.score * 10) / 10,
        scope: e.scope,
        fact: e.fact,
      }));
    return {
      round,
      sealedEventCount: sealed.length,
      gm: view("gm"),
      botRen: view("bot", "렌"),
      botYuna: view("bot", "유나"),
      sections: (() => {
        const s = buildHorizonPromptSections({ events: sealed, query: baseQuery(round, "gm") });
        return { relevantCount: s.relevantCount, anchorsCount: s.anchorsCount, botCount: s.botCount };
      })(),
    };
  });

  const r100 = rows.find((r) => r.round === 100)!;
  const recallRounds = r100.gm.map((e) => e.round);
  const chronological = recallRounds.every((r, i) => i === 0 || (r ?? 0) >= (recallRounds[i - 1] ?? 0));
  const betrayal = events[2]!;
  const visibility = {
    gmSeesActorOnly: eventVisibleToViewer(betrayal, { viewerKind: "gm" }),
    botRenSeesOwn: eventVisibleToViewer(betrayal, { viewerKind: "bot", viewerName: "렌" }),
    botYunaSeesRenSecret: eventVisibleToViewer(betrayal, { viewerKind: "bot", viewerName: "유나" }),
    knownParticipantIdsConsultedByVisibility: false,
    note: "knownParticipantIds is persisted (memoryHorizon.persistMemoryEvents) but eventVisibleToViewer filters by scope + actor-name overlap only.",
  };
  const contradictions = {
    itemGainedAndLostBothRecalledAtR100: r100.gm.filter((e) => e.fact.includes("은색 열쇠")).length === 2,
    note: "Events are append-only facts with no supersede/closure link; a gain (R12) and a loss (R45) both rank into recall with no state resolution.",
  };
  return {
    seed: events.map((e) => ({ id: e.id, round: e.round, type: e.type, scope: e.scope, importance: e.importance, fact: e.fact })),
    rows,
    recallChronologicalAtR100: chronological,
    recallRoundOrderAtR100: recallRounds,
    visibility,
    contradictions,
    humanViewerFilter: "none — viewerKind is only 'gm' | 'bot'; there is no per-human-participant view in TrpgMemoryQuery",
  };
}

const hp = hpProbes();
const actions = actionProbes();
const memory = memoryProbes();

const result = {
  schema: "trpg-vnext.baseline.v1",
  baseCommit,
  providerCalls: 0,
  dbWrites: 0,
  hp,
  hpSummary: {
    total: hp.length,
    defects: hp.filter((p) => p.verdict === "DEFECT").map((p) => p.id),
    decisionNeeded: hp.filter((p) => p.verdict === "DECISION_NEEDED").map((p) => p.id),
    preserved: hp.filter((p) => p.verdict === "PRESERVED").map((p) => p.id),
  },
  actions: actions.summary,
  actionItems: actions.items,
  memory,
};

mkdirSync(outDir, { recursive: true });
writeFileSync(resolvePath(outDir, `baseline-${baseCommit}.json`), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ hpSummary: result.hpSummary, actions: result.actions, memory: { visibility: memory.visibility, chronological: memory.recallChronologicalAtR100, order: memory.recallRoundOrderAtR100, contradictions: memory.contradictions } }, null, 2));
