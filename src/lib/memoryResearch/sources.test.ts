import assert from "node:assert/strict";
import { it } from "node:test";
import {
  arxivSource,
  classifyText,
  githubDiscoverySource,
  githubWatchlistSource,
  GITHUB_DISCOVERY_QUERIES,
  GITHUB_WATCHLIST,
  parseArxivAtom,
  type SourceContext,
  type SourceFetch,
  type SourceResponse,
} from "@/lib/memoryResearch/sources";

function response(status: number, body: unknown): SourceResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

function ctx(fetch: SourceFetch, limit = 40): SourceContext & { calls: string[]; sleeps: number[] } {
  const calls: string[] = [];
  const sleeps: number[] = [];
  return {
    fetch: async (url, init) => {
      calls.push(url);
      return fetch(url, init);
    },
    budget: { limit, used: 0 },
    now: new Date("2026-09-28T00:00:00Z"),
    githubToken: "gh-fixture",
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    calls,
    sleeps,
  };
}

const ATOM = `<?xml version="1.0"?><feed>
<entry><id>http://arxiv.org/abs/2609.01234v2</id><updated>2026-09-20T00:00:00Z</updated><published>2026-09-10T00:00:00Z</published>
<title>Temporal Supersession for Long-Term Conversational Memory</title>
<summary>We propose a time-aware memory that handles knowledge updates. It outperforms baselines on LongMemEval. Code is available at github.com/x/y.</summary></entry>
<entry><id>http://arxiv.org/abs/2609.05555v1</id><updated>2026-09-21T00:00:00Z</updated><published>2026-09-21T00:00:00Z</published>
<title>A Knowledge Graph &amp; Memory for Agents</title>
<summary>We store memories in a Neo4j graph database.</summary></entry>
</feed>`;

it("arXiv Atom parsing: stable key without version, version kept, keyword category/evidence/infra", () => {
  const [a, b] = parseArxivAtom(ATOM);
  assert.equal(a!.candidateKey, "arxiv:2609.01234");
  assert.equal(a!.version, "v2");
  assert.equal(a!.category, "temporal_memory", "abstract mentioning a benchmark is not a benchmark release");
  assert.equal(a!.evidence.hasReproducibleCode, true);
  assert.equal(a!.evidence.hasPublishedBenchmark, true);
  assert.match(a!.claimedAdvantage, /outperforms/);
  assert.equal(b!.title, "A Knowledge Graph & Memory for Agents");
  assert.equal(b!.category, "graph_memory");
  assert.deepEqual(b!.infraRequirements, ["graph_database"]);
  assert.equal(b!.evidence.hasReproducibleCode, false);
});

it("classification: memory_benchmark only from the title; title cues beat abstract cues", () => {
  assert.equal(classifyText("DolphinBench: Mapping the Pareto Frontier of Agent Memory", "retrieval"), "memory_benchmark");
  assert.equal(classifyText("CueMem: Cue-Guided Context Reconstruction", "evaluated on the LoCoMo benchmark with retrieval"), "rag_retrieval");
  assert.equal(classifyText("EdgeMem: Multi-Anchor Hypergraph", "retrieval"), "graph_memory");
  assert.equal(classifyText("RuleMem: Active Rule Memory", "we evaluate on LongMemEval"), "conversational_memory");
});

it("GitHub watchlist: repo + latest release; 404 release = unversioned; per-repo failures isolated", async () => {
  const c = ctx(async (url) => {
    if (url.endsWith("/repos/mem0ai/mem0")) return response(200, { html_url: "https://github.com/mem0ai/mem0", description: "memory", archived: false, pushed_at: "2026-09-25T00:00:00Z" });
    if (url.endsWith("/repos/mem0ai/mem0/releases/latest")) return response(200, { tag_name: "v1.2.3", published_at: "2026-09-24T00:00:00Z" });
    if (url.endsWith("/repos/getzep/graphiti")) return response(200, { archived: false, pushed_at: "2026-09-25T00:00:00Z" });
    if (url.endsWith("/repos/getzep/graphiti/releases/latest")) return response(404, {});
    if (url.endsWith("/repos/letta-ai/letta")) throw new Error("ECONNRESET");
    return response(500, {});
  });
  const out = await githubWatchlistSource(GITHUB_WATCHLIST.slice(0, 4)).collect(c);
  assert.deepEqual(out.observations.map((o) => [o.candidateKey, o.version]), [
    ["github:mem0ai/mem0", "v1.2.3"],
    ["github:getzep/graphiti", null],
  ]);
  assert.equal(out.errors.length, 2);
  assert.match(out.errors[0]!, /letta.*ECONNRESET/);
  assert.match(out.errors[1]!, /graphrag: repo HTTP 500/);
  assert.ok(c.calls.every((u) => u.startsWith("https://api.github.com/repos/")));
});

