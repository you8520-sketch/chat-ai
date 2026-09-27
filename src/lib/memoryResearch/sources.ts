/**
 * Research source adapters. Minimal, free, no-credential-expansion sources:
 * - GitHub REST for both a curated watchlist and a bounded repository-search
 *   discovery lane, so newly emerging memory projects can enter the same
 *   screening/benchmark lifecycle without becoming trusted automatically.
 *   Uses the workflow's read-only GITHUB_TOKEN.
 * - arXiv export API (Atom) for a few fixed memory queries, 3 s apart per
 *   arXiv API etiquette.
 * Both are rate-bounded by a shared per-cycle HTTP budget. No LLM/provider
 * calls: summaries come from source metadata, classification is keyword-based.
 */
import type {
  CandidateCategory,
  CandidateRiskFlag,
  InfraRequirement,
  MigrationRequirement,
  PrivacyImplication,
  ResearchObservation,
  ResearchSourceKind,
} from "@/lib/memoryResearch/types";

export type SourceResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
};

export type SourceFetch = (url: string, init: { headers: Record<string, string> }) => Promise<SourceResponse>;

export type HttpBudget = { limit: number; used: number };

export type SourceContext = {
  fetch: SourceFetch;
  budget: HttpBudget;
  now: Date;
  githubToken: string | null;
  sleep: (ms: number) => Promise<void>;
};

export type SourceCollection = {
  sourceId: string;
  observations: ResearchObservation[];
  errors: string[];
};

export type SourceAdapter = {
  id: string;
  kind: ResearchSourceKind;
  collect(ctx: SourceContext): Promise<SourceCollection>;
};

export class HttpBudgetExhaustedError extends Error {}

async function budgetedFetch(ctx: SourceContext, url: string, headers: Record<string, string>): Promise<SourceResponse> {
  if (ctx.budget.used >= ctx.budget.limit) {
    throw new HttpBudgetExhaustedError(`per-cycle HTTP budget ${ctx.budget.limit} exhausted`);
  }
  ctx.budget.used += 1;
  return ctx.fetch(url, { headers });
}

export type WatchlistEntry = {
  repo: string;
  category: CandidateCategory;
  claimedAdvantage: string;
  hasPublishedBenchmark: boolean;
  infraRequirements: readonly InfraRequirement[];
  privacyImplications: readonly PrivacyImplication[];
  migrationRequirement: MigrationRequirement;
  riskFlags: readonly CandidateRiskFlag[];
};

/**
 * Curated watchlist. Infra/privacy metadata describes WHOLESALE adoption of
 * the project; a TypeScript-native port of one technique is evaluated through
 * an experiment adapter instead.
 */
