import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { runLabArm, runLabBaseline } from "@/lib/memoryResearch/benchmarkLab";
import { assertDraftOnlyCommand, openDraftPrs, packetPath } from "@/lib/memoryResearch/draftPr";
import { evaluateGates, type LabRunSummary } from "@/lib/memoryResearch/gates";
import { wideSyntheticAdapter } from "@/lib/memoryResearch/labFixtures.test";
import { buildDraftPrPacket, HEAD_PLACEHOLDER, missingPacketSections, type DraftPrPacket } from "@/lib/memoryResearch/prPacket";
import type { ResearchCandidate } from "@/lib/memoryResearch/types";

const MAIN_SHA = "0123456789abcdef0123456789abcdef01234567";
const HEAD_SHA = "fedcba9876543210fedcba9876543210fedcba98";

async function acceptedPacket(cycleKey = "weekly-2026-W40", version = "v1.0.0"): Promise<DraftPrPacket> {
  const adapter = wideSyntheticAdapter("github:fixture/wide");
  const b = await runLabBaseline();
  const c = await runLabArm({ ...adapter.buildMode(), strict: false });
  assert.ok(b.status === "RAN" && c.status === "RAN");
  const baseline = (b as { summary: LabRunSummary }).summary;
  const experiment = (c as { summary: LabRunSummary }).summary;
  const gate = evaluateGates({ baseline, candidate: experiment, declared: adapter.declaredEfficiency, architectureDelta: adapter.architectureDelta });
  const candidate: ResearchCandidate = {
    candidateKey: "github:fixture/wide",
    category: "embedding_model",
    sourceKind: "github_repository",
    sourceUrl: "https://github.com/fixture/wide",
    title: "fixture/wide",
    version,
    discoveredAt: "2026-09-28T01:17:00Z",
    lastSeenAt: "2026-09-28T01:17:00Z",
    summary: "",
    claimedAdvantage: "paraphrase recall",
    applicableOwners: ["semantic_retrieval"],
    expectedBenefit: "",
    expectedCost: "",
    infraRequirements: ["none"],
    privacyImplications: ["none"],
    migrationRequirement: "none",
    state: "ACCEPTED",
    lastDecision: "ACCEPTED_QUALITY_GAIN",
    lastDecisionReason: gate.reason,
    priorRejectionReason: null,
    reevaluationCondition: "",
    cooldownUntil: null,
    evaluations: [],
    draftPrUrl: null,
  };
  return buildDraftPrPacket({ candidate, adapter, gate, baseline, experiment, cycleKey, mainSha: MAIN_SHA });
}

function recorder(responses: Record<string, string> = {}) {
  const calls: Array<[string, string[]]> = [];
  const files: Record<string, string> = {};
  return {
    calls,
    files,
    run: (command: string, args: readonly string[]) => {
      calls.push([command, [...args]]);
      const key = `${command} ${args.slice(0, 2).join(" ")}`;
      if (key === "git rev-parse HEAD") return `${HEAD_SHA}\n`;
      return responses[key] ?? "";
    },
    write: (path: string, contents: string) => {
      files[path] = contents;
    },
  };
}

it("ACCEPTED packet → branch off exact main, commit packet, gh pr create --draft; never merge", async () => {
  const packet = await acceptedPacket();
  const r = recorder({ "gh pr create": "https://github.com/o/r/pull/42\n" });
  const [result] = openDraftPrs([packet], r.run, r.write, { tempDir: "/tmp/x" });
  assert.deepEqual(result, { candidateKey: packet.candidateKey, url: "https://github.com/o/r/pull/42", error: null });
  assert.deepEqual(r.calls[1], ["git", ["checkout", "--detach", MAIN_SHA]]);
  const create = r.calls.find(([c, a]) => c === "gh" && a[1] === "create")!;
  assert.ok(create[1].includes("--draft"));
  assert.equal(create[1][create[1].indexOf("--base") + 1], "main");
  for (const [command, args] of r.calls) {
    assert.ok(!args.includes("merge") && !args.includes("--auto") && !args.includes("ready"), `${command} ${args.join(" ")}`);
  }
  const committed = r.files[packetPath(packet)]!;
  assert.deepEqual(missingPacketSections(committed), []);
  const prBody = r.files[create[1][create[1].indexOf("--body-file") + 1]!]!;
  assert.match(prBody, new RegExp(`main: \`${MAIN_SHA}\``));
  assert.match(prBody, new RegExp(`head: \`${HEAD_SHA}\``));
  assert.ok(!prBody.includes(HEAD_PLACEHOLDER));
});