it("GitHub discovery finds new active repos, excludes curated/duplicate results, and keeps them inside normal research metadata", async () => {
  const c = ctx(async (url) => {
    if (url.includes("/search/repositories")) {
      if (url.includes(encodeURIComponent(GITHUB_DISCOVERY_QUERIES[0]!))) {
        return response(200, {
          incomplete_results: false,
          items: [
            {
              full_name: "NewOrg/MemoryEngine",
              html_url: "https://github.com/NewOrg/MemoryEngine",
              description: "Temporal long-term agent memory with benchmark results",
              archived: false,
              fork: false,
              pushed_at: "2026-09-27T00:00:00Z",
              stargazers_count: 900,
              topics: ["agent-memory", "temporal"],
              language: "TypeScript",
            },
            {
              full_name: "mem0ai/mem0",
              description: "curated duplicate",
              archived: false,
              fork: false,
              pushed_at: "2026-09-27T00:00:00Z",
              stargazers_count: 9999,
            },
          ],
        });
      }
      return response(200, {
        incomplete_results: false,
        items: [
          {
            full_name: "NewOrg/MemoryEngine",
            description: "same repo from another query",
            archived: false,
            fork: false,
            pushed_at: "2026-09-27T00:00:00Z",
            stargazers_count: 900,
          },
          {
            full_name: "FreshLab/RetrievalMemory",
            html_url: "https://github.com/FreshLab/RetrievalMemory",
            description: "RAG retrieval memory for long conversations",
            archived: false,
            fork: false,
            pushed_at: "2026-09-26T00:00:00Z",
            stargazers_count: 120,
            language: "Python",
          },
        ],
      });
    }
    if (url.endsWith("/repos/NewOrg/MemoryEngine/releases/latest")) {
      return response(200, { tag_name: "v2.0.0", published_at: "2026-09-25T00:00:00Z" });
    }
    if (url.endsWith("/repos/FreshLab/RetrievalMemory/releases/latest")) return response(404, {});
    throw new Error(`unexpected URL ${url}`);
  });

  const out = await githubDiscoverySource(GITHUB_DISCOVERY_QUERIES, 4).collect(c);
  assert.deepEqual(
    out.observations.map((o) => [o.candidateKey, o.version]),
    [
      ["github:neworg/memoryengine", "v2.0.0"],
      ["github:freshlab/retrievalmemory", null],
    ]
  );
  const temporal = out.observations[0]!;
  assert.equal(temporal.evidence.hasReproducibleCode, true);
  assert.equal(temporal.evidence.hasPublishedBenchmark, true);
  assert.deepEqual(temporal.privacyImplications, ["none"]);
  assert.deepEqual(temporal.riskFlags, []);
  assert.ok(c.calls.filter((url) => url.includes("/search/repositories")).length === 2);
  assert.ok(c.calls.every((url) => !url.includes("/repos/mem0ai/mem0/releases/latest")), "curated repo never consumes discovery release budget");
  assert.ok(c.calls.some((url) => url.includes("pushed%3A%3E%3D2025-09-28")), "discovery query is activity-bounded");
});

it("GitHub discovery is bounded by the shared HTTP budget and reports incomplete search without trusting partiality", async () => {
  const c = ctx(async (url) => {
    if (url.includes("/search/repositories")) {
      return response(200, {
        incomplete_results: true,
        items: [
          {
            full_name: "X/Y",
            description: "agent memory",
            archived: false,
            fork: false,
            pushed_at: "2026-09-27T00:00:00Z",
            stargazers_count: 100,
          },
        ],
      });
    }
    return response(404, {});
  }, 2);

  const out = await githubDiscoverySource(["agent memory", "long-term memory"], 4).collect(c);
  assert.equal(c.budget.used, 2);
  assert.equal(out.observations.length, 1);
  assert.match(out.errors.join(" "), /incomplete_results=true/);
  assert.match(out.errors.join(" "), /budget 2 exhausted/);
});

it("HTTP budget caps source calls; arXiv queries are spaced ≥3s apart", async () => {
  const c = ctx(async () => response(200, ATOM), 2);
  const out = await arxivSource(["q1", "q2", "q3"]).collect(c);
  assert.equal(c.calls.length, 2);
  assert.equal(c.budget.used, 2);
  assert.ok(c.sleeps.every((ms) => ms >= 3000));
  assert.match(out.errors.join(" "), /budget 2 exhausted/);
  assert.equal(out.observations.length, 2, "same papers across queries are deduped by key");
});