export const GITHUB_WATCHLIST: readonly WatchlistEntry[] = [
  {
    repo: "mem0ai/mem0",
    category: "agent_memory_framework",
    claimedAdvantage: "LLM-extracted add/update/delete memory ops with vector+graph recall (LoCoMo results)",
    hasPublishedBenchmark: true,
    infraRequirements: ["vector_database", "python_runtime", "extra_llm_calls_per_turn"],
    privacyImplications: ["none"],
    migrationRequirement: "additive",
    riskFlags: ["duplicates_canonical_owner"],
  },
  {
    repo: "getzep/graphiti",
    category: "temporal_memory",
    claimedAdvantage: "bi-temporal knowledge graph with edge invalidation for superseded facts",
    hasPublishedBenchmark: true,
    infraRequirements: ["graph_database", "python_runtime", "extra_llm_calls_per_turn"],
    privacyImplications: ["none"],
    migrationRequirement: "additive",
    riskFlags: [],
  },
  {
    repo: "letta-ai/letta",
    category: "agent_memory_framework",
    claimedAdvantage: "self-editing core/archival memory blocks managed by the agent",
    hasPublishedBenchmark: false,
    infraRequirements: ["python_runtime", "hosted_saas", "extra_llm_calls_per_turn"],
    privacyImplications: ["none"],
    migrationRequirement: "additive",
    riskFlags: ["duplicates_canonical_owner"],
  },
  {
    repo: "microsoft/graphrag",
    category: "graph_memory",
    claimedAdvantage: "community-summarized entity graph for global questions",
    hasPublishedBenchmark: true,
    infraRequirements: ["python_runtime", "extra_llm_calls_per_turn"],
    privacyImplications: ["none"],
    migrationRequirement: "additive",
    riskFlags: [],
  },
  {
    repo: "HKUDS/LightRAG",
    category: "rag_retrieval",
    claimedAdvantage: "dual-level (entity + theme) graph-augmented retrieval",
    hasPublishedBenchmark: true,
    infraRequirements: ["python_runtime", "graph_database"],
    privacyImplications: ["none"],
    migrationRequirement: "additive",
    riskFlags: [],
  },
  {
    repo: "topoteretes/cognee",
    category: "graph_memory",
    claimedAdvantage: "ECL pipeline building a queryable memory graph",
    hasPublishedBenchmark: false,
    infraRequirements: ["python_runtime", "graph_database", "vector_database"],
    privacyImplications: ["none"],
    migrationRequirement: "additive",
    riskFlags: [],
  },
  {
    repo: "langchain-ai/langmem",
    category: "agent_memory_framework",
    claimedAdvantage: "background memory manager with semantic/episodic/procedural types",
    hasPublishedBenchmark: false,
    infraRequirements: ["python_runtime", "extra_llm_calls_per_turn"],
    privacyImplications: ["none"],
    migrationRequirement: "additive",
    riskFlags: ["duplicates_canonical_owner"],
  },
  {
    repo: "agentscope-ai/ReMe",
    category: "agent_memory_framework",
    claimedAdvantage: "file-native durable memory with rebuildable BM25/embedding/wikilink indexes and scheduled consolidation",
    hasPublishedBenchmark: false,
    infraRequirements: ["python_runtime", "extra_llm_calls_per_turn"],
    privacyImplications: ["none"],
    migrationRequirement: "additive",
    riskFlags: [],
  },
  {
    repo: "vectorize-io/hindsight",
    category: "agent_memory_framework",
    claimedAdvantage: "retain/recall/reflect memory with long-term benchmark evidence and explicit learning-oriented consolidation",
    hasPublishedBenchmark: true,
    infraRequirements: ["python_runtime", "extra_llm_calls_per_turn"],
    privacyImplications: ["none"],
    migrationRequirement: "additive",
    riskFlags: [],
  },
  {
    repo: "snap-research/locomo",
    category: "memory_benchmark",
    claimedAdvantage: "very long-term conversational memory benchmark (QA, event summarization)",
    hasPublishedBenchmark: true,
    infraRequirements: ["none"],
    privacyImplications: ["none"],
    migrationRequirement: "none",
    riskFlags: [],
  },
  {
    repo: "xiaowu0162/LongMemEval",
    category: "memory_benchmark",
    claimedAdvantage: "long-term chat memory benchmark: temporal reasoning, knowledge updates, abstention",
    hasPublishedBenchmark: true,
    infraRequirements: ["none"],
    privacyImplications: ["none"],
    migrationRequirement: "none",
    riskFlags: [],
  },
  {
    repo: "xiaowu0162/LongMemEval-V2",
    category: "memory_benchmark",
    claimedAdvantage: "agentic long-term memory benchmark: dynamic state, workflow knowledge, environment gotchas, and premise awareness",
    hasPublishedBenchmark: true,
    infraRequirements: ["none"],
    privacyImplications: ["none"],
    migrationRequirement: "none",
    riskFlags: [],
  },
  {
    repo: "FlagOpen/FlagEmbedding",
    category: "embedding_model",
    claimedAdvantage: "BGE embedding/reranker family (bge-m3 is the approved semantic-lane model)",
    hasPublishedBenchmark: true,
    infraRequirements: ["none"],
    privacyImplications: ["none"],
    migrationRequirement: "none",
    riskFlags: [],
  },
  {
    repo: "QwenLM/Qwen3-Embedding",
    category: "embedding_model",
    claimedAdvantage: "multilingual embedding + reranker models (MTEB)",
    hasPublishedBenchmark: true,
    infraRequirements: ["none"],
    privacyImplications: ["none"],
    migrationRequirement: "none",
    riskFlags: [],
  },
];