it("accepted Draft branch is evaluation-scoped so a prior pushed branch cannot block next-cycle retry", async () => {
  const first = await acceptedPacket("weekly-2026-W40");
  const retry = await acceptedPacket("weekly-2026-W41");
  assert.notEqual(first.branch, retry.branch);
  assert.match(first.branch, /v1-0-0-weekly-2026-w40$/);
  assert.match(retry.branch, /v1-0-0-weekly-2026-w41$/);
});

it("existing open Draft PR for the branch is reused; non-ACCEPTED or incomplete packets are refused", async () => {
  const packet = await acceptedPacket();
  const r = recorder({ "gh pr list": "https://github.com/o/r/pull/7\n" });
  assert.equal(openDraftPrs([packet], r.run, r.write, { tempDir: "/tmp/x" })[0]!.url, "https://github.com/o/r/pull/7");
  assert.equal(r.calls.length, 1);

  const refused = recorder();
  const results = openDraftPrs(
    [
      { ...packet, decision: "REJECTED_NO_QUALITY_GAIN" as never },
      { ...packet, body: packet.body.replace(/## Quality delta[\s\S]*?## False-memory/, "## False-memory") },
      { ...packet, mainSha: "main" },
    ],
    refused.run,
    refused.write,
    { tempDir: "/tmp/x" }
  );
  assert.match(results[0]!.error!, /not ACCEPTED/);
  assert.match(results[1]!.error!, /incomplete: Quality delta/);
  assert.match(results[2]!.error!, /exact main SHA/);
  assert.equal(refused.calls.length, 0, "no git/gh command runs for a refused packet");
  assert.throws(() => buildDraftPrPacket({} as never), /./);
});

it("command guard forbids merge / auto-merge / ready / non-draft create", () => {
  assert.throws(() => assertDraftOnlyCommand("gh", ["pr", "merge", "1", "--auto"]), /forbidden|only gh pr/);
  assert.throws(() => assertDraftOnlyCommand("gh", ["pr", "ready", "1"]), /forbidden|only gh pr/);
  assert.throws(() => assertDraftOnlyCommand("gh", ["pr", "create", "--title", "x"]), /--draft/);
  assert.throws(() => assertDraftOnlyCommand("curl", ["https://api.github.com"]), /unexpected command/);
  assertDraftOnlyCommand("gh", ["pr", "create", "--draft", "--title", "x"]);
});

it("workflow: scheduled research job is read-only; PR job gated on ACCEPTED count; no merge anywhere", () => {
  const yml = readFileSync(".github/workflows/memory-research-cycle.yml", "utf8");
  assert.doesNotMatch(yml, /gh pr merge|--auto\b|enable-auto-merge|auto_merge|pulls\/\d+\/merge/);
  assert.match(yml, /schedule:\n\s+# Weekly[^\n]*\n\s+- cron: "17 1 \* \* 1"/);
  assert.match(yml, /- cron: "43 2 1 \* \*"/);
  const research = yml.slice(yml.indexOf("  research:"), yml.indexOf("  draft_prs:"));
  assert.match(research, /permissions:\n\s+contents: read\n/);
  assert.doesNotMatch(research, /write/);
  const draft = yml.slice(yml.indexOf("  draft_prs:"), yml.indexOf("  persist:"));
  assert.match(draft, /accepted_count != '0'/);
  assert.match(draft, /pull-requests: write/);
  const persist = yml.slice(yml.indexOf("  persist:"));
  assert.doesNotMatch(persist, /pull-requests/);
  assert.match(persist, /refs\/heads\/memory-research-ledger/);
  assert.doesNotMatch(yml, /OPENROUTER_API_KEY: \$\{\{/, "no paid provider credential is wired into the cycle");
});
