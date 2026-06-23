/**
 * NSFW platform-context dependency map — measurement only (no production changes).
 *
 * Maps 19+ platform references, NSFW capability declarations, and adult-verified
 * duplicates in the Phase 2B frozen prompt assembly path.
 *
 * Usage: npx.cmd tsx scripts/audit-nsfw-platform-dependency-map.ts
 */
import fs from "fs";
import path from "path";
import { loadEnvLocal } from "./load-env-local";
import { estimateTokens } from "../src/lib/tokenEstimate";

loadEnvLocal();
if (!process.env.NODE_ENV) (process.env as Record<string, string>).NODE_ENV = "development";

const MODEL = "deepseek/deepseek-v4-pro";
const USER_MSG =
  "밤이 깊었어. 무서워서 손 잡아줄래? …다 알아요, 내 몸이 원하는 거 알아? 천천히 해줘.";

/** Pattern groups for dependency / duplication detection */
const PATTERN_GROUPS = {
  platform_context_19: {
    label: "19+ platform / context header",
    patterns: [
      /=== 19\+ 컨텍스트 ===/,
      /=== 19\+ 플랫폼 컨텍스트 ===/,
      /19\+ Korean Web Novel/,
      /Explicit Sensory Mode/,
      /성인 소설 플랫폼/,
      /한국 성인 소설 플랫폼/,
      /\[19\+ NSFW\]/,
      /19\+ intimacy \(when NSFW\)/,
      /=== Literary tension \(19\+/,
      /19\+ 장면:/,
    ],
  },
  adult_verified_capability: {
    label: "Adult verified / explicit capability",
    patterns: [
      /Adult verified/i,
      /Explicit romance, intimacy/i,
      /anatomical description are REQUIRED/i,
      /성인 인증을 완료한 만 19세/,
      /성인 간 친밀한 신체 접촉/,
      /성적 표현을 서사 흐름/,
      /\[19\+ NSFW — see/,
      /§ intimacy/,
    ],
  },
  anti_censorship_meta: {
    label: "Anti-censorship / no meta refusal",
    patterns: [
      /No censorship disclaimers/i,
      /cannot write that/i,
      /검열·경고 문구 삽입 금지/,
      /검열하지 말/,
      /메타 발언\("알겠습니다"/,
      /adult mode confirm/i,
    ],
  },
  nsfw_scene_priority: {
    label: "NSFW scene dynamics / priority",
    patterns: [
      /\[INTIMATE\/NSFW SCENE DYNAMICS/,
      /High-intimacy or NSFW scenes/,
      /\[ADVANCED PROSE & NSFW GUIDELINES\]/,
      /\[SCENE VARIETY\]/,
      /직관·명확 \(Directness over Euphemism\)/,
      /Strict Anti-OOC in NSFW/,
    ],
  },
  style_reference_nsfw: {
    label: "STYLE_REFERENCE NSFW (legacy path)",
    patterns: [/<STYLE_REFERENCE>/, /노골적 지칭을/],
  },
} as const;

type Hit = {
  pattern: string;
  snippet: string;
};

type SectionHits = {
  id: string;
  label: string;
  category: string;
  tokens: number;
  chars: number;
  hits: Record<string, Hit[]>;
  hitCount: number;
};

function snippetAround(text: string, index: number, len = 80): string {
  const start = Math.max(0, index - 40);
  const end = Math.min(text.length, index + len);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

function scanText(text: string): Record<string, Hit[]> {
  const hits: Record<string, Hit[]> = {};
  for (const [groupKey, group] of Object.entries(PATTERN_GROUPS)) {
    const groupHits: Hit[] = [];
    for (const re of group.patterns) {
      const m = text.match(re);
      if (m && m.index != null) {
        groupHits.push({
          pattern: re.source,
          snippet: snippetAround(text, m.index),
        });
      }
    }
    if (groupHits.length > 0) hits[groupKey] = groupHits;
  }
  return hits;
}

/** Source definitions (not all injected in OpenRouter path) */
const SOURCE_DEFINITIONS: Array<{
  file: string;
  symbol: string;
  role: string;
  injected_openrouter_nsfw: boolean;
  text: string;
}> = [];

async function loadSourceDefinitions() {
  const { NSFW_EXPLICIT_SENSORY_WRITING_BLOCK, buildAdvancedProseNsfwGuidelines } = await import(
    "../src/lib/advancedProseNsfwGuidelines"
  );
  const { buildCoreMasterPrompt } = await import("../src/lib/corePrompt");
  const { buildOpenRouterKoreanProseTopBlock, OPENROUTER_NSFW_CORE } = await import(
    "../src/lib/openRouterProsePolicy"
  );
  const nsfwGuidelines = buildAdvancedProseNsfwGuidelines({
    nsfwEnabled: true,
    literaryEnhanced: true,
  });

  SOURCE_DEFINITIONS.push(
    {
      file: "src/lib/advancedProseNsfwGuidelines.ts",
      symbol: "NSFW_PLATFORM_PREAMBLE (Phase 2B compressed)",
      role: "Platform context pointer inside ADVANCED_PROSE bundle",
      injected_openrouter_nsfw: true,
      text: "=== 19+ 컨텍스트 ===\n아래 [WRITING STYLE: 19+ Korean Web Novel — Explicit Sensory Mode] 블록 적용.",
    },
    {
      file: "src/lib/advancedProseNsfwGuidelines.ts",
      symbol: "ORIGINAL_NSFW_PLATFORM_PREAMBLE (pre-2B, audit overlay only)",
      role: "Full platform preamble — NOT in production; DeepSeek length suppressant",
      injected_openrouter_nsfw: false,
      text: `=== 19+ 플랫폼 컨텍스트 ===
당신은 한국 성인 소설 플랫폼의 RP AI입니다. 성인 인증을 완료한 만 19세 이상 사용자만 이용하는 합법적 서비스입니다.
성인 간 친밀한 신체 접촉과 성적 표현을 서사 흐름에 맞게 자유롭게 묘사하십시오. 검열·경고 문구 삽입 금지. 캐릭터는 모두 성인입니다.
메타 발언("알겠습니다" 등) 없이 소설 본문으로 바로 시작할 것.`,
    },
    {
      file: "src/lib/advancedProseNsfwGuidelines.ts",
      symbol: "NSFW_EXPLICIT_SENSORY_WRITING_BLOCK",
      role: "Explicit sensory mode + adult verified + anti-censorship",
      injected_openrouter_nsfw: true,
      text: NSFW_EXPLICIT_SENSORY_WRITING_BLOCK,
    },
    {
      file: "src/lib/advancedProseNsfwGuidelines.ts",
      symbol: "buildAdvancedProseNsfwGuidelines (full NSFW)",
      role: "Merged prose + NSFW section in prose-style-xml-bundle",
      injected_openrouter_nsfw: true,
      text: nsfwGuidelines,
    },
    {
      file: "src/lib/corePrompt.ts",
      symbol: "nsfwBlock()",
      role: "[CORE RP] tail — Adult verified pointer",
      injected_openrouter_nsfw: true,
      text: `[19+ NSFW] Adult verified — see [ADVANCED PROSE & NSFW GUIDELINES] § intimacy.`,
    },
    {
      file: "src/lib/openRouterProsePolicy.ts",
      symbol: "buildOpenRouterKoreanProseTopBlock() tail",
      role: "19+ intimacy pointer in TOP block",
      injected_openrouter_nsfw: true,
      text: buildOpenRouterKoreanProseTopBlock(),
    },
    {
      file: "src/lib/openRouterProsePolicy.ts",
      symbol: "OPENROUTER_NSFW_CORE (deprecated)",
      role: "Legacy alias — NOT injected in contextBuilder",
      injected_openrouter_nsfw: false,
      text: OPENROUTER_NSFW_CORE,
    },
    {
      file: "src/lib/corePrompt.ts",
      symbol: "buildCoreMasterPrompt (nsfw, cache)",
      role: "Includes nsfwBlock + NO META adult mode ban",
      injected_openrouter_nsfw: true,
      text: buildCoreMasterPrompt({
        charName: "A",
        userName: "B",
        charGender: "male",
        userGender: "other",
        nsfwEnabled: true,
        impersonationOn: false,
        completedTurns: 99,
        hasMindReading: false,
        allowsBeard: true,
        allowsBodyHair: true,
      }),
    }
  );
}

async function fixture(t: number) {
  const { parseCharacterSetting } = await import("../src/utils/characterParser");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { formatMemoryMetaForPrompt, parseMemoryMeta } = await import("../src/lib/chatMemory");
  const charName = "백하율";
  const persona = "렌";
  const chunks = parseCharacterSetting({
    characterId: "mock-1",
    characterName: charName,
    gender: "male",
    systemPrompt: `# 성격\n차분하고 관찰력이 뛰어나며.`,
    world: `# 세계관\n현대.`,
    exampleDialog: `유저: hi\n${charName}: …`,
    statusWindowPrompt: "",
  });
  return {
    charName,
    personaDisplayName: persona,
    chunks,
    userPersona: formatSelectedPersonaForPrompt(persona, "other", "20대."),
    userNotePrompt: formatUserNoteForPrompt(""),
    longTermMemory: "",
    memoryMeta: formatMemoryMetaForPrompt(
      parseMemoryMeta(JSON.stringify({ affection: 40, trust: 35 }))
    ),
    shortTermHistory: [] as { role: "user" | "assistant"; content: string }[],
    currentUserMessage: USER_MSG,
    nsfw: true,
    gender: "male" as const,
    userPersonaGender: "other" as const,
    userImpersonation: false,
    novelModeEnabled: false,
    targetResponseChars: 2500,
    completedTurns: t,
    genres: ["공포/추리"] as import("../src/lib/characterGenres").CharacterGenre[],
  };
}

function buildReport(
  systemPrompt: string,
  sectionHits: SectionHits[],
  totalTokens: number
): string {
  const lines: string[] = [
    "# NSFW Platform Context — Dependency Map (Phase 2B frozen)",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Fixture: OpenRouter NSFW mock (백하율/렌, t=8, ${MODEL})`,
    `Assembled system: ~${totalTokens.toLocaleString()} tokens`,
    "",
    "**Scope:** Measurement/mapping only. Production prompts unchanged.",
    "",
    "## Executive summary",
    "",
    "1. **19+ platform context** lives primarily in `prose-style-xml-bundle` (compressed preamble pointer + Explicit Sensory block header). `rule-core-master` and `openrouter-korean-prose-top` add **pointer-only** references.",
    "2. **Adult verified / explicit allowed** is stated in full in `NSFW_EXPLICIT_SENSORY_WRITING_BLOCK`; `[19+ NSFW] Adult verified` in core master is a **duplicate pointer**.",
    "3. **Anti-censorship** (`No censorship…`, `cannot write that`) appears once in production explicit block; the **removed** full platform preamble duplicated 검열·메타 rules (DeepSeek suppressant).",
    "4. `STYLE_REFERENCE` NSFW few-shot and `OPENROUTER_NSFW_CORE` are **defined but not injected** on the OpenRouter path.",
    "",
    "---",
    "",
    "## 1. References to 19+ platform context (assembled prompt)",
    "",
    "| trackedSection | ~tok | hits | groups |",
    "|----------------|------|------|--------|",
  ];

  for (const s of sectionHits.filter((x) => x.hits.platform_context_19)) {
    lines.push(
      `| \`${s.id}\` | ${s.tokens} | ${s.hits.platform_context_19?.length ?? 0} | ${Object.keys(s.hits).join(", ")} |`
    );
  }

  lines.push("");
  lines.push("### Detail by section");
  lines.push("");

  for (const s of sectionHits) {
    if (!s.hits.platform_context_19) continue;
    lines.push(`#### \`${s.id}\` — ${s.label}`);
    for (const h of s.hits.platform_context_19) {
      lines.push(`- (${h.pattern.slice(0, 60)}…) -> ${h.snippet}`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("## 2. Duplicated NSFW capability declarations");
  lines.push("");
  lines.push("| Declaration | Sections in assembled prompt | Unique instruction? |");
  lines.push("|-------------|------------------------------|-------------------|");

  const capabilitySnippets: Array<{ key: string; sections: string[]; unique: string }> = [
    {
      key: "`Adult verified` + explicit REQUIRED",
      sections: sectionHits
        .filter((s) => s.hits.adult_verified_capability?.some((h) => /Adult verified|REQUIRED/i.test(h.pattern)))
        .map((s) => s.id),
      unique: "Full capability grant — only in explicit sensory block",
    },
    {
      key: "`[19+ NSFW] Adult verified` pointer",
      sections: sectionHits
        .filter((s) => s.hits.adult_verified_capability?.some((h) => /19\+ NSFW|§ intimacy/i.test(h.pattern)))
        .map((s) => s.id),
      unique: "Pointer only — duplicates explicit block",
    },
    {
      key: "`19+ intimacy (when NSFW)` pointer",
      sections: sectionHits
        .filter((s) => s.hits.platform_context_19?.some((h) => /19\+ intimacy/i.test(h.pattern)))
        .map((s) => s.id),
      unique: "Pointer to ADVANCED PROSE bundle",
    },
    {
      key: "`Explicit Sensory Mode` title",
      sections: sectionHits
        .filter((s) =>
          [...(s.hits.platform_context_19 ?? []), ...(s.hits.adult_verified_capability ?? [])].some(
            (h) => /Explicit Sensory/i.test(h.pattern)
          )
        )
        .map((s) => s.id),
      unique: "Named in preamble pointer + block header (same mode name)",
    },
    {
      key: "Korean platform legal framing (성인 소설 플랫폼 / 만 19세)",
      sections: ["ORIGINAL preamble only — not in Phase 2B production"],
      unique: "Removed in 2B; restoring suppresses DeepSeek length",
    },
  ];

  for (const row of capabilitySnippets) {
    lines.push(`| ${row.key} | ${row.sections.join(", ") || "—"} | ${row.unique} |`);
  }

  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 3. Duplicated adult verified / uncensored / explicit-allowed statements");
  lines.push("");
  lines.push("| Statement cluster | Occurrences in assembled prompt | Compressible? |");
  lines.push("|-------------------|-----------------------------------|-----------------|");

  const antiCensorSections = sectionHits.filter((s) => s.hits.anti_censorship_meta);
  const adultSections = sectionHits.filter((s) => s.hits.adult_verified_capability);

  lines.push(
    `| Anti-censorship / no refusal meta | ${antiCensorSections.map((s) => s.id).join(", ")} | **Keep** in explicit block — unique production text |`
  );
  lines.push(
    `| Adult verified / explicit required | ${adultSections.map((s) => s.id).join(", ")} | **Pointer trim OK** for core master + prose-top; keep one full statement in explicit block |`
  );
  lines.push(
    "| `[NO META]` adult mode confirm ban | rule-core-master | **Keep** — bans output checklist, not capability grant |"
  );
  lines.push(
    "| 검열·경고 (platform preamble) | pre-2B overlay only | **Safety + length** — do not delete without DeepSeek re-test |"
  );

  lines.push("");
  lines.push("### Per-section hit matrix");
  lines.push("");
  lines.push("| section | tok | platform | adult/explicit | anti-censor | nsfw dynamics | style_ref |");
  lines.push("|---------|-----|----------|----------------|-------------|---------------|-----------|");

  for (const s of sectionHits.sort((a, b) => b.hitCount - a.hitCount)) {
    const g = (k: string) => (s.hits[k]?.length ? s.hits[k].length : "—");
    lines.push(
      `| \`${s.id}\` | ${s.tokens} | ${g("platform_context_19")} | ${g("adult_verified_capability")} | ${g("anti_censorship_meta")} | ${g("nsfw_scene_priority")} | ${g("style_reference_nsfw")} |`
    );
  }

  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 4. Source definition registry (injection status)");
  lines.push("");
  lines.push("| symbol | file | injected OR NSFW? | ~tok | pattern hits |");
  lines.push("|--------|------|-----------------|------|--------------|");

  for (const def of SOURCE_DEFINITIONS) {
    const hits = scanText(def.text);
    const hitCount = Object.values(hits).reduce((n, arr) => n + arr.length, 0);
    lines.push(
      `| ${def.symbol} | ${def.file} | ${def.injected_openrouter_nsfw ? "yes" : "no"} | ${estimateTokens(def.text)} | ${hitCount} |`
    );
  }

  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 5. Dependency graph (assembled OpenRouter NSFW path)");
  lines.push("");
  lines.push("```mermaid");
  lines.push("flowchart TD");
  lines.push("  subgraph TOP[\"cacheRules\"]");
  lines.push("    OR_TOP[\"openrouter-korean-prose-top<br/>19+ intimacy pointer\"]");
  lines.push("    LANG[\"openrouter-lang-critical\"]");
  lines.push("  end");
  lines.push("  subgraph CORE[\"cacheRules\"]");
  lines.push("    CM[\"rule-core-master<br/>[19+ NSFW] Adult verified pointer\"]");
  lines.push("    NO_META[\"[NO META] bans adult mode checklist\"]");
  lines.push("  end");
  lines.push("  subgraph PROSE[\"cacheCharacter — prose-style-xml-bundle\"]");
  lines.push("    PREAMBLE[\"=== 19+ 컨텍스트 === pointer\"]");
  lines.push("    EXPLICIT[\"Explicit Sensory Mode block<br/>Adult verified + anti-censor FULL\"]");
  lines.push("    LITERARY[\"Literary tension 19+\"]");
  lines.push("    SCENE[\"SCENE VARIETY\"]");
  lines.push("    DIALOGUE[\"DIALOGUE & NARRATION\"]");
  lines.push("  end");
  lines.push("  OR_TOP -->|points to| PROSE");
  lines.push("  CM -->|points to| PROSE");
  lines.push("  PREAMBLE -->|points to| EXPLICIT");
  lines.push("  subgraph LEGACY[\"not injected OR path\"]");
  lines.push("    STYLE_REF[\"STYLE_REFERENCE NSFW\"]");
  lines.push("    OR_CORE[\"OPENROUTER_NSFW_CORE\"]");
  lines.push("    OLD_PREAMBLE[\"full 플랫폼 컨텍스트 preamble\"]");
  lines.push("  end");
  lines.push("```");
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 6. Compression safety assessment (mapping only)");
  lines.push("");
  lines.push("| Candidate cut | Unique safety content | DeepSeek length risk | Recommendation |");
  lines.push("|-----------------|----------------------|----------------------|----------------|");
  lines.push(
    "| Restore full platform preamble | Legal framing, 검열·경고 금지, 메타 발언 금지, 성인만 | **High suppressant** (Phase 4) | Keep full text OR model-specific branch |"
  );
  lines.push(
    "| Trim `[19+ NSFW] Adult verified` in core master | Pointer only | Low (not primary driver) | Safe to keep compressed |"
  );
  lines.push(
    "| Trim `19+ intimacy` line in prose-top | Pointer only | Low | Safe to keep compressed |"
  );
  lines.push(
    "| Trim `=== 19+ 컨텍스트 ===` pointer | Redundant with explicit block header | **Unknown** — pointer may anchor model to explicit block | Do not remove without audit |"
  );
  lines.push(
    "| Trim explicit block `Adult verified…` lines | **Unique** full capability + anti-censor | High — sole full grant | **Do not compress** |"
  );
  lines.push(
    "| Remove Literary tension 19+ block | Genre craft, not capability | Low for length | Optional future trim (not capability dup) |"
  );

  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 7. Full section scan (all trackedSections with any NSFW-pattern hit)");
  lines.push("");

  for (const s of sectionHits.filter((x) => x.hitCount > 0)) {
    lines.push(`### \`${s.id}\` (${s.tokens} tok)`);
    lines.push(`Label: ${s.label}`);
    for (const [groupKey, groupHits] of Object.entries(s.hits)) {
      const label = PATTERN_GROUPS[groupKey as keyof typeof PATTERN_GROUPS]?.label ?? groupKey;
      lines.push(`- **${label}**: ${groupHits.length} match(es)`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

async function main() {
  await loadSourceDefinitions();

  const f = await fixture(8);
  const { buildContext } = await import("../src/services/contextBuilder");
  const built = buildContext({
    ...f,
    userNickname: f.personaDisplayName,
    assetTags: undefined,
    modelId: MODEL,
    provider: "openrouter",
  });

  const sections = built.meta.trackedSections ?? [];
  const sectionHits: SectionHits[] = sections.map((sec) => {
    const hits = scanText(sec.text);
    const hitCount = Object.values(hits).reduce((n, arr) => n + arr.length, 0);
    return {
      id: sec.id,
      label: sec.label,
      category: sec.category,
      tokens: sec.tokens ?? estimateTokens(sec.text),
      chars: sec.text.length,
      hits,
      hitCount,
    };
  });

  const totalTokens = estimateTokens(built.systemPrompt);
  const report = buildReport(built.systemPrompt, sectionHits, totalTokens);

  const outDir = path.join(process.cwd(), "output");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const reportPath = path.join(outDir, `nsfw-platform-dependency-map-${stamp}.md`);
  const jsonPath = path.join(outDir, `nsfw-platform-dependency-map-${stamp}.json`);

  fs.writeFileSync(reportPath, report, "utf8");
  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        generated: new Date().toISOString(),
        model: MODEL,
        totalTokens,
        sectionHits,
        sourceDefinitions: SOURCE_DEFINITIONS.map((d) => ({
          ...d,
          tokens: estimateTokens(d.text),
          hits: scanText(d.text),
          injected_openrouter_nsfw: d.injected_openrouter_nsfw,
        })),
      },
      null,
      2
    ),
    "utf8"
  );

  console.log("=== NSFW platform dependency map ===");
  console.log("System tokens:", totalTokens);
  console.log(
    "Sections with NSFW-pattern hits:",
    sectionHits.filter((s) => s.hitCount > 0).map((s) => `${s.id}(${s.hitCount})`).join(", ")
  );
  console.log("Report:", reportPath);
  console.log("JSON:", jsonPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
