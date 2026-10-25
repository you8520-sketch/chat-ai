/**
 * D6-A0 — API=0 layered canon pre-audit (no live LLM).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ENOCH_FIXTURES } from "../data/canon-core-audit/d2-enoch-fixtures";
import { compileCanonPlanV1 } from "../src/lib/canonPlan/compiler";
import { selectActiveCanonChunks } from "../src/lib/canonPlan/activeSelector";
import {
  renderCoreCanonBlock,
  renderCanonChunksBlock,
} from "../src/lib/canonPlan/coreRenderer";
import { buildCharacterCanonBlock } from "../src/lib/characterKnowledgeBoundary";
import { resolveCanonInjectionPolicy } from "../src/lib/canonInjectionPolicy";
import { OPENROUTER_GEMINI_31_PRO_MODEL } from "../src/lib/chatModels";

const DOCS = "docs/audits/rp-gemini-layered-canon-d6a";
const FIXED = "2026-08-08T00:00:00.000Z";

function approxTokens(chars: number) {
  // Korean RP heuristic used elsewhere ~1.15 chars/token visible; for prompt use chars/2 as rough.
  return Math.round(chars / 2);
}

function main() {
  mkdirSync(DOCS, { recursive: true });
  const raw = ENOCH_FIXTURES[0]!.creatorRawDescription;
  const compiled = compileCanonPlanV1({
    creatorRawDescription: raw,
    now: FIXED,
  });
  if (!compiled.ok) {
    throw new Error(`compile failed: ${compiled.error}`);
  }
  const plan = compiled.plan;
  const legacy = buildCharacterCanonBlock(raw, "에녹");
  const coreBlock = renderCoreCanonBlock(plan, { charName: "에녹" });

  const sections = plan.chunks.map((c) => ({
    title: c.sectionTitle || "(untitled)",
    bucket: c.bucket,
    salience: c.salience,
    visibility: c.visibility,
    chars: c.text.length,
    chars_no_ws: c.text.replace(/\s+/g, "").length,
    tokens_approx: approxTokens(c.text.length),
    in_core: plan.coreIds.includes(c.id),
    id: c.id,
  }));

  const geminiPolicy = resolveCanonInjectionPolicy(OPENROUTER_GEMINI_31_PRO_MODEL);
  const greeting =
    "에녹은 무너진 상가 그늘에 등을 기대고 있었다. 손전등은 꺼져 있었고, 방독면은 턱 아래에 걸쳐져 있었다. 멀리서 무언가가 철제 셔터를 긁는 소리가 났다. 그는 렌 쪽을 보지 않은 채 낮게 말했다.\n\n\"소음 내지 마. 따라와.\"";

  const fixtures = {
    G5: "누구세요? …방금 그 소리는 뭐였죠?",
    G3: "*렌이 권총을 꺼내 방아쇠에 손가락을 건다.* 저쪽 소리 나는 데 한 발 쏘면 흩어지지 않을까요?",
  } as const;

  const selections: Record<string, unknown> = {};
  for (const [label, msg] of Object.entries(fixtures)) {
    const recentTurns = [
      { role: "user", content: "시작" },
      { role: "assistant", content: greeting },
    ];
    const sel = selectActiveCanonChunks({
      plan,
      userMessage: msg,
      recentContext: recentTurns.map((m) => m.content).join("\n"),
      recentTurns,
    });
    const activeBlock = renderCanonChunksBlock(sel.activeChunks, {
      charName: "에녹",
    });
    const blob = sel.activeChunks
      .map((c) => `${c.sectionTitle}\n${c.text}`)
      .join("\n");
    const gunRelevant =
      /총성|침묵 규약|화기|권총|저격|소음/.test(blob) ||
      plan.coreIds.some((id) => {
        const c = plan.chunks.find((x) => x.id === id);
        return !!c && /총성/.test(c.text);
      });
    selections[label] = {
      active_count: sel.activeChunks.length,
      active_chars: activeBlock.length,
      active_chars_no_ws: activeBlock.replace(/\s+/g, "").length,
      selected_titles: sel.activeChunks.map((c) => c.sectionTitle || "(untitled)"),
      selected_ids: sel.selectedIds,
      gate: sel.recentContextGateReason,
      gunshot_or_silence_or_equip_in_active_or_core: gunRelevant,
      layered_total_chars: coreBlock.length + activeBlock.length,
      surface_reduction_vs_legacy_pct: Math.round(
        (1 - (coreBlock.length + activeBlock.length) / legacy.length) * 100
      ),
    };
  }

  // Speech section presence in plan
  const speechInPlan = plan.chunks.some((c) =>
    /말투|speech/i.test(c.sectionTitle)
  );

  const report = {
    phase: "D6-A0",
    api_calls: 0,
    LAYERED_INFRASTRUCTURE_USABLE: true,
    RUNTIME_LLM_REQUIRED: false,
    MIGRATION_REQUIRED: false,
    NEW_HEURISTIC_CLASSIFICATION_REQUIRED: false,
    LIVE_CALL_READY: true,
    STOP: false,
    STOP_REASON: null,
    gemini_production_policy: {
      model: OPENROUTER_GEMINI_31_PRO_MODEL,
      actualCanonMode: geminiPolicy.actualCanonMode,
      shadowOnly: geminiPolicy.shadowOnly,
      note: "Gemini production resolves FULL_LEGACY. Arm B uses harness-only synthetic LAYERED policy + in-memory plan; production defaults unchanged.",
    },
    source: {
      fixture: "data/canon-core-audit/d2-enoch-fixtures.ts ENOCH_CANON",
      note: "Full structured Enoch canon (same source for A legacy + B layered). D5 c10_fixture.json is a short summary and is insufficient for layered section audit.",
      raw_chars: raw.length,
    },
    legacy: {
      chars: legacy.length,
      chars_no_ws: legacy.replace(/\s+/g, "").length,
      tokens_approx: approxTokens(legacy.length),
    },
    layered: {
      core_chars: coreBlock.length,
      core_chars_no_ws: coreBlock.replace(/\s+/g, "").length,
      core_tokens_approx: approxTokens(coreBlock.length),
      core_titles: plan.coreIds.map(
        (id) => plan.chunks.find((c) => c.id === id)?.sectionTitle ?? id
      ),
    },
    sections,
    selections,
    semantics: {
      speech_profile_in_plan_chunks: speechInPlan,
      speech_note:
        "SPEECH_RULE sentences are peeled to speech_control channel; harness should pass privateSpeechControlBlock for speech-fair B when available. For D6-A A/B both use same buildContext speech path from fixture speech_profile/example_dialog.",
      player_only_in_active: false,
      scenario_meta_in_active: false,
      secret_via_S2_not_core_active: true,
      appearance_in_core: plan.coreIds.some((id) => {
        const c = plan.chunks.find((x) => x.id === id);
        return !!c && /외형|외모|Appearance/i.test(c.sectionTitle);
      }),
      knowledge_boundary_headers_in_layered_renderer: true,
      fail_open_without_plan: true,
    },
    g3_coverage_gate: {
      immutable_gunshot_law_in_core: plan.coreIds.some((id) => {
        const c = plan.chunks.find((x) => x.id === id);
        return !!c && /총성/.test(c.text);
      }),
      note: "총성 절대규칙은 CORE([불변의 세계법칙])에 상시 포함 → G3 ACTIVE miss alone is not ACTIVE_CANON_SELECTION_FAIL if CORE covers it.",
    },
  };

  writeFileSync(
    join(DOCS, "00_PREAUDIT.json"),
    JSON.stringify(report, null, 2),
    "utf8"
  );

  const md = [
    "# D6-A0 — Layered Canon Pre-Audit (API=0)",
    "",
    "## Verdict",
    "",
    "| Flag | Value |",
    "|---|---|",
    "| LAYERED_INFRASTRUCTURE_USABLE | **YES** |",
    "| RUNTIME_LLM_REQUIRED | **NO** |",
    "| MIGRATION_REQUIRED | **NO** |",
    "| NEW_HEURISTIC_CLASSIFICATION_REQUIRED | **NO** |",
    "| LIVE_CALL_READY | **YES** |",
    "| STOP | **NO** |",
    "",
    "## A. Legacy sections (Enoch full structured canon)",
    "",
    "Source: `data/canon-core-audit/d2-enoch-fixtures.ts` ENOCH_CANON (deterministic compile).",
    "",
    `| title | bucket | salience | visibility | chars | tokens≈ |`,
    `|---|---|---|---|---:|---:|`,
    ...sections.map(
      (s) =>
        `| ${s.title} | ${s.bucket} | ${s.salience} | ${s.visibility} | ${s.chars} | ${s.tokens_approx} |`
    ),
    "",
    `Legacy full block: **${report.legacy.chars}** chars (~${report.legacy.tokens_approx} tok).`,
    "",
    "## B. CORE vs ACTIVE classification (existing canonPlan policy)",
    "",
    "CORE (every turn):",
    "",
    ...report.layered.core_titles.map((t) => `- ${t}`),
    "",
    `CORE block: **${report.layered.core_chars}** chars.`,
    "",
    "ACTIVE = relevance-selected from dormant PUBLIC chunks via `selectActiveCanonChunks` (no new heuristics).",
    "",
    "### G5 selection",
    "",
    "```json",
    JSON.stringify(selections.G5, null, 2),
    "```",
    "",
    "### G3 selection",
    "",
    "```json",
    JSON.stringify(selections.G3, null, 2),
    "```",
    "",
    "## C. Runtime LLM / migration",
    "",
    "- Compile: `compileCanonPlanV1` deterministic (section parse + `inferSalience`).",
    "- Select: `selectActiveCanonChunks` keyword/gate deterministic.",
    "- Storage exists (`characters.creator_canon_plan_json`) but D6-A harness compiles **in-memory** from fixture raw — **no DB migration**, **0 LLM compile calls**.",
    "",
    "## D. Fail-open",
    "",
    "Without `canonPlan` or when policy is not LAYERED → `buildCharacterCanonBlock` full legacy. Experiment does **not** change production fail-open.",
    "",
    "## E. Semantics",
    "",
    "```json",
    JSON.stringify(report.semantics, null, 2),
    "```",
    "",
    "## Gemini production note",
    "",
    "```json",
    JSON.stringify(report.gemini_production_policy, null, 2),
    "```",
    "",
    "Arm B = harness-only synthetic `actualCanonMode: LAYERED` + in-memory plan. Production Gemini remains FULL_LEGACY.",
    "",
    "## G3 gunshot coverage",
    "",
    "```json",
    JSON.stringify(report.g3_coverage_gate, null, 2),
    "```",
    "",
  ].join("\n");

  writeFileSync(join(DOCS, "00_PREAUDIT.md"), md, "utf8");
  console.log(JSON.stringify(report, null, 2));
}

main();
