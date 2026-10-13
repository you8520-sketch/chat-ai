/** One paid Gemini GM replay of a saved #1541 final input (throwaway; not part of the product tree).
 *  usage: DATA_DIR=/tmp/g1541h/data tsx replay.ts <r3|r4> <before|after> <tag> */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { TRPG_GM_SYSTEM, parseTrpgGmOutput } from "@/lib/trpg/gmPrompt";
import { callTrpgGm } from "@/lib/trpg/gmCall";

const [round, variant, tag] = process.argv.slice(2) as [string, string, string];
const EV = "/tmp/ev/docs/evidence/trpg-1541-real-play/live/wire";
const SRC = round === "r3" ? "call-10-gm-r3" : "call-13-gm-r4";
const OUT = "<out>";
const LEDGER = "/tmp/g1541h/spend.json";
const MAX_POSTS = 4;
const KRW_PER_USD = 1450;
const PRICE = { input: 0.4875, cacheRead: 0.04875, output: 2.4375 };
mkdirSync(OUT, { recursive: true });
if (!process.env.DATA_DIR?.startsWith("/tmp/g1541h/")) throw new Error("REFUSED: DATA_DIR not isolated");
const key = process.env.CHEAPER_INFERENCE_BENCHMARK_API_KEY?.trim();
if (!key) throw new Error("NOT_RUN: key missing");
process.env.CHEAPER_INFERENCE_API_KEY = key;
delete process.env.OPENROUTER_API_KEY;
delete process.env.OPENAI_API_KEY;

const ledger = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, "utf8")) : { posts: 0, krw: 0, calls: [] };
if (ledger.posts >= MAX_POSTS) throw new Error("REFUSED: post cap reached");

const saved = JSON.parse(readFileSync(`${EV}/${SRC}-provider-request.json`, "utf8"));
const savedSystem = saved.messages[0].content as string;
const user = saved.messages[1].content as string;
const system = variant === "before" ? savedSystem : TRPG_GM_SYSTEM;
if (variant === "before" && savedSystem !== readFileSync(`${EV}/${SRC}-system.txt`, "utf8")) throw new Error("system mismatch");
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const worstKrw = ((system.length + user.length) * PRICE.input + 16384 * PRICE.output) / 1e6 * KRW_PER_USD;
if (ledger.krw + worstKrw > 900) throw new Error(`REFUSED: cost gate ${ledger.krw} + ${worstKrw}`);

let allowance = 1;
let lastBody = "";
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
  if (allowance <= 0 || !/^https:\/\/[^/]*cheaperinference/i.test(url) || (init?.method ?? "GET").toUpperCase() !== "POST") {
    throw new Error(`[replay] fetch blocked: ${url}`);
  }
  allowance -= 1;
  ledger.posts += 1;
  writeFileSync(LEDGER, JSON.stringify(ledger, null, 2));
  const body = JSON.parse(init!.body as string);
  body.max_tokens = 16384;
  lastBody = JSON.stringify(body);
  return realFetch(input as never, { ...init, body: lastBody });
}) as typeof fetch;

const label = `${tag}-${round}-${variant}`;
writeFileSync(`${OUT}/${label}-system.txt`, system);
writeFileSync(`${OUT}/${label}-user.txt`, user);
const started = Date.now();
let rec: Record<string, unknown> = { label, source: SRC, variant, systemSha256: sha(system), userSha256: sha(user), systemChars: system.length, userChars: user.length, worstCaseKrw: Number(worstKrw.toFixed(1)) };
try {
  const res = await callTrpgGm({ system, user });
  allowance = 0;
  const u = res.usage;
  const cacheRead = u?.cacheReadTokens ?? 0;
  const usd = u ? (Math.max(0, u.inputTokens - cacheRead) * PRICE.input + cacheRead * PRICE.cacheRead + u.outputTokens * PRICE.output) / 1e6 : 0;
  ledger.krw += usd * KRW_PER_USD;
  rec = { ...rec, usage: u ?? null, cost: { usd, krw: usd * KRW_PER_USD, source: "catalog_price_x_usage" }, finishReason: res.finishReason ?? null, responseChars: res.text.length };
  writeFileSync(`${OUT}/${label}-provider-request.json`, lastBody);
  writeFileSync(`${OUT}/${label}-raw.txt`, res.text);
  const parsed = parseTrpgGmOutput(res.text);
  writeFileSync(`${OUT}/${label}-narration.txt`, parsed.narration);
  rec.narrationChars = parsed.narration.length;
} catch (e) {
  allowance = 0;
  rec.error = (e as Error).message;
  throw e;
} finally {
  rec.elapsedMs = Date.now() - started;
  ledger.calls.push(rec);
  writeFileSync(LEDGER, JSON.stringify(ledger, null, 2));
  writeFileSync(`${OUT}/${label}-call.json`, JSON.stringify(rec, null, 2));
  console.log(JSON.stringify(rec, null, 2));
}
