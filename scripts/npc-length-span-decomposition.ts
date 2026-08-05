/**
 * Offline span decomposition: post-fix baseline vs early_relationship_axis_only.
 * No model calls — reclassify existing RAW text into exclusive reviewable spans.
 *
 * Usage:
 *   node --import tsx scripts/npc-length-span-decomposition.ts
 */
import fs from "node:fs";
import path from "node:path";
import { computeDialogueMetrics } from "../src/lib/dialogueMetrics";

const ART =
  process.env.ART_ROOT ||
  "/opt/cursor/artifacts/deepseek-common-root-audit";
const OUT =
  process.env.OUT_DIR || path.join(ART, "21-npc-length-decomposition");

type SpanKind =
  | "PRIMARY_DIALOGUE"
  | "PRIMARY_NARRATION"
  | "USER_REACTION_CONTEXT"
  | "EXTERNAL_DIALOGUE"
  | "EXTERNAL_SUBPLOT_NARRATION"
  | "FUNCTIONAL_ENVIRONMENT"
  | "DECORATIVE_FILLER";

type Span = { kind: SpanKind; text: string; chars: number; preview: string };

const STAFF_ATTR =
  /(직원|스태프|간호사|의사|안내원|담당자|의료진|회색\s*셔츠|접수\s*담당|연구원|동료|행인|경비|데스크|창구|조태형\s*씨)/;
const ADMIN_Q =
  /(신원\s*대조|바이탈|임시\s*등록|기본\s*확인부터|안쪽으로\s*안내|등록\s*정보|다음\s*분|번호\s*부르)/;
const ADMIN_NARR =
  /(등록|접수|문진|차트|진료|신원|바이탈|서류|보호\s*대상|대기실|확인실|호출|행정|검문|출입\s*절차|데스크\s*너머|창구\s*앞)/;
const USER_REACTION =
  /(?:렌|그|그녀).{0,20}(?:말|손|시선|행동|대답|반응|움직임|미소|표정|소매|고개).{0,12}(?:에|을|를|한|하|보|잡)/;
const FUNCTIONAL_ENV =
  /(?:빛|소리|바람|발소리|군중|소음|공기|향|온도|복도|홀|문|벽|천장|바닥|창문|그림자).{0,36}(?:닿|울리|번지|스치|흔들|밀려|가라앉|맴돌|비치|퍼지|잦아|들리|보이)/;
const DECORATIVE =
  /(?:입꼬리|입매|시선이\s*잠깐|짧게\s*웃|작게\s*웃|살짝\s*고개|고개를\s*기울|숨을\s*고르|입술을\s*깨물)/;

function charLen(s: string): number {
  return [...s].length;
}

function previewOf(s: string): string {
  return s.slice(0, 140).replace(/\n/g, " ");
}

function classifyNarration(seg: string): SpanKind {
  const t = seg.trim();
  if (!t) return "PRIMARY_NARRATION";
  if (ADMIN_NARR.test(t) && STAFF_ATTR.test(t)) {
    return "EXTERNAL_SUBPLOT_NARRATION";
  }
  if (ADMIN_NARR.test(t) && /(직원|데스크|창구|접수|담당|의무실|대기)/.test(t)) {
    return "EXTERNAL_SUBPLOT_NARRATION";
  }
  if (t.length < 90 && DECORATIVE.test(t) && !USER_REACTION.test(t)) {
    return "DECORATIVE_FILLER";
  }
  if (USER_REACTION.test(t) && /(?:렌|소매|옆에|따른|바라본|손끝|고개)/.test(t)) {
    return "USER_REACTION_CONTEXT";
  }
  if (
    FUNCTIONAL_ENV.test(t) &&
    !/(?:라이크는|라이크가|태형은|태형이|그는|그가)/.test(t.slice(0, 36))
  ) {
    return "FUNCTIONAL_ENVIRONMENT";
  }
  return "PRIMARY_NARRATION";
}

function isExternalQuote(quote: string, before: string): boolean {
  const beforeFlat = before.replace(/\n/g, " ");
  return STAFF_ATTR.test(beforeFlat) || ADMIN_Q.test(quote);
}

