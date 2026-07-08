/**
 * Extract Style DNA from reference corpus + emit universal few-shot.
 * Audit/design only — no production changes.
 *
 * Usage: npx tsx scripts/extract-webnovel-style-dna.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { WEBNOVEL_REFERENCE_CORPUS } from "./lib/webnovel-reference-corpus";
import {
  aggregateStyleDna,
  dnaGapSummary,
  extractStyleDnaMetrics,
  PRODUCTION_STYLE_DNA_BASELINE,
} from "./lib/webnovel-style-dna-extractor";
import {
  buildUniversalWebnovelFewShot,
  PROSE_REPLACEMENT_MAP,
  UNIVERSAL_FEWSHOT_DNA_MAP,
} from "./lib/universal-webnovel-fewshot";

const OUT_JSON = join(process.cwd(), "output", "webnovel-style-dna.json");
const OUT_MD = join(process.cwd(), "output", "webnovel-style-dna-extraction.md");

function formatDnaSection(dna: ReturnType<typeof aggregateStyleDna>): string {
  return [
    "## 1. Style DNA",
    "",
    "출처: 상위 웹소설 turn **구조 공통점**을 반영한 reference corpus 8 beats (장르 무관, 특정 작품 복사 아님).",
    "규칙 추상화가 아니라 **측정 가능한 패턴** + corpus에서 관측된 수치.",
    "",
    "### 1.1 문장 길이 변화",
    `- length stdDev mean: **${dna.sentenceLength.stdDevMean}** (target ≥14)`,
    `- mix: short ${(dna.sentenceLength.shortRatioMean * 100).toFixed(0)}% · mid ${(dna.sentenceLength.midRatioMean * 100).toFixed(0)}% · long ${(dna.sentenceLength.longRatioMean * 100).toFixed(0)}%`,
    `- ${dna.sentenceLength.targetMix}`,
    "",
    "### 1.2 정보 공개 타이밍",
    `- withhold markers / turn: **${dna.infoReveal.withholdPerTurnMean}**`,
    `- facts / 500 chars: **${dna.infoReveal.factsPer500Mean}**`,
    `- pattern: ${dna.infoReveal.pattern}`,
    "",
    "### 1.3 감정 전환",
    `- emotion labels / turn: **${dna.emotionTransition.labelCountMean}** (target ≈0)`,
    `- sensory channels / turn: **${dna.emotionTransition.channelCountMean}**`,
    `- channel transitions: **${dna.emotionTransition.transitionsMean}**`,
    `- pattern: ${dna.emotionTransition.pattern}`,
    "",
    "### 1.4 긴장감 유지",
    `- single-line paragraph ratio: **${dna.tension.singleLineParaRatioMean}**`,
    `- max consecutive narration: **${dna.tension.maxNarMean}** (target ≤3)`,
    `- pattern: ${dna.tension.pattern}`,
    "",
    "### 1.5 여백",
    `- empty beat lines: **${dna.whitespace.emptyBeatMean}**`,
    `- ellipsis: **${dna.whitespace.ellipsisMean}**`,
    `- pattern: ${dna.whitespace.pattern}`,
    "",
    "### 1.6 대사와 지문의 호흡",
    `- dialogueCharShare: **${(dna.dialogueRhythm.charShareMean * 100).toFixed(1)}%**`,
    `- alternation: **${dna.dialogueRhythm.alternationMean}**`,
    `- mean quote length: **${dna.dialogueRhythm.meanQuoteCharsMean} chars**`,
    `- quotes / beat: **${dna.dialogueRhythm.quotesPerTurnMean}**`,
    `- pattern: ${dna.dialogueRhythm.pattern}`,
    "",
    "### 1.7 독자 pull 리듬 (hook)",
    `- hooks / beat: **${dna.hookRhythm.hooksPerTurnMean}**`,
    `- pattern: ${dna.hookRhythm.pattern}`,
    "",
    "### 1.8 Production gap (Step 2 baseline)",
    ...dnaGapSummary(dna).map((l) => `- ${l}`),
    `- production overall: **${PRODUCTION_STYLE_DNA_BASELINE.overallMean}/10**`,
    `- reference hand frequency mean: **${dna.handFrequencyMean}** (손 anchor 최소화 목표)`,
    "",
    "### 1.9 Style DNA — imitation checklist (모델용, 규칙 아님)",
    "",
    "아래는 Few-shot/출력이 **닮아야 할 관측 패턴**이다.",
    "",
    "```",
    "□ 지문 2문장 이내 → \"대사 8–22자\" → 지문 1–2문장 → \"대사\"",
    "□ 연속 지문 4블록 넘기기 전에 반드시 \" 또는 행동 전환",
    "□ beat마다 새 사실 1개; peak 전 withhold 1개(… / 말 중단 / 대신)",
    "□ 감정명(슬프다/불안) 없이 — 소리·시선·숨·공기 교체",
    "□ 긴장 구간: 1문장 단락 허용(「한 걸음.」)",
    "□ turn/micro-beat 끝: ? 또는 … 또는 미완 대사",
    "□ 손·손끝 anchor 남용 금지 (reference hand mean ≤2/beat)",
    "```",
  ].join("\n");
}

function formatFewShotSection(): string {
  const example = buildUniversalWebnovelFewShot({ charName: "{charName}" });
  const mapLines = UNIVERSAL_FEWSHOT_DNA_MAP.map((m) => `| ${m.dna} | ${m.demo} |`).join("\n");

  return [
    "## 2. Few-shot Template",
    "",
    "**전체 적용용** — 장르/캐릭터별 분기 없음. `{charName}` + 말투 4줄만 캐릭터에서 가져옴.",
    "creator `example_dialog`가 있으면 **creator 우선** (기존 정책 유지).",
    "",
    "### 2.1 Universal template (`[예시 대화]`)",
    "",
    "```",
    example,
    "```",
    "",
    "### 2.2 DNA mapping (this few-shot teaches)",
    "",
    "| Style DNA | 이 few-shot에서의 시연 |",
    "|-----------|-------------------------|",
    mapLines,
    "",
    "### 2.3 적용 방침",
    "",
    "- **하나의 platform few-shot** — space/sound/hand variant 폐기 방향",
    "- 대사 4줄(`replyA–D`)만 캐릭터 말투에 맞게 치환; 지문 구조는 **고정**",
    "- flag: harness에서 `buildUniversalWebnovelFewShot` — prod wire는 별도 Step",
    "",
  ].join("\n");
}

function formatProseSection(): string {
  const rows = PROSE_REPLACEMENT_MAP.map(
    (r) =>
      `| ${r.proseSection} | ${r.proseToday} | ${r.replacedBy} | ${r.keepInProse} |`
  ).join("\n");

  return [
    "## 3. PROSE에서 대체 가능한 부분",
    "",
    "Few-shot이 **positive imitation**을 제공하면 PROSE의 negation block을 **축소**한다.",
    "REGISTER·DNR quote integrity·OUTPUT LAYOUT은 **유지**.",
    "",
    "| PROSE block | 현재 (규칙) | Few-shot으로 대체 | PROSE에 남길 것 |",
    "|-------------|-------------|-------------------|-----------------|",
    rows,
    "",
    "### 3.1 PROSE vNext (design sketch, ~40% of current size)",
    "",
    "```",
    "[PROSE STYLE]",
    "지문 craft. 대사·줄바꿈·분량은 전담 블록 SoT.",
    "",
    "[REGISTER]",
    "해체(-다/-했다). 번역투·명사 단편·...... 금지.",
    "",
    "[IMITATION]",
    "[예시 대화]의 지문·대사 호흡·withhold·여백을 turn 전체에 적용.",
    "손·손끝 연속 anchor 금지 — [예시 대화] 채널(소리·공기·시선) 우선.",
    "```",
    "",
    "**제거 후보:** [RHYTHM][EMOTION][SENSATION][WEBNOVEL BREATH][MOVEMENT & SPACE] 전체 negation bullet — Few-shot이 대체.",
    "",
  ].join("\n");
}

function main() {
  mkdirSync(join(process.cwd(), "output"), { recursive: true });

  const perSample = WEBNOVEL_REFERENCE_CORPUS.map((b) =>
    extractStyleDnaMetrics(b.id, b.text)
  );
  const dna = aggregateStyleDna(perSample);
  const fewShot = buildUniversalWebnovelFewShot({ charName: "{charName}" });

  const payload = {
    generatedAt: new Date().toISOString(),
    auditOnly: true,
    corpusSize: WEBNOVEL_REFERENCE_CORPUS.length,
    perSample,
    aggregated: dna,
    productionBaseline: PRODUCTION_STYLE_DNA_BASELINE,
    gaps: dnaGapSummary(dna),
    universalFewShot: fewShot,
    proseReplacement: PROSE_REPLACEMENT_MAP,
  };

  writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2), "utf8");

  const md = [
    "# Webnovel Style DNA Extraction",
    "",
    "Step 3-2 — 상위 웹소설 패턴 추출 → **범용 Few-shot** (prod 미적용)",
    "",
    formatDnaSection(dna),
    "",
    formatFewShotSection(),
    "",
    formatProseSection(),
    "",
    "---",
    `JSON: \`output/webnovel-style-dna.json\``,
  ].join("\n");

  writeFileSync(OUT_MD, md, "utf8");
  console.log(`Wrote ${OUT_JSON}`);
  console.log(`Wrote ${OUT_MD}`);
  console.log("\nStyle DNA summary:");
  console.log(`  dialogueCharShare ${(dna.dialogueRhythm.charShareMean * 100).toFixed(1)}%`);
  console.log(`  alternation ${dna.dialogueRhythm.alternationMean}`);
  console.log(`  hand freq ${dna.handFrequencyMean}`);
}

main();
