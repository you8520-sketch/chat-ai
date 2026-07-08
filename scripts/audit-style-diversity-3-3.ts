/**
 * Step 3-3 — Style Diversity Audit (analysis only)
 *
 * Before: Production samples
 * After: Universal Few-shot + Reference corpus (imitation target fingerprint)
 *        + projected over-imitation (few-shot pattern × scaled turn)
 *
 * Usage: npx tsx scripts/audit-style-diversity-3-3.ts
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { collectStyleAuditSamples } from "./lib/collect-style-audit-samples";
import {
  analyzeStyleDiversity,
  aggregateDiversity,
  buildDiversityComparison,
  type DiversityComparisonRow,
} from "./lib/style-diversity-audit-metrics";
import { buildUniversalWebnovelFewShot } from "./lib/universal-webnovel-fewshot";
import { WEBNOVEL_REFERENCE_CORPUS } from "./lib/webnovel-reference-corpus";

const OUT_JSON = join(process.cwd(), "output", "step33-style-diversity-audit.json");
const OUT_MD = join(process.cwd(), "output", "step33-style-diversity-audit.md");

/** Simulated turn if model over-copies few-shot rhythm every ~800 chars */
function buildProjectedOverImitationTurn(baseChars: number): string {
  const unit = buildUniversalWebnovelFewShot({ charName: "캐릭터" });
  const repeats = Math.max(1, Math.ceil(baseChars / 650));
  return Array.from({ length: repeats }, (_, i) =>
    unit.replace(/\{charName\}/g, "캐릭터").replace("……들었어.", `……들었어${i > 0 ? `(${i})` : ""}.`)
  ).join("\n\n");
}

function formatTable(rows: DiversityComparisonRow[]): string {
  const lines = [
    "| Dimension | Before | After | New repetition | Risk |",
    "|-----------|--------|-------|----------------|------|",
  ];
  for (const r of rows) {
    lines.push(`| ${r.dimension} | ${r.before} | ${r.after} | ${r.newRepetition} | ${r.risk} |`);
  }
  return lines.join("\n");
}

const POSITIVE_STYLE_PRIORITIES = [
  {
    rank: 1,
    element: "대사↔지문 교차 리듬 (alternation)",
    why: "6→9의 체감은 '읽히는 속도'에서 온다. 티키타카가 살아야 웹소설 몰입이 생김.",
    add: "beat마다 지문1–2 → 짧은 대사 → 반응 지문 — Universal Few-shot이 시연",
    not: "narration wall 제거만",
  },
  {
    rank: 2,
    element: "정보 공개 타이밍 (withhold → reveal)",
    why: "다음 문장을 읽게 만드는 힘. 상위작은 fact를 한꺼번에 주지 않는다.",
    add: "beat당 사실 1 + peak 전 withhold — '아직은'·말 중단·대신",
    not: "설정 나열 축소",
  },
  {
    rank: 3,
    element: "문장 길이 호흡 (short/mid/long 혼합)",
    why: "단조로운 밀도는 지루함. 긴장↑일수록 짧아지는 **변화**가 리듬감.",
    add: "1문장 단락(한 걸음.) + 중간 지문 + 짧은 대사 혼합",
    not: "문장 길이 run 감소만",
  },
  {
    rank: 4,
    element: "감정의 간접 전달 (show, channel rotation)",
    why: "라벨 없이 몸·환경으로 읽히는 감정이 '좋은 문체' 체감의 핵심.",
    add: "소리→시선→숨→공기 채널 교체 (few-shot positive exemplar)",
    not: "emotion label 금지",
  },
  {
    rank: 5,
    element: "대사의 경제성 (8–22자 + 잔향)",
    why: "웹소설 대사는 설명이 아니라 **압력**. 짧을수록 지문과 contrast.",
    add: "「……들었어.」「멈춰.」급 — 말투는 캐릭터, 길이는 DNA",
    not: "quote count만 늘리기",
  },
  {
    rank: 6,
    element: "장면 내 micro-turn (행동→반응→전환)",
    why: "한 turn 안에서도 mini arc. 정체 구간이 flat하면 9/10 불가.",
    add: "유저 질문 → withhold → 긴장 상승 → cliff — few-shot 4-beat",
    not: "turn length만 채우기",
  },
  {
    rank: 7,
    element: "문장 시작 다양성 (POV·시점 shift)",
    why: "이름/그/그녀 시작 반복은 카메라 고정 느낌. 시작형 변화가 flow.",
    add: "환경·소리·대사로 단락 시작 — hand anchor 대신",
    not: "povNameStartShare 감점만",
  },
  {
    rank: 8,
    element: "어휘·감각 채널 다양성",
    why: "같은 감각 반복 = 새 hand. 다양한 채널이 풍부함.",
    add: "beat마다 primary channel 교체 (corpus DNA)",
    not: "touch share 감소",
  },
  {
    rank: 9,
    element: "캐릭터 화법 생동감 (말투 4줄 + 지문 분리)",
    why: "지문 DNA는 공통, **대사만** 캐릭터 — platform few-shot 설계 의도.",
    add: "replyA–D를 speech profile에서 주입; 지문 구조는 universal",
    not: "genre별 few-shot 분기",
  },
  {
    rank: 10,
    element: "turn/handoff cliff (다음 턴 pull)",
    why: "9/10 turn은 끝에서 멈춘다. 해소보다 **미완**이 재입력 유도.",
    add: "… / ? / 미완 대사 — hook DNA (과도 시 diversity audit)",
    not: "handoffOpenScore만",
  },
];

