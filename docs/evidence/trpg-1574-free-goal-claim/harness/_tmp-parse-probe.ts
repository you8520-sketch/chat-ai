import { parseGoalsJson, serializeGoals } from "../src/lib/trpg/campaignGoals";
const raw = JSON.stringify({
  version: 1,
  goals: [
    { id: "goal-0-1", title: "T", status: "completed", source: "gm", createdRound: 0, closedRound: 3,
      evidence: { kind: "host_confirmed", round: 2, confirmedRound: 3, participantId: 8 }, claimedRound: 2, claimedNarrationSha: "abc" },
    { id: "goal-0-2", title: "U", status: "active", source: "gm", createdRound: 0, claimedRound: 2, claimedNarrationSha: "def", declinedRound: 3 },
  ],
});
const parsed = parseGoalsJson(raw);
console.log("parsed by current parseGoal:", JSON.stringify(parsed));
console.log("rewritten by an old build's persist:", serializeGoals(parsed ?? []));
const v2 = JSON.stringify({ version: 2, goals: [] });
console.log("version 2 payload read by this build:", parseGoalsJson(v2));
