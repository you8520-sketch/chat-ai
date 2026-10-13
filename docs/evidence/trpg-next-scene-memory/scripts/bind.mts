import { bindGmLocationToSubmittedMovement } from "/workspace/src/lib/trpg/campaignLedger";
const ev = "/tmp/ev/docs/evidence/trpg-1541-real-play";
import { readFileSync } from "node:fs";
const hum3 = JSON.parse(readFileSync(ev + "/inputs/human-actions-r3.json", "utf8"));
const hum4 = JSON.parse(readFileSync(ev + "/inputs/human-actions-r4.json", "utf8"));
const d3 = JSON.parse(readFileSync(ev + "/live/parsed/call-10-gm-r3-delta.json", "utf8"));
const d4 = JSON.parse(readFileSync(ev + "/live/parsed/call-13-gm-r4-delta.json", "utf8"));
const sheets = (loc: string[]) => loc.map((location, i) => ({ participantId: i + 1, location }));
function run(label: string, d: any, hum: any, cur: string, seatLoc: string[]) {
  const proposed = d.location;
  const subs = [
    { participantId: 1, body: hum["렌"], tier: "PARTIAL_SUCCESS", acceptedRoute: null },
    { participantId: 2, body: hum["현"], tier: null, acceptedRoute: null },
    { participantId: 3, body: "(AI)", tier: null, acceptedRoute: null },
    { participantId: 4, body: "(AI)", tier: null, acceptedRoute: null },
  ];
  const out = bindGmLocationToSubmittedMovement({
    opening: false, currentLocation: cur, proposedLocation: proposed,
    delta: { ...d.delta }, submissions: subs as any, sheetLocations: sheets(seatLoc),
  });
  console.log(label, JSON.stringify({
    proposed, boundLocation: out.location,
    seatLocs: (out.delta.players ?? []).map((p: any) => [p.participantId, p.location ?? "(dropped)"]),
    hookStored: out.nextRoundContext ? "stored" : "CLEARED",
  }, null, 0));
}
run("R3", d3, hum3, "마레노 부두", ["마레노 부두","마레노 부두","마레노 부두","마레노 부두"]);
run("R4", d4, hum4, "마레노 부두", ["마레노 부두","마레노 부두","마레노 부두","마레노 부두"]);