function main() {
  mkdirSync(join(process.cwd(), "output"), { recursive: true });

  const { samples } = collectStyleAuditSamples({ target: 60 });
  const beforeMetrics = samples.map((s) => analyzeStyleDiversity(s.text));
  const beforeAgg = aggregateDiversity(beforeMetrics);

  const afterTexts: { id: string; text: string }[] = [
    { id: "universal-fewshot", text: buildUniversalWebnovelFewShot({ charName: "캐릭터" }) },
    ...WEBNOVEL_REFERENCE_CORPUS.map((b) => ({ id: b.id, text: b.text })),
  ];

  const meanProdChars = beforeAgg.mean.charCount;
  afterTexts.push({
    id: "projected-over-imitation",
    text: buildProjectedOverImitationTurn(meanProdChars),
  });

  const afterMetrics = afterTexts.map((t) => analyzeStyleDiversity(t.text));
  const afterAgg = aggregateDiversity(afterMetrics);

  const comparison = buildDiversityComparison(beforeAgg, afterAgg);

  const payload = {
    generatedAt: new Date().toISOString(),
    auditOnly: true,
    before: {
      source: "production samples (DB + harness)",
      sampleCount: beforeAgg.sampleCount,
      aggregated: beforeAgg.mean,
    },
    after: {
      source: "universal few-shot + reference corpus + projected over-imitation",
      sampleCount: afterAgg.sampleCount,
      aggregated: afterAgg.mean,
      samples: afterTexts.map((t, i) => ({
        id: t.id,
        metrics: afterMetrics[i],
      })),
    },
    comparison,
    positiveStylePriorities: POSITIVE_STYLE_PRIORITIES,
  };

  writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2), "utf8");

  const priorityTable = POSITIVE_STYLE_PRIORITIES.map(
    (p) =>
      `| ${p.rank} | ${p.element} | ${p.why} | ${p.add} |`
  ).join("\n");

  const md = [
    "# Step 3-3 — Style Diversity Audit",
    "",
    "Analysis only — prod 미적용.",
    "",
    "## Diversity comparison (Production vs Style DNA target)",
    "",
    "- **Before:** production assistant turns (n=" + beforeAgg.sampleCount + ")",
    "- **After:** Universal Few-shot + reference corpus + projected over-imitation (~" +
      Math.round(meanProdChars) +
      " chars)",
    "",
    formatTable(comparison),
    "",
    "## Interpretation",
    "",
    "### New anchors replacing hand?",
    "",
    comparison
      .filter((r) => r.dimension.includes("NEW anchor"))
      .map((r) => `- ${r.newRepetition} (**Risk: ${r.risk}**)`)
      .join("\n"),
    "",
    "### Key risks if few-shot copied blindly",
    "",
    "1. **소리·복도·형광등** corridor template — 장르 불문 동일 배경",
    "2. **숨·시선·공기** sensory triad — hand 대신 2순위 anchor",
    "3. **withhold 3종**(말하지 않·대신·입술을 닫) — beat마다 동일 gesture",
    "4. **한 걸음 / 또 한 걸음** — tension shortcut",
    "5. **…… / ?** hook — turn end homogenization",
    "",
    "**Mitigation (design, not prod):** Universal few-shot은 **구조만 고정**, 감각 명사·배경은 turn마다 rotate slot 3종 이상 corpus pool에서 샘플.",
    "",
    "---",
    "",
    "## 6/10 → 9/10: 가산점 요소 Top 10 (hand 무관)",
    "",
    "초점: **무엇을 줄일까** → **무엇을 더하면 문체가 좋아질까**",
    "",
    "| Rank | Element | Why it lifts style | What to add |",
    "|------|---------|-------------------|-------------|",
    priorityTable,
    "",
    "---",
    `JSON: \`output/step33-style-diversity-audit.json\``,
  ].join("\n");

  writeFileSync(OUT_MD, md, "utf8");
  console.log(`Wrote ${OUT_JSON}`);
  console.log(`Wrote ${OUT_MD}`);
  console.log("\nComparison highlights:");
  for (const r of comparison) {
    console.log(`  [${r.risk}] ${r.dimension}`);
  }
}

main();