type GithubRepo = {
  full_name?: string;
  html_url?: string;
  description?: string | null;
  archived?: boolean;
  fork?: boolean;
  pushed_at?: string | null;
  stargazers_count?: number;
  topics?: string[];
  language?: string | null;
};

type GithubSearchResponse = {
  incomplete_results?: boolean;
  items?: GithubRepo[];
};

type GithubRelease = { tag_name?: string; published_at?: string | null; html_url?: string };

function githubHeaders(ctx: SourceContext): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "memory-research-cycle",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (ctx.githubToken) headers.Authorization = `Bearer ${ctx.githubToken}`;
  return headers;
}

export function githubWatchlistSource(watchlist: readonly WatchlistEntry[] = GITHUB_WATCHLIST): SourceAdapter {
  return {
    id: "github_watchlist",
    kind: "github_repository",
    async collect(ctx) {
      const observations: ResearchObservation[] = [];
      const errors: string[] = [];
      for (const entry of watchlist) {
        try {
          const repoRes = await budgetedFetch(ctx, `https://api.github.com/repos/${entry.repo}`, githubHeaders(ctx));
          if (!repoRes.ok) {
            errors.push(`${entry.repo}: repo HTTP ${repoRes.status}`);
            continue;
          }
          const repo = (await repoRes.json()) as GithubRepo;
          const relRes = await budgetedFetch(
            ctx,
            `https://api.github.com/repos/${entry.repo}/releases/latest`,
            githubHeaders(ctx)
          );
          let release: GithubRelease | null = null;
          if (relRes.ok) release = (await relRes.json()) as GithubRelease;
          else if (relRes.status !== 404) errors.push(`${entry.repo}: release HTTP ${relRes.status}`);
          observations.push({
            candidateKey: `github:${entry.repo.toLowerCase()}`,
            sourceKind: "github_repository",
            sourceUrl: repo.html_url ?? `https://github.com/${entry.repo}`,
            title: entry.repo,
            version: release?.tag_name ?? null,
            publishedAt: release?.published_at ?? null,
            summary: (repo.description ?? "").slice(0, 400),
            claimedAdvantage: entry.claimedAdvantage,
            category: entry.category,
            evidence: {
              hasReproducibleCode: true,
              hasPublishedBenchmark: entry.hasPublishedBenchmark,
              archived: repo.archived === true,
              lastActivityAt: repo.pushed_at ?? null,
            },
            infraRequirements: entry.infraRequirements,
            privacyImplications: entry.privacyImplications,
            migrationRequirement: entry.migrationRequirement,
            riskFlags: entry.riskFlags,
          });
        } catch (error) {
          errors.push(`${entry.repo}: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300));
          if (error instanceof HttpBudgetExhaustedError) break;
        }
      }
      return { sourceId: "github_watchlist", observations, errors };
    },
  };
}


export const GITHUB_DISCOVERY_QUERIES: readonly string[] = [
  '"agent memory" in:name,description,readme stars:>=50 archived:false fork:false',
  '"long-term memory" retrieval in:name,description,readme stars:>=50 archived:false fork:false',
];

export const GITHUB_DISCOVERY_RESULTS_PER_QUERY = 4;
export const GITHUB_DISCOVERY_ACTIVITY_DAYS = 365;

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 86_400_000);
}

function discoveredGithubObservation(
  repo: GithubRepo,
  release: GithubRelease | null
): ResearchObservation | null {
  const fullName = repo.full_name?.trim();
  if (!fullName || repo.archived === true || repo.fork === true) return null;
  const stars = repo.stargazers_count ?? 0;
  if (stars < 50) return null;
  const summary = (repo.description ?? "").trim().slice(0, 400);
  const text = [fullName, summary, ...(repo.topics ?? []), repo.language ?? ""].join(" ");
  const category = classifyText(fullName, summary);
  return {
    candidateKey: `github:${fullName.toLowerCase()}`,
    sourceKind: "github_repository",
    sourceUrl: repo.html_url ?? `https://github.com/${fullName}`,
    title: fullName,
    version: release?.tag_name ?? null,
    publishedAt: release?.published_at ?? null,
    summary,
    claimedAdvantage: summary,
    category,
    evidence: {
      hasReproducibleCode: true,
      hasPublishedBenchmark: /benchmark|locomo|longmemeval|mteb/i.test(text),
      archived: false,
      lastActivityAt: repo.pushed_at ?? null,
    },
    infraRequirements: inferInfra(text),
    privacyImplications: ["none"],
    migrationRequirement: "none",
    riskFlags: [],
  };
}

/**
 * Bounded discovery lane for repositories not already in the curated watchlist.
 * Search results are merely research observations; they do not bypass any
 * screening, benchmark, live-evidence, implementation allowlist, or merge gate.
 */
export function githubDiscoverySource(
  queries: readonly string[] = GITHUB_DISCOVERY_QUERIES,
  maxPerQuery = GITHUB_DISCOVERY_RESULTS_PER_QUERY
): SourceAdapter {
  return {
    id: "github_discovery",
    kind: "github_repository",
    async collect(ctx) {
      const observations = new Map<string, ResearchObservation>();
      const errors: string[] = [];
      const curated = new Set(GITHUB_WATCHLIST.map((entry) => `github:${entry.repo.toLowerCase()}`));
      const pushedSince = isoDay(daysAgo(ctx.now, GITHUB_DISCOVERY_ACTIVITY_DAYS));

      for (let i = 0; i < queries.length; i++) {
        const q = `${queries[i]} pushed:>=${pushedSince}`;
        const url =
          `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}` +
          `&sort=updated&order=desc&per_page=${maxPerQuery}`;
        try {
          const res = await budgetedFetch(ctx, url, githubHeaders(ctx));
          if (!res.ok) {
            errors.push(`github discovery query ${i}: HTTP ${res.status}`);
            continue;
          }
          const payload = (await res.json()) as GithubSearchResponse;
          if (payload.incomplete_results) {
            errors.push(`github discovery query ${i}: incomplete_results=true`);
          }
          for (const repo of (payload.items ?? []).slice(0, maxPerQuery)) {
            const fullName = repo.full_name?.trim();
            if (!fullName) continue;
            const key = `github:${fullName.toLowerCase()}`;
            if (curated.has(key) || observations.has(key)) continue;

            let release: GithubRelease | null = null;
            try {
              const rel = await budgetedFetch(
                ctx,
                `https://api.github.com/repos/${fullName}/releases/latest`,
                githubHeaders(ctx)
              );
              if (rel.ok) release = (await rel.json()) as GithubRelease;
              else if (rel.status !== 404) errors.push(`${fullName}: discovery release HTTP ${rel.status}`);
            } catch (error) {
              if (error instanceof HttpBudgetExhaustedError) throw error;
              errors.push(
                `${fullName}: discovery release ${error instanceof Error ? error.message : String(error)}`.slice(0, 300)
              );
            }

            const observation = discoveredGithubObservation(repo, release);
            if (observation) observations.set(observation.candidateKey, observation);
          }
        } catch (error) {
          errors.push(
            `github discovery query ${i}: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300)
          );
          if (error instanceof HttpBudgetExhaustedError) break;
        }
      }
      return { sourceId: "github_discovery", observations: [...observations.values()], errors };
    },
  };
}

export const ARXIV_QUERIES: readonly string[] = [
  'all:"long-term memory" AND all:conversational',
  'all:"agent memory" AND (all:temporal OR all:graph)',
  'all:"memory" AND all:"dialogue" AND all:benchmark AND all:"long-term"',
];

const ARXIV_DELAY_MS = 3100;

/** Title-level cues win; `memory_benchmark` is only ever assigned from the title. */
const TITLE_KEYWORDS: ReadonlyArray<[CandidateCategory, RegExp]> = [
  ["memory_benchmark", /benchmark|bench\b|evaluation|dataset/i],
  ["temporal_memory", /temporal|time|chronolog|supersed/i],
  ["graph_memory", /graph/i],
  ["reranker_model", /re-?rank/i],
  ["embedding_model", /embedding/i],
  ["long_context", /long[- ]context|context window|kv cache/i],
  ["summary_method", /summari[sz]|consolidat/i],
  ["companion_roleplay_memory", /role-?play|companion|persona/i],
  ["rag_retrieval", /retrieval|\bRAG\b/i],
];

const ABSTRACT_KEYWORDS: ReadonlyArray<[CandidateCategory, RegExp]> = [
  ["temporal_memory", /temporal|time-aware|chronolog|supersed|knowledge update/i],
  ["graph_memory", /knowledge graph|graph memory|graph-based|hypergraph/i],
  ["reranker_model", /re-?rank/i],
  ["embedding_model", /embedding model|dense retriev/i],
  ["long_context", /long[- ]context|context window/i],
  ["summary_method", /summari[sz]/i],
  ["companion_roleplay_memory", /role-?play|companion|persona/i],
  ["rag_retrieval", /retrieval|\bRAG\b/i],
];

export function classifyText(title: string, summary: string): CandidateCategory {
  for (const [category, pattern] of TITLE_KEYWORDS) {
    if (pattern.test(title)) return category;
  }
  for (const [category, pattern] of ABSTRACT_KEYWORDS) {
    if (pattern.test(summary)) return category;
  }
  return "conversational_memory";
}

export function inferInfra(text: string): InfraRequirement[] {
  const infra: InfraRequirement[] = [];
  if (/neo4j|graph database/i.test(text)) infra.push("graph_database");
  if (/vector (database|store|db)/i.test(text)) infra.push("vector_database");
  if (/fine-?tun|reinforcement learning|\bRL\b|training the model/i.test(text)) infra.push("gpu_inference");
  return infra.length > 0 ? infra : ["none"];
}

function decodeXml(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? decodeXml(m[1]!) : null;
}

/** Parses arXiv Atom entries into observations (pure; exported for tests). */
export function parseArxivAtom(xml: string): ResearchObservation[] {
  const out: ResearchObservation[] = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const block = m[1]!;
    const idUrl = tag(block, "id");
    const idMatch = idUrl?.match(/arxiv\.org\/abs\/([^v\s]+?)(v\d+)?$/);
    if (!idUrl || !idMatch) continue;
    const title = tag(block, "title") ?? idMatch[1]!;
    const summary = tag(block, "summary") ?? "";
    const text = `${title} ${summary}`;
    out.push({
      candidateKey: `arxiv:${idMatch[1]}`,
      sourceKind: "arxiv",
      sourceUrl: `https://arxiv.org/abs/${idMatch[1]}`,
      title,
      version: idMatch[2] ?? "v1",
      publishedAt: tag(block, "published"),
      summary: summary.slice(0, 600),
      claimedAdvantage: (summary.match(/[^.]*(outperform|improv|state-of-the-art|surpass)[^.]*\./i)?.[0] ?? "").trim().slice(0, 300),
      category: classifyText(title, summary),
      evidence: {
        hasReproducibleCode: /github\.com|code (is|will be) (publicly )?available|open-?source/i.test(summary),
        hasPublishedBenchmark: /LoCoMo|LongMemEval|benchmark|MSC\b/i.test(summary),
        archived: false,
        lastActivityAt: tag(block, "updated"),
      },
      infraRequirements: inferInfra(text),
      privacyImplications: ["none"],
      migrationRequirement: "none",
      riskFlags: [],
    });
  }
  return out;
}

export function arxivSource(queries: readonly string[] = ARXIV_QUERIES, maxResults = 10): SourceAdapter {
  return {
    id: "arxiv_queries",
    kind: "arxiv",
    async collect(ctx) {
      const byKey = new Map<string, ResearchObservation>();
      const errors: string[] = [];
      for (let i = 0; i < queries.length; i++) {
        if (i > 0) await ctx.sleep(ARXIV_DELAY_MS);
        const url = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(queries[i]!)}&sortBy=submittedDate&sortOrder=descending&max_results=${maxResults}`;
        try {
          const res = await budgetedFetch(ctx, url, { "User-Agent": "memory-research-cycle" });
          if (!res.ok) {
            errors.push(`arxiv query ${i}: HTTP ${res.status}`);
            continue;
          }
          for (const obs of parseArxivAtom(await res.text())) byKey.set(obs.candidateKey, obs);
        } catch (error) {
          errors.push(`arxiv query ${i}: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300));
          if (error instanceof HttpBudgetExhaustedError) break;
        }
      }
      return { sourceId: "arxiv_queries", observations: [...byKey.values()], errors };
    },
  };
}

export function defaultSources(): SourceAdapter[] {
  return [githubWatchlistSource(), githubDiscoverySource(), arxivSource()];
}
