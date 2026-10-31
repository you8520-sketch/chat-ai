/**
 * Local, no-provider replay of the existing #45 R12 farewell.
 *
 * The production campaign #45 is not called. There is no DB write. The exact
 * stored human body and bot NO_MOVE bodies are fed through the R1 server
 * proposal/plan/ending contract only.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { planTrpgAction, proposeTrpgAction } from "../src/lib/trpg/actionContract";
import { evaluateTrpgEndingDecision } from "../src/lib/trpg/endingDecision";
import type { TrpgGoal } from "../src/lib/trpg/campaignGoals";

type Fixture = {
  humanBody: string;
  botBodies: Record<string, string>;
  publicStateAtR12: { goals: Array<{ id: string; status: string; claimed: boolean }> };
  expected: { endingIntent: string; serverEndingDecision: string };
  counterfactual: { body: string; expectedEndingIntent: string };
};

const fixture = JSON.parse(
  readFileSync(resolve("docs/architecture/trpg-vnext/fixtures/trpg-r1-c45-farewell-replay.json"), "utf8")
) as Fixture;

const goals: TrpgGoal[] = fixture.publicStateAtR12.goals.map((goal) => ({
  id: goal.id,
  title: "찻집 주인의 부탁",
  status: goal.status as TrpgGoal["status"],
  source: "gm",
  createdRound: 9,
  ...(goal.claimed ? { claimedRound: 12 } : {}),
}));

const completedGoals: TrpgGoal[] = goals.map((goal) => ({ ...goal, status: "completed" as const }));

function replay(body: string) {
  const proposal = proposeTrpgAction({
    body,
    actorParticipantId: 1,
    participantKind: "human",
    partyNames: ["강이현", "권태현"],
    knownRooms: [{ id: "exit", name: "출입문" }],
    inventory: [],
    source: "human_text",
  });
  const plan = planTrpgAction({
    proposal,
    state: null,
    roundNumber: 12,
    fromRoomId: "출입문",
    inventory: [],
    offers: [],
    participantKind: "human",
  });
  return { proposal, plan };
}

const human = replay(fixture.humanBody);
const counterfactual = replay(fixture.counterfactual.body);
const bots = Object.fromEntries(
  Object.entries(fixture.botBodies).map(([name, body]) => {
    const proposal = proposeTrpgAction({
      body,
      actorParticipantId: name === "강이현" ? 2 : 3,
      participantKind: "ai_character",
      partyNames: ["렌"],
      knownRooms: [{ id: "exit", name: "출입문" }],
      inventory: [],
      source: "bot_text",
    });
    return [name, { endingIntent: proposal.endingIntent, acts: proposal.acts }];
  })
);

const withActiveGoal = evaluateTrpgEndingDecision({
  plans: [human.plan],
  goals,
  humanParticipantIds: new Set([1]),
});
const withCompletedGoals = evaluateTrpgEndingDecision({
  plans: [human.plan],
  goals: completedGoals,
  humanParticipantIds: new Set([1]),
});
const counterfactualDecision = evaluateTrpgEndingDecision({
  plans: [counterfactual.plan],
  goals: completedGoals,
  humanParticipantIds: new Set([1]),
});

const report = {
  schema: "trpg-r1.c45-farewell-replay.result.v1",
  productionCall: false,
  productionDbWrite: false,
  humanBody: fixture.humanBody,
  humanEndingIntent: human.proposal.endingIntent,
  humanActs: human.proposal.acts.map((act) => ({
    kind: act.kind,
    commitment: act.commitment,
    evidence: act.evidence,
    planned: human.plan.acts.find((row) => row.index === act.index)?.status,
  })),
  botEndingIntents: Object.fromEntries(
    Object.entries(bots).map(([name, value]) => [name, value.endingIntent])
  ),
  serverEndingDecision: {
    withActiveGoal,
    withCompletedGoals,
  },
  counterfactual: {
    body: fixture.counterfactual.body,
    endingIntent: counterfactual.proposal.endingIntent,
    serverEndingDecision: counterfactualDecision,
  },
  expected: fixture.expected,
  matchesExpected: {
    endingIntent: human.proposal.endingIntent === fixture.expected.endingIntent,
    withActiveGoal: withActiveGoal.kind === fixture.expected.serverEndingDecision,
    withCompletedGoals: withCompletedGoals.kind === fixture.expected.serverEndingDecision,
    counterfactual:
      counterfactual.proposal.endingIntent === fixture.counterfactual.expectedEndingIntent,
  },
};

console.log(JSON.stringify(report, null, 2));
if (process.env.TRPG_R1_C45_OUT) {
  writeFileSync(process.env.TRPG_R1_C45_OUT, JSON.stringify(report, null, 2), "utf8");
}
if (Object.values(report.matchesExpected).some((value) => !value)) process.exit(1);