/** Split RAW into exclusive spans (quotes + intervening narration). */
function buildSpans(raw: string): Span[] {
  const text = raw.replace(/\r\n/g, "\n");
  const spans: Span[] = [];
  const quoteRe = /[“"]([^”"\n]+)[”"]/g;
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = quoteRe.exec(text)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (start > cursor) {
      const narr = text.slice(cursor, start);
      if (narr.trim()) {
        const kind = classifyNarration(narr);
        spans.push({
          kind,
          text: narr,
          chars: charLen(narr),
          preview: previewOf(narr),
        });
      } else if (narr) {
        // whitespace-only — fold into previous or as PRIMARY_NARRATION residual later
        spans.push({
          kind: "PRIMARY_NARRATION",
          text: narr,
          chars: charLen(narr),
          preview: previewOf(narr),
        });
      }
    }
    const quote = m[1]!;
    const before = text.slice(Math.max(0, start - 140), start);
    const kind: SpanKind = isExternalQuote(quote, before)
      ? "EXTERNAL_DIALOGUE"
      : "PRIMARY_DIALOGUE";
    spans.push({
      kind,
      text: m[0],
      chars: charLen(m[0]),
      preview: previewOf(m[0]),
    });
    cursor = end;
  }
  if (cursor < text.length) {
    const narr = text.slice(cursor);
    if (narr) {
      const kind = narr.trim() ? classifyNarration(narr) : "PRIMARY_NARRATION";
      spans.push({
        kind,
        text: narr,
        chars: charLen(narr),
        preview: previewOf(narr),
      });
    }
  }
  return spans;
}

function countDialogueResumes(spans: Span[], kinds: SpanKind[]): number {
  let starts = 0;
  let lastWas = false;
  for (const s of spans) {
    const d = kinds.includes(s.kind);
    if (d && !lastWas) starts += 1;
    lastWas = d;
  }
  return Math.max(0, starts - 1);
}

function annotate(raw: string) {
  const spans = buildSpans(raw);
  const byKind = Object.fromEntries(
    (
      [
        "PRIMARY_DIALOGUE",
        "PRIMARY_NARRATION",
        "USER_REACTION_CONTEXT",
        "EXTERNAL_DIALOGUE",
        "EXTERNAL_SUBPLOT_NARRATION",
        "FUNCTIONAL_ENVIRONMENT",
        "DECORATIVE_FILLER",
      ] as SpanKind[]
    ).map((k) => [k, spans.filter((s) => s.kind === k).reduce((a, s) => a + s.chars, 0)])
  ) as Record<SpanKind, number>;

  const total_chars = charLen(raw.replace(/\r\n/g, "\n"));
  const classified = spans.reduce((a, s) => a + s.chars, 0);
  const residual = Math.max(0, total_chars - classified);
  byKind.PRIMARY_NARRATION += residual;

  const core_scene_chars =
    byKind.PRIMARY_DIALOGUE +
    byKind.PRIMARY_NARRATION +
    byKind.USER_REACTION_CONTEXT +
    byKind.FUNCTIONAL_ENVIRONMENT;
  const external_subplot_chars =
    byKind.EXTERNAL_DIALOGUE + byKind.EXTERNAL_SUBPLOT_NARRATION;
  const decorative_filler_chars = byKind.DECORATIVE_FILLER;

  const primaryDialogueBlocks = spans.filter((s) => s.kind === "PRIMARY_DIALOGUE").length;
  const externalDialogueBlocks = spans.filter((s) => s.kind === "EXTERNAL_DIALOGUE").length;

  const primary_character_resume = countDialogueResumes(spans, ["PRIMARY_DIALOGUE"]);
  const external_speaker_resume = countDialogueResumes(spans, ["EXTERNAL_DIALOGUE"]);
  const all_speaker_resume = countDialogueResumes(spans, [
    "PRIMARY_DIALOGUE",
    "EXTERNAL_DIALOGUE",
  ]);

  const primary_resume_per_1000_core_chars =
    core_scene_chars > 0
      ? Number(((primary_character_resume * 1000) / core_scene_chars).toFixed(3))
      : 0;

  // Align resume split with prior manual metrics for cross-check
  const dm = computeDialogueMetrics({ text: raw, primaryCharacterName: "라이크" });

  return {
    total_chars,
    byKind,
    core_scene_chars,
    external_subplot_chars,
    decorative_filler_chars,
    primary_dialogue_blocks: primaryDialogueBlocks,
    primary_character_resume,
    external_speaker_resume,
    all_speaker_resume,
    primary_resume_per_1000_core_chars,
    external_dialogue_blocks: externalDialogueBlocks,
    external_subplot_ratio: total_chars > 0 ? external_subplot_chars / total_chars : 0,
    crosscheck_manual_resume_all_speakers: dm.manual_resume_transitions,
    crosscheck_manual_resume_per_1000: dm.manual_resume_per_1000_chars,
    spans: spans.map(({ kind, chars, preview }) => ({ kind, chars, preview })),
  };
}

function loadRaws(dir: string, label: string) {
  const out: Array<{ id: string; label: string; raw: string; path: string }> = [];
  for (const run of ["run1", "run2", "run3"]) {
    for (const turn of ["turn1", "turn2"]) {
      const p = path.join(dir, run, `${turn}-provider-raw.txt`);
      if (!fs.existsSync(p)) continue;
      out.push({
        id: `${label}/${run}/${turn}`,
        label,
        raw: fs.readFileSync(p, "utf8"),
        path: p,
      });
    }
  }
  return out;
}

