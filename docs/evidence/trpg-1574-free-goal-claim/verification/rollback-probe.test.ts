import assert from "node:assert/strict";
import { it } from "node:test";
import * as NEW from "/workspace/src/lib/trpg/campaignGoals";
import * as OLD from "/tmp/base/src/lib/trpg/campaignGoals";

it("host-confirmed completion read and re-saved by the previous (real) build, then read by the new build", () => {
  const confirmed: NEW.TrpgGoal[] = [
    { id: "g1", title: "행방 추적", status: "completed", source: "gm", createdRound: 0, claimedRound: 1, closedRound: 1,
      claimSource: { generationId: "gen-1", narrationDigest: "abc" }, evidence: { kind: "host_confirmed", round: 1, participantId: 7 } },
    { id: "g2", title: "단서 조사", status: "active", source: "gm", createdRound: 1, claimedRound: 2,
      claimSource: { generationId: "gen-2", narrationDigest: "def" } },
  ];
  const written = NEW.serializeGoals(confirmed);
  console.log("NEW wrote   :", written);
  const oldRead = OLD.parseGoalsJson(written);
  console.log("OLD read    :", JSON.stringify(oldRead?.map((g) => ({ id: g.id, status: g.status, evidence: g.evidence ?? null, claimedRound: g.claimedRound ?? null }))));
  const oldRewrite = OLD.serializeGoals(oldRead!);
  console.log("OLD rewrote :", oldRewrite);
  const back = NEW.parseGoalsJson(oldRewrite)!;
  const done = back.find((g) => g.id === "g1")!;
  const pending = back.find((g) => g.id === "g2")!;
  console.log("NEW basis   :", NEW.goalCompletionBasis(done), "| completed status kept:", done.status);
  console.log("NEW pending :", JSON.stringify({ pendingClaim: NEW.hasPendingClaim(pending), hasSource: !!pending.claimSource }));
  assert.equal(done.status, "completed");
  assert.equal(NEW.goalCompletionBasis(done), "unrecorded");
  assert.equal(NEW.hasPendingClaim(pending), true);
  assert.equal(pending.claimSource, undefined, "old build dropped the source: the claim can never be confirmed");
});
