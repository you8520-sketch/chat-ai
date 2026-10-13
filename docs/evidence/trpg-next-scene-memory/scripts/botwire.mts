import { readFileSync } from "node:fs";
import { buildTrpgBotRecentContinuity, buildTrpgBotMemoryBlock, type TrpgMemoryRound } from "/workspace/src/lib/trpg/memory";
import { buildBotCompactContinuity } from "/workspace/src/lib/trpg/memoryHorizon";
import { buildTrpgBotActionUserBlock } from "/workspace/src/lib/trpg/botActions";
const ev = "/tmp/ev/docs/evidence/trpg-1541-real-play/live";
const gm13 = readFileSync(ev + "/wire/call-13-gm-r4-user.txt", "utf8");
const open = (() => { const t = readFileSync(ev + "/raw/call-01-gm-open.txt", "utf8"); return JSON.parse(t.slice(0, t.indexOf("\n}") + 2)); })();
const block = gm13.slice(gm13.indexOf("[RECENT ROUNDS — RAW]\n") + 22, gm13.indexOf("[RESOLUTION ORDER]"));
const rounds: TrpgMemoryRound[] = [{ roundNumber: 0, actions: [], gmNarration: open.narration }];
for (const part of block.split(/\n\n(?=\[ROUND \d+\])/)) {
  const m = part.match(/^\[ROUND (\d+)\]\n([\s\S]*?)\n  GM: ([\s\S]*)$/);
  if (!m) continue;
  const actions = m[2].split("\n").map((l) => l.replace(/^  /, "")).filter(Boolean).map((l) => {
    const i = l.indexOf(": "); return { actorName: l.slice(0, i), text: l.slice(i + 2) };
  });
  rounds.push({ roundNumber: Number(m[1]), actions, gmNarration: m[3].trim() });
}
console.log("rounds", rounds.map((r) => [r.roundNumber, r.gmNarration.length]));
const prev = rounds[rounds.length - 1].gmNarration;
const cont = buildBotCompactContinuity(rounds, prev);
const recent = buildTrpgBotRecentContinuity(rounds);
const state = JSON.parse(readFileSync(ev + "/state/after-r3.json", "utf8"));
const user = buildTrpgBotActionUserBlock({
  characterName: "도윤", description: "d", greeting: "g", systemPrompt: "s",
  previousGmNarration: cont.previousScene, recentContinuity: recent, compactContinuity: cont.compact,
  campaignMemory: buildTrpgBotMemoryBlock({ ledger: state.ledger, sheets: state.sheets.map((s: any) => ({ name: s.name, hp: s.hp, maxHp: s.maxHp, conditions: [] })) }),
  humanActions: [{ playerName: "렌", text: "x" }],
});
const wire = readFileSync(ev + "/wire/call-11-bot-r4-user.txt", "utf8");
const pick = (t: string, a: string, b: string) => t.slice(t.indexOf(a), t.indexOf(b));
for (const [a, b, n] of [["[CAMPAIGN STATE", "[RECENT CONTINUITY", "campaign-state"], ["[RECENT CONTINUITY", "[PREVIOUS GM SCENE]", "recent-continuity"], ["[PREVIOUS GM SCENE]", "[HUMAN ACTIONS", "previous-scene"]] as const)
  console.log(n, pick(user, a, b) === pick(wire, a, b) ? "BYTE-IDENTICAL to saved wire" : "DIFF");
const scene = pick(user, "[PREVIOUS GM SCENE]", "[HUMAN ACTIONS");
console.log("scene chars", scene.length, "contains 장부:", /장부/.test(scene), "지시서:", /지시서/.test(scene));
console.log("---- previous scene ----"); console.log(scene);
for (const k of ["장부","지시서","오 노인","경비병","채광창","확보되었으나"]) console.log(k, scene.includes(k));