function avg(nums: number[]) {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

function main() {
  const baselineDir = path.join(ART, "19-dialogue-resume/post_fix_production_baseline");
  const candidateDir = path.join(ART, "20-early-npc-axis/early_relationship_axis_only");
  const baseline = loadRaws(baselineDir, "baseline");
  const candidate = loadRaws(candidateDir, "candidate");
  if (baseline.length !== 6 || candidate.length !== 6) {
    throw new Error(`expected 6+6 raws, got ${baseline.length}+${candidate.length}`);
  }

  const annotated = [...baseline, ...candidate].map((item) => ({
    id: item.id,
    label: item.label,
    source: item.path,
    ...annotate(item.raw),
  }));

  const b = annotated.filter((a) => a.label === "baseline");
  const c = annotated.filter((a) => a.label === "candidate");

  const summary = {
    baseline: {
      n: b.length,
      avg_total: avg(b.map((x) => x.total_chars)),
      avg_core_scene: avg(b.map((x) => x.core_scene_chars)),
      avg_external_subplot: avg(b.map((x) => x.external_subplot_chars)),
      avg_decorative: avg(b.map((x) => x.decorative_filler_chars)),
      avg_primary_resume: avg(b.map((x) => x.primary_character_resume)),
      avg_external_resume: avg(b.map((x) => x.external_speaker_resume)),
      avg_all_speaker_resume: avg(b.map((x) => x.all_speaker_resume)),
      avg_primary_resume_per_1000_core: avg(b.map((x) => x.primary_resume_per_1000_core_chars)),
      sum_external_dialogue_blocks: b.reduce((a, x) => a + x.external_dialogue_blocks, 0),
      avg_external_subplot_ratio: avg(b.map((x) => x.external_subplot_ratio)),
    },
    candidate: {
      n: c.length,
      avg_total: avg(c.map((x) => x.total_chars)),
      avg_core_scene: avg(c.map((x) => x.core_scene_chars)),
      avg_external_subplot: avg(c.map((x) => x.external_subplot_chars)),
      avg_decorative: avg(c.map((x) => x.decorative_filler_chars)),
      avg_primary_resume: avg(c.map((x) => x.primary_character_resume)),
      avg_external_resume: avg(c.map((x) => x.external_speaker_resume)),
      avg_all_speaker_resume: avg(c.map((x) => x.all_speaker_resume)),
      avg_primary_resume_per_1000_core: avg(c.map((x) => x.primary_resume_per_1000_core_chars)),
      sum_external_dialogue_blocks: c.reduce((a, x) => a + x.external_dialogue_blocks, 0),
      avg_external_subplot_ratio: avg(c.map((x) => x.external_subplot_ratio)),
    },
  };

  const coreRatio = summary.candidate.avg_core_scene / Math.max(1, summary.baseline.avg_core_scene);
  const totalDrop = summary.baseline.avg_total - summary.candidate.avg_total;
  const externalDrop =
    summary.baseline.avg_external_subplot - summary.candidate.avg_external_subplot;
  const externalExplains = totalDrop > 0 ? externalDrop / totalDrop : 0;

  let length_loss_verdict: string;
  let explanation: string;
  if (coreRatio >= 0.9 && externalExplains >= 0.7) {
    length_loss_verdict = "LENGTH_DROP_MOSTLY_EXTERNAL_BUDGET_REMOVAL";
    explanation =
      "Candidate core scene retained ≥90% of baseline while ≥70% of total-length drop is explained by external subplot removal.";
  } else if (coreRatio < 0.9) {
    length_loss_verdict = "RELATIONSHIP_AXIS_COMPRESSES_CORE_SCENE";
    explanation =
      "Candidate core-scene chars fell below 90% of baseline — relationship-axis lock compressed primary interaction prose, not only NPC budget.";
  } else {
    length_loss_verdict = "SPAN_DECOMPOSITION_INCONCLUSIVE";
    explanation =
      "Core scene mostly retained but external-subplot removal does not explain ≥70% of the total-length drop (or totals did not drop).";
  }

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(
    path.join(OUT, "SPAN_ANNOTATION.json"),
    JSON.stringify(
      {
        method:
          "quote-level exclusive spans with 140-char staff lookbehind; narration classified by admin/user-reaction/env/decorative heuristics; residual folded into PRIMARY_NARRATION",
        note: "Manual-reviewable previews included per span; no new model calls",
        outputs: annotated,
        summary,
      },
      null,
      2
    ),
    "utf8"
  );

  const md = `# Core Scene Comparison

## Averages (n=6 each)

| metric | baseline | candidate | delta |
|---|---:|---:|---:|
| total_chars | ${summary.baseline.avg_total.toFixed(1)} | ${summary.candidate.avg_total.toFixed(1)} | ${(summary.candidate.avg_total - summary.baseline.avg_total).toFixed(1)} |
| core_scene_chars | ${summary.baseline.avg_core_scene.toFixed(1)} | ${summary.candidate.avg_core_scene.toFixed(1)} | ${(summary.candidate.avg_core_scene - summary.baseline.avg_core_scene).toFixed(1)} |
| external_subplot_chars | ${summary.baseline.avg_external_subplot.toFixed(1)} | ${summary.candidate.avg_external_subplot.toFixed(1)} | ${(summary.candidate.avg_external_subplot - summary.baseline.avg_external_subplot).toFixed(1)} |
| decorative_filler_chars | ${summary.baseline.avg_decorative.toFixed(1)} | ${summary.candidate.avg_decorative.toFixed(1)} | ${(summary.candidate.avg_decorative - summary.baseline.avg_decorative).toFixed(1)} |
| primary_character_resume | ${summary.baseline.avg_primary_resume.toFixed(2)} | ${summary.candidate.avg_primary_resume.toFixed(2)} | |
| external_speaker_resume | ${summary.baseline.avg_external_resume.toFixed(2)} | ${summary.candidate.avg_external_resume.toFixed(2)} | |
| all_speaker_resume | ${summary.baseline.avg_all_speaker_resume.toFixed(2)} | ${summary.candidate.avg_all_speaker_resume.toFixed(2)} | |
| primary_resume/1000 core | ${summary.baseline.avg_primary_resume_per_1000_core.toFixed(3)} | ${summary.candidate.avg_primary_resume_per_1000_core.toFixed(3)} | |
| external_dialogue_blocks (sum) | ${summary.baseline.sum_external_dialogue_blocks} | ${summary.candidate.sum_external_dialogue_blocks} | |
| external_subplot_ratio | ${(summary.baseline.avg_external_subplot_ratio * 100).toFixed(1)}% | ${(summary.candidate.avg_external_subplot_ratio * 100).toFixed(1)}% | |

## Length-loss tests

- core_scene ratio (candidate/baseline): **${(coreRatio * 100).toFixed(1)}%** (threshold A: ≥90%)
- total drop: **${totalDrop.toFixed(1)}**
- external subplot drop: **${externalDrop.toFixed(1)}**
- external explains total drop: **${(externalExplains * 100).toFixed(1)}%** (threshold A: ≥70%)

## Verdict

\`${length_loss_verdict}\`

${explanation}

## Per-output

${annotated
  .map(
    (a) =>
      `- \`${a.id}\`: total=${a.total_chars} core=${a.core_scene_chars} external=${a.external_subplot_chars} decorative=${a.decorative_filler_chars} primary_resume=${a.primary_character_resume} ext_resume=${a.external_speaker_resume} all_resume=${a.all_speaker_resume} ext_dlg_blocks=${a.external_dialogue_blocks}`
  )
  .join("\n")}
