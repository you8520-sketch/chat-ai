import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveLiveActorDeclarationPresentation } from "./roundPresentation";
import { resolveTrpgLiveFollowOwner } from "./followLatest";
import { isLiveTurnCinematicMotion } from "./liveTurnStatus";
import { resolveActorScopedDeclarationEnd, createEmptyActiveDeclarationEndRef } from "./liveStreamFollow";

const BOT1 = 101;
const BOT2 = 102;

function presentationActors(roundNumber: number) {
  return [
    { actorId: BOT1, action: { participantId: BOT1, kind: "ai_character", body: "bot1" } },
    { actorId: BOT2, action: { participantId: BOT2, kind: "ai_character", body: "bot2" } },
  ] as const;
}

describe("Bot1 → dice → Bot2 handoff follow state", () => {
  it("S1 Bot1 actor-action → ACTIVE_DECLARATION_END with Bot1 sentinel owner", () => {
    const declaration = resolveLiveActorDeclarationPresentation({
      mode: "cinematic",
      phase: "actor-action",
      presentationIndex: 0,
      presentationActors: presentationActors(1),
      actions: [],
      consumedAiIds: new Set(),
    });
    assert.equal(declaration.activeDeclarationActorId, BOT1);
    const owner = resolveTrpgLiveFollowOwner({
      cinematicMotion: isLiveTurnCinematicMotion("cinematic", "actor-action"),
      activeDeclarationReveal: declaration.activeDeclarationActorId != null,
      freshGmRound: null,
      gmRevealComplete: false,
      nextActionVisible: false,
    });
    assert.equal(owner, "ACTIVE_DECLARATION_END");
    const bot1El = { id: BOT1 } as HTMLSpanElement;
    const ref = { actorId: BOT1, element: bot1El };
    assert.equal(
      resolveActorScopedDeclarationEnd({
        activeActorId: declaration.activeDeclarationActorId,
        ref,
        queryScopedElement: () => null,
      }),
      ref.element
    );
  });

  it("S2 Bot1 actor-dice → cinematic motion without declaration detach semantics", () => {
    const declaration = resolveLiveActorDeclarationPresentation({
      mode: "cinematic",
      phase: "actor-dice",
      presentationIndex: 0,
      presentationActors: presentationActors(1),
      actions: [],
      consumedAiIds: new Set(),
    });
    assert.equal(declaration.activeDeclarationActorId, null);
    const owner = resolveTrpgLiveFollowOwner({
      cinematicMotion: isLiveTurnCinematicMotion("cinematic", "actor-dice"),
      activeDeclarationReveal: false,
      freshGmRound: null,
      gmRevealComplete: false,
      nextActionVisible: false,
    });
    assert.equal(owner, "CURRENT_ACTOR");
  });

  it("S3 Bot1 actor-result → follow owner stays attached path via cinematic motion", () => {
    const owner = resolveTrpgLiveFollowOwner({
      cinematicMotion: isLiveTurnCinematicMotion("cinematic", "actor-result"),
      activeDeclarationReveal: false,
      freshGmRound: null,
      gmRevealComplete: false,
      nextActionVisible: false,
    });
    assert.equal(owner, "CURRENT_ACTOR");
  });

  it("S4-S6 presentationIndex 0→1 switches declaration owner to Bot2", () => {
    const bot1 = resolveLiveActorDeclarationPresentation({
      mode: "cinematic",
      phase: "actor-action",
      presentationIndex: 0,
      presentationActors: presentationActors(1),
      actions: [],
      consumedAiIds: new Set(),
    });
    assert.equal(bot1.activeDeclarationActorId, BOT1);

    const bot2 = resolveLiveActorDeclarationPresentation({
      mode: "cinematic",
      phase: "actor-action",
      presentationIndex: 1,
      presentationActors: presentationActors(1),
      actions: [],
      consumedAiIds: new Set(),
    });
    assert.equal(bot2.activeDeclarationActorId, BOT2);
    const owner = resolveTrpgLiveFollowOwner({
      cinematicMotion: true,
      activeDeclarationReveal: true,
      freshGmRound: null,
      gmRevealComplete: false,
      nextActionVisible: false,
    });
    assert.equal(owner, "ACTIVE_DECLARATION_END");

    const staleBot1Ref = { actorId: BOT1, element: { id: BOT1 } as HTMLSpanElement };
    const bot2El = { id: BOT2 } as HTMLSpanElement;
    const resolved = resolveActorScopedDeclarationEnd({
      activeActorId: BOT2,
      ref: staleBot1Ref,
      queryScopedElement: (id) => (id === BOT2 ? bot2El : null),
    });
    assert.equal(resolved, bot2El);
    assert.notEqual(resolved, staleBot1Ref.element);
  });

  it("S7 stale disconnected Bot1 ref is not used for Bot2 follow target", () => {
    const stale = { actorId: BOT1, element: { id: BOT1 } as HTMLSpanElement };
    const resolved = resolveActorScopedDeclarationEnd({
      activeActorId: BOT2,
      ref: stale,
      queryScopedElement: () => null,
    });
    assert.equal(resolved, null);
    assert.equal(createEmptyActiveDeclarationEndRef().actorId, -1);
  });
});
