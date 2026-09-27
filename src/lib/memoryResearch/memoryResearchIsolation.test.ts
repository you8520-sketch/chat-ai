/**
 * Isolation contract: the research lab is never reachable from production
 * runtime and registers no in-process scheduler.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { it } from "node:test";
import { EXPERIMENT_ADAPTERS } from "@/lib/memoryResearch/experiments";
import { BENCHMARK_HOOKED_OWNERS } from "@/lib/memoryResearch/ownerMap";
import { SCHEDULER_DEFINITIONS } from "@/lib/schedulerDefinitions";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".next")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) out.push(path);
  }
  return out;
}

it("no production module imports src/lib/memoryResearch", () => {
  const offenders = [...walk("src"), "server.js"]
    .filter((p) => !p.startsWith(join("src", "lib", "memoryResearch")))
    .filter((p) => /["']@\/lib\/memoryResearch\/|["'][./]+(lib\/)?memoryResearch\//.test(readFileSync(p, "utf8")));
  assert.deepEqual(offenders, []);
});

it("only the workflow CLI consumes the lab outside its own directory", () => {
  const consumers = walk("scripts").filter((p) => readFileSync(p, "utf8").includes("@/lib/memoryResearch/"));
  assert.deepEqual(consumers, [join("scripts", "memory-research-cycle.ts")]);
});

it("research cadence is not an in-process production scheduler job", () => {
  assert.deepEqual(Object.keys(SCHEDULER_DEFINITIONS).sort(), ["finance_daily", "payout_monthly", "training_daily", "training_weekly"]);
  assert.doesNotMatch(readFileSync("server.js", "utf8"), /memoryResearch|memory-research/);
});

it("registered experiment adapters target a benchmark-hooked owner, one adapter per candidate", () => {
  const keys = EXPERIMENT_ADAPTERS.map((a) => a.candidateKey);
  assert.equal(new Set(keys).size, keys.length);
  for (const adapter of EXPERIMENT_ADAPTERS) {
    assert.ok(BENCHMARK_HOOKED_OWNERS.includes(adapter.targetOwner), adapter.candidateKey);
  }
});