`;
  fs.writeFileSync(path.join(OUT, "CORE_SCENE_COMPARISON.md"), md, "utf8");

  const verdict = {
    offline_decomposition: true,
    n_baseline: 6,
    n_candidate: 6,
    baseline_total_length: Number(summary.baseline.avg_total.toFixed(1)),
    baseline_core_scene_length: Number(summary.baseline.avg_core_scene.toFixed(1)),
    baseline_external_subplot_length: Number(summary.baseline.avg_external_subplot.toFixed(1)),
    candidate_total_length: Number(summary.candidate.avg_total.toFixed(1)),
    candidate_core_scene_length: Number(summary.candidate.avg_core_scene.toFixed(1)),
    candidate_external_subplot_length: Number(summary.candidate.avg_external_subplot.toFixed(1)),
    core_scene_ratio: Number(coreRatio.toFixed(4)),
    external_explains_total_drop_ratio: Number(externalExplains.toFixed(4)),
    length_loss_explanation: explanation,
    length_loss_verdict,
    relationship_axis_npc_effect: "STRONG_DIRECTIONAL_EVIDENCE",
    production_candidate: "INVALID_UNTIL_REPLACED_BY_DYNAMIC_FOCUS",
    length_owner_audit: "NOT_NEEDED",
    next: "early_active_interaction_focus canary (fail-closed)",
    pr_233: "close without merge — superseded by dynamic interaction-focus audit",
  };
  fs.writeFileSync(path.join(OUT, "VERDICT.json"), JSON.stringify(verdict, null, 2), "utf8");
  console.log(JSON.stringify(verdict, null, 2));
  console.log(`wrote ${OUT}`);
}

main();
