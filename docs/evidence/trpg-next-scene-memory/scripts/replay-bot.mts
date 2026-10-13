/** Throwaway: one paid Gemini bot replay of the saved #1541 R4 AI-companion final input with only [PREVIOUS GM SCENE] replaced by current code output. */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { callTrpgBot } from "@/lib/trpg/gmCall";
import { buildTrpgBotRecentContinuity, type TrpgMemoryRound } from "@/lib/trpg/memory";
import { buildBotCompactContinuity } from "@/lib/trpg/memoryHorizon";
import { buildTrpgBotActionUserBlock } from "@/lib/trpg/botActions";

const [who, variant] = process.argv.slice(2) as ["seoha" | "doyun", "before" | "after"];
const EV = "/tmp/ev/docs/evidence/trpg-1541-real-play/live";
const SRC = who === "doyun" ? "call-11-bot-r4" : "call-12-bot-r4";
const OUT = "/tmp/g1541n/out";
const LEDGER = "/tmp/g1541n/spend.json";
const MAX_POSTS = 2;
const KRW_PER_USD = 1450;
const PRICE = { input: 0.4875, cacheRead: 0.04875, output: 2.4375 };
mkdirSync(OUT, { recursive: true });
if (variant !== "after") throw new Error("only the treatment is paid; the baseline is the saved original output");
if (!process.env.DATA_DIR?.startsWith("/tmp/g1541n/")) throw new Error("REFUSED: DATA_DIR not isolated");
const key = process.env.CHEAPER_INFERENCE_BENCHMARK_API_KEY?.trim();
if (!key) throw new Error("NOT_RUN: key missing");
process.env.CHEAPER_INFERENCE_API_KEY = key;
delete process.env.OPENROUTER_API_KEY;
delete process.env.OPENAI_API_KEY;
const ledger = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, "utf8")) : { posts: 0, krw: 0, calls: [] };
if (ledger.posts >= MAX_POSTS) throw new Error("REFUSED: post cap reached");

const saved = JSON.parse(readFileSync(`${EV}/../live/wire/${SRC}-provider-request.json`, "utf8"));
const system = saved.messages[0].content as string;
const savedUser = saved.messages[1].content as string;

const gm13 = readFileSync(`${EV}/wire/call-13-gm-r4-user.txt`, "utf8");
const open = (() => { const t = readFileSync(`${EV}/raw/call-01-gm-open.txt`, "utf8"); return JSON.parse(t.slice(0, t.indexOf("\n}") + 2)); })();
const block = gm13.slice(gm13.indexOf("[RECENT ROUNDS — RAW]\n") + 22, gm13.indexOf("[RESOLUTION ORDER]"));
const rounds: TrpgMemoryRound[] = [{ roundNumber: 0, actions: [], gmNarration: open.narration }];
for (const part of block.split(/\n\n(?=\[ROUND \d+\])/)) {
  const m = part.match(/^\[ROUND (\d+)\]\n([\s\S]*?)\n  GM: ([\s\S]*)$/);
  if (!m) continue;
  const actions = m[2].split("\n").map((l) => l.replace(/^  /, "")).filter(Boolean).map((l) => { const i = l.indexOf(": "); return { actorName: l.slice(0, i), text: l.slice(i + 2) }; });
  rounds.push({ roundNumber: Number(m[1]), actions, gmNarration: m[3].trim() });
}
const prev = rounds[rounds.length - 1].gmNarration;
const cont = buildBotCompactContinuity(rounds, prev);
const recent = buildTrpgBotRecentContinuity(rounds);
const probe = buildTrpgBotActionUserBlock({ characterName: "x", description: "", greeting: "", systemPrompt: "", previousGmNarration: cont.previousScene, recentContinuity: recent, compactContinuity: cont.compact, campaignMemory: "", humanActions: [{ playerName: "a", text: "b" }] });
const newScene = probe.slice(probe.indexOf("[PREVIOUS GM SCENE]"), probe.indexOf("[HUMAN ACTIONS"));
const a = savedUser.indexOf("[PREVIOUS GM SCENE]");
const b = savedUser.indexOf("[HUMAN ACTIONS");
const user = savedUser.slice(0, a) + newScene + savedUser.slice(b);
if (user.replace(newScene, "") !== savedUser.replace(savedUser.slice(a, b), "")) throw new Error("only the scene section may differ");
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const worstKrw = ((system.length + user.length) * PRICE.input + 4096 * PRICE.output) / 1e6 * KRW_PER_USD;
if (ledger.krw + worstKrw > 100) throw new Error("REFUSED: cost gate");

let allowance = 1;
let lastBody = "";
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
  if (allowance <= 0 || !/^https:\/\/[^/]*cheaperinference/i.test(url) || (init?.method ?? "GET").toUpperCase() !== "POST") throw new Error(`[replay] fetch blocked: ${url}`);
  allowance -= 1; ledger.posts += 1; writeFileSync(LEDGER, JSON.stringify(ledger, null, 2));
  lastBody = init!.body as string;
  return realFetch(input as never, init);
}) as typeof fetch;

const label = `${who}-r4-${variant}`;
writeFileSync(`${OUT}/${label}-user.txt`, user);
writeFileSync(`${OUT}/${label}-system.txt`, system);
const started = Date.now();
let rec: Record<string, unknown> = { label, source: SRC, variant, systemSha256: sha(system), userSha256: sha(user), savedUserSha256: sha(savedUser), systemChars: system.length, userChars: user.length, worstCaseKrw: Number(worstKrw.toFixed(2)) };
try {
  const res = await callTrpgBot({ system, user });
  allowance = 0;
  const u = res.usage;
  const cacheRead = u?.cacheReadTokens ?? 0;
  const usd = u ? (Math.max(0, u.inputTokens - cacheRead) * PRICE.input + cacheRead * PRICE.cacheRead + u.outputTokens * PRICE.output) / 1e6 : 0;
  ledger.krw += usd * KRW_PER_USD;
  rec = { ...rec, usage: u ?? null, cost: { usd, krw: usd * KRW_PER_USD }, finishReason: res.finishReason ?? null, responseChars: res.text.length };
  writeFileSync(`${OUT}/${label}-provider-request.json`, lastBody);
  writeFileSync(`${OUT}/${label}-raw.txt`, res.text);
} catch (e) { allowance = 0; rec.error = (e as Error).message; throw e; }
finally {
  rec.elapsedMs = Date.now() - started; ledger.calls.push(rec);
  writeFileSync(LEDGER, JSON.stringify(ledger, null, 2)); writeFileSync(`${OUT}/${label}-call.json`, JSON.stringify(rec, null, 2));
  console.log(JSON.stringify(rec, null, 2));
}
