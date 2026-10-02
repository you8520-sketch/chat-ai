/**
 * Manual production pilot author for official romance-fantasy supply.
 *
 * MANUAL ONLY: requires OFFICIAL_PILOT_LIVE=1. Never imported by tests.
 * Text calls only — image generation, user billing/points, creator rewards,
 * staging, and publishing are all out of scope here and never imported below.
 *
 * Usage (node --conditions=react-server --import tsx scripts/official-supply-pilot-author.ts ...):
 *   --step=world | characters | character --slot=N | portfolio-qa | appearance
 *   --step=assetplan [--slot=N]   character-specific, portfolio-aware scene planning (sequential)
 *   --step=voice-fix              re-author only contract-failing voice fields
 *   --step=adult-fix              re-author only adultSection toward the manifest adult plan
 *   --step=styles
 *   --step=cost-reconcile         summarize the canonical ledger into cost.json
 *   --step=market-fit-review      offline facts-only Domestic Market Fit review (no rewrites)
 *   --step=replace-slots          re-plan the manifest's replaced slots inside the existing world (briefs only)
 *   --step=public-fix             offline: apply human-approved tagline/tag decisions (public surface only)
 *   --step=relationship-repair    offline: canonical relationship targets + replacement public awareness
 *   --step=consistency-fix        offline: manifest-declared world-consistency repairs
 */
import fs from "node:fs";
import path from "node:path";
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

import { getDb } from "@/lib/db";
import {
  createAuthorCostReport,
  generateOfficialAppearanceLock,
  generateOfficialAssetPlan,
  generateOfficialCharacterBible,
  generateOfficialPortfolioReplacement,
  generateOfficialStyleBoard,
  generateOfficialWorldBible,
  liveOfficialAuthorTransport,
  OFFICIAL_AUTHOR_REQUEST_KIND,
  provenanceFor,
  recordAuthorRun,
  recordWorkflowRetry,
  resolveOfficialAuthorModelId,
  reviseOfficialAdultProfile,
  reviseOfficialCharacterVoice,
  validatePilotAppearance,
  validatePilotAssetPlan,
  validatePilotBible,
  validatePilotDraftForTextLock,
  validatePilotLorebook,
  withAuthorAccounting,
  OFFICIAL_AUTHOR_TEMPLATE_VERSION,
  OFFICIAL_AUTHOR_SNAPSHOT_VERSION,
  type OfficialAuthorCostReport,
  type OfficialAuthorProvenance,
  type OfficialAuthorRawCompletion,
  type OfficialAuthorTransport,
  type OfficialVoiceRevisionField,
} from "@/lib/officialSupply/author";
import {
  OFFICIAL_AUTHOR_QUALITY_CONTRACT,
  type AdultProfilePlan,
  type OfficialAuthorTask,
  type PortfolioBriefInput,
  type WorldMarketInput,
} from "@/lib/officialSupply/authorPrompts";
import {
  buildDomesticMarketFitReview,
  evaluateCastRoleDiversity,
  evaluateDiscoveryTags,
  evaluateMarketFitPortfolio,
  evaluateMarketTropePortfolio,
  evaluateNamePortfolio,
  formatMarketSignalLines,
  hasUserRelationshipCue,
  observedMarketNames,
  resolveNamingProfile,
  selectMarketSignals,
  validateMarketFitBrief,
  type CastRoleEntry,
  type OfficialBatchMarketPolicy,
} from "@/lib/officialSupply/marketFit";
import {
  ADULT_DYNAMICS,
  compileOfficialDraftFromBible,
  evaluateAdultPortfolioDiversity,
  evaluateAuthorQualityContract,
  extractAdultDynamics,
  type OfficialCharacterBible,
  type OfficialWorldBible,
} from "@/lib/officialSupply/bible";
import {
  evaluateCastRelationshipGraph,
  normalizeOfficialCastRelationships,
  reconcileReplacementPublicRelationships,
  type CastIdentity,
} from "@/lib/officialSupply/castRelationships";
import { clearQuarantine, writeQuarantine } from "@/lib/officialSupply/pilotArtifacts";
import {
  evaluateCastIntent,
  evaluatePortfolioBalance,
  formatCastGenderMix,
  isSingleGenderIntent,
  validateResearchSnapshot,
  type CastGender,
  type OfficialCastIntent,
  type ResearchSnapshot,
} from "@/lib/officialSupply/research";
import {
  buildSceneAvoidList,
  evaluateSceneCandidateAgainstPortfolio,
  evaluateScenePortfolioDiversity,
  resolveOfficialCharacterSceneContext,
  type OfficialCharacterSceneContext,
  type ScenePortfolioEntry,
} from "@/lib/officialSupply/scenePortfolio";
import { OfficialSupplyGateError } from "@/lib/officialSupply/store";
import { officialSubstantiveCharCount } from "@/lib/officialSupply/characterText";
import {
  evaluateInternalRegionConsistency,
  evaluateOriginality,
  evaluateWorldDiversity,
  internalWorldRegions,
} from "@/lib/officialSupply/worldQa";
import type { OfficialAppearanceLock, OfficialAssetPlan, OfficialCharacterDraft } from "@/lib/officialSupply/types";

const PILOT_DIR = path.join(process.cwd(), "src/lib/officialSupply/pilot");
const CHAR_DIR = path.join(PILOT_DIR, "characters");
const SNAPSHOT_PATH = path.join(
  process.cwd(),
  "docs/official-supply/market-research-snapshot-2026-09.json"
);

/**
 * Pilot-scoped adult direction (manifest config — not a global ratio).
 * Chosen per character fit from each committed bible.
 */
const ADULT_PLAN: Record<string, AdultProfilePlan> = {
  // Frail, formal heir who asks before acting; leans on the user yet hides it.
  "pilot-rf-01": {
    dialogueProfile: "suggestive",
    consentModes: ["standard"],
    direction: "의례처럼 허락을 구하는 친밀함, 병약함에서 오는 의존과 취약함을 드러내는 순간, 달빛·잎맥 비유의 속삭임",
  },
  // Command-and-report discipline already canon; power play fits when negotiated.
  "pilot-rf-02": {
    dialogueProfile: "explicit_rare",
    consentModes: ["standard", "power_play"],
    direction: "사전에 협상된 권력 교환(명령·보고 역할극), 규칙을 지킨 상대에 대한 짧고 무거운 인정, 끝난 뒤 체온·물·상처를 확인하는 사후 돌봄",
  },
  // Temple inquisitor: vows vs. desire; tension is guilt and self-chosen transgression, not command.
  "pilot-rf-06": {
    dialogueProfile: "suggestive",
    consentModes: ["standard"],
    direction: "금욕 서약이 흔들리는 순간의 긴장, 죄책과 갈망의 줄다리기, 금지된 보호를 스스로 선택하는 결단(상대의 선택을 대신하지 않음)",
  },
  // Political hostage: seduction as negotiation between equals holding each other's weak points.
  "pilot-rf-08": {
    dialogueProfile: "explicit_frequent",
    consentModes: ["standard"],
    direction: "흥정처럼 오가는 도발과 유혹, 이용하는 척 진심을 숨기는 밀고 당기기, 서로의 약점을 쥔 대등한 주도권",
  },
};

/**
 * Batch-scoped cast intent (manifest config, not a genre rule): the first
 * Korea-first female-oriented rofan launch batch leads with male romance targets.
 */
const CAST_INTENT: OfficialCastIntent = {
  targetAudience: "female_oriented",
  romanceTargetProfile: "한국 여성향 로판 독자를 위한 남성 로맨스 대상 중심(여성 1명·인외 1명은 의도된 니치 커버리지)",
  desiredGenderMix: { male: 8, female: 1, other: 1 },
  rationale: "kr-37(여성향 로판 선정 캐릭터가 남성 중심) · kr-25/kr-29(여성향 로맨스·후회남 태그) · kr-33(여성향 랜딩 카테고리) · PR #1087 human review",
};

/**
 * Pilot correction: slots 06-08 are re-planned inside the existing world;
 * every other brief, bible and artifact stays as authored.
 */
const AVOID_NAME_SYLLABLES = "카엘룸·볼프강·루시안·율리우스·바스티안·세라피나·이노센트와 첫 음절(카·볼·루·율·바·세·이)과 끝 음절(룸·강·안·스·나·트)이 겹치지 않게";
const SLOT_REPLACEMENT = {
  replacedNames: ["발레리아 드 솔레이", "헬레나 폰 발켄하임", "로웨나 아스터"],
  slots: [
    {
      slot: 6,
      gender: "male" as const,
      adultCandidate: true,
      direction:
        "남성. 역할 공간: 대신전 소속 이단심문관(성기사 서품). 핵심 경험: 심문, 금지된 보호, 신앙과 욕망의 충돌, 규율과 개인적 선택의 충돌. " +
        "유저의 금지된 에테르/이단 혐의를 다루는 첫 관계가 한 줄에 읽힐 것. 세라피나(성녀)·율리우스(이단 연구 교수)와 역할·경험이 겹치지 않게. " +
        `황자·북부대공 금지, 근위대장 여기사를 남자로 바꾼 캐릭터 금지. 이름은 ${AVOID_NAME_SYLLABLES}.`,
    },
    {
      slot: 7,
      gender: "male" as const,
      adultCandidate: false,
      direction:
        "남성. 역할 공간: 태양의 눈(중심 핵)·에테르 정제탑을 운영하는 황실 마도공학 현장 총책임자. 핵심 경험: 위험한 공동 연구, 기술적 의존, 계약, 비밀 공유, 능력/생존 문제로 묶인 관계. " +
        "율리우스(교수·논리전·연구)와 달리 권한 있는 실무 책임자·제작자·현장 해결사. 이노센트(길드 정비 유닛)와 겹치지 않게. " +
        `황자·북부대공 금지. 이름은 ${AVOID_NAME_SYLLABLES}.`,
    },
    {
      slot: 8,
      gender: "male" as const,
      adultCandidate: true,
      direction:
        "남성. 역할 공간: 제국 서부 해상 무역권 벨로체에서 황실과 항로 분쟁을 벌인 반황실 해상 귀족 가문의 후계자, 휴전 보증을 위해 수도에 머무는 정치적 인질(외국인·적국 귀족·왕자·황족 아님). " +
        "핵심 경험: 정치적 적대, 강제된 근접, 외교 협상, 불신에서 협력, 서로 이용하지만 쉽게 버릴 수 없는 관계. " +
        `황자·북부대공·청부업자·브로커와 같은 경험 금지. 이름은 ${AVOID_NAME_SYLLABLES}.`,
    },
  ],
};

/** Human review decisions on the public surface (PR #1087 review). Part1/bonds/scenes untouched. */
const PUBLIC_SURFACE_DECISIONS: Record<string, { tagline?: string; replaceTags?: [string, string][]; addTags?: string[] }> = {
  "pilot-rf-01": { tagline: "피를 토하던 황자가, 목격한 당신에게 비밀 거래를 청한다." },
  "pilot-rf-02": { tagline: "금지된 마석을 쥔 당신을 압송해 온 북부의 대공.", replaceTags: [["느린 신뢰", "혐관"]], addTags: ["북부대공"] },
  "pilot-rf-03": { tagline: "금고 경보 속, 비밀 장부를 든 브로커와 당신은 같은 탈출로에 갇혔다." },
  "pilot-rf-09": { replaceTags: [["감정의 균열", "금단"]] },
  "pilot-rf-10": { tagline: "폐기 직전, 당신의 심장 소리에 깨어난 기계 인형.", replaceTags: [["잔잔한 관계", "순애"]] },
  // Its only support was a relationship to a removed character; 연구 협력 is what the bible actually shows.
  "pilot-rf-04": { replaceTags: [["느린 긴장", "연구 협력"]] },
};

/**
 * Deterministic world-consistency repairs (no provider call). Each rewrite is
 * [path, from, to] and must match the current text (or already read `to`);
 * `terms` are then replaced in every string of the brief, bible and asset plan.
 */
type ConsistencyPatch = {
  draftKey: string;
  reason: string;
  rewrites: [string, string, string][];
  terms: [string, string][];
};
const CONSISTENCY_PATCHES: ConsistencyPatch[] = [
  {
    draftKey: "pilot-rf-08",
    reason: "World Bible: 벨로체 = 에테르노스 제국 서부 해상 무역권(내부 지역). 노엘은 외국·적국·패전국 귀족이 아니라 황실과 맞섰던 서부 해상 귀족 가문의 후계자이자 휴전 보증 인질.",
    rewrites: [
      ["brief.socialPosition", "몰락한 벨로체 가문의 후계자로, 휴전 협상이 끝날 때까지", "황실과 항로 분쟁을 벌인 제국 서부 해상 무역권 벨로체 가문의 후계자로, 휴전을 보증하기 위해 협상이 끝날 때까지"],
      ["brief.archetype", "몰락한 해상 귀족의 후계자이자 황실이 붙잡아 둔 외교 협상 카드", "황실과 맞선 서부 해상 귀족의 후계자이자 황실이 붙잡아 둔 휴전 협상 카드"],
      ["brief.marketFit.archetype", "몰락한 해상 귀족 가문의 후계자이자 수도에 붙잡힌 외교 인질", "황실과 맞선 제국 서부 해상 귀족 가문의 후계자이자 휴전 보증을 위해 수도에 붙잡힌 인질"],
      ["brief.marketFit.differentiationTwist", "궁정의 권력자가 아니라 패전과 몰락을 겪은 외국 귀족 후계자다.", "궁정의 권력자가 아니라, 황실과 맞섰다가 몰락한 제국 서부 해상 귀족 가문의 후계자다."],
      ["brief.marketFit.userRelationship", "휴전 조건을 두고 맞서는 외국 귀족 인질이자", "휴전 조건을 두고 맞서는 서부 반황실 해상 귀족 인질이자"],
      ["brief.marketFit.oneLineConflict", "제국의 협상관인 당신은 적국 귀족 인질과", "황실 협상관인 당신은 황실과 맞섰던 서부 해상 귀족 인질과"],
      ["bible.identity.socialPosition", "몰락한 해상 귀족 가문의 후계자이자 외교 인질", "황실과 맞섰던 서부 해상 귀족 가문의 후계자이자 휴전 보증 인질"],
      ["bible.identity.affiliation", "벨로체 가문; 태양의 옥좌 감시하에 체류", "벨로체 해상 귀족 가문(제국 서부 해상 무역권); 태양의 옥좌 감시하에 수도 체류"],
      ["bible.backstory.events.1.event", "휴전 전투가 길어지며", "가문이 항구와 항로의 자치를 내세워 황실과 맞선 해상 분쟁이 길어지며"],
      ["bible.backstory.events.1.event", "제국의 통행 제한", "황실의 통행 제한"],
      [
        "bible.situation.worldContext",
        "태양의 옥좌는 그를 황실의 감시 아래 수도에 두고 휴전 조건을 조율한다.",
        "제국 서부 해상 무역권 벨로체의 해상 귀족 가문은 공허의 밤 이후 항구와 항로의 자치를 내세워 황실과 맞섰고, 지금은 휴전 중이다. 태양의 옥좌는 휴전의 보증으로 그를 황실의 감시 아래 수도에 두고 조건을 조율한다.",
      ],
      [
        "bible.situation.personalSituation",
        "벨로체 가문의 후계자이자 휴전 협상이 끝날 때까지 수도를 떠날 수 없는 외교 인질이다.",
        "제국 서부 해상 무역권 벨로체의 해상 귀족 가문 후계자이자, 가문이 황실과 맺은 휴전을 보증하기 위해 협상이 끝날 때까지 수도를 떠날 수 없는 인질이다.",
      ],
      ["bible.situation.userEntry", "당신은 제국의 휴전 협상관으로", "당신은 황실의 휴전 협상관으로"],
      ["bible.publicProfile.tagline", "휴전을 협상해야 하는 적국 귀족 인질, 노엘", "당신이 귀환 조건을 쥔 서부 반란 귀족 인질, 노엘."],
      [
        "bible.publicProfile.description",
        "노엘은 패전국에서 온 귀족 후계자이자 외교 인질입니다.",
        "노엘은 황실과 맞섰던 서부 해상 귀족 가문의 후계자이자, 휴전을 보증하려 수도에 머무는 인질입니다.",
      ],
    ],
    terms: [
      ["귀국", "귀환"],
      ["외국 사절단", "벨로체 사절단"],
      ["외교 인질", "정치적 인질"],
    ],
  },
];

const MANIFEST = {
  batchKey: "pilot-romance-fantasy-01",
  worldKey: "pilot-rf-erendel",
  styleKey: "romance_fantasy_v1",
  genre: "로맨스 판타지",
  slots: 10,
  adultCandidates: 4,
  castIntent: CAST_INTENT,
  genderMix: formatCastGenderMix(CAST_INTENT.desiredGenderMix),
  slotGenders: ["male", "male", "male", "male", "male", "male", "male", "male", "female", "other"] as CastGender[],
  replacement: SLOT_REPLACEMENT,
  templateVersion: OFFICIAL_AUTHOR_TEMPLATE_VERSION,
  snapshotVersion: OFFICIAL_AUTHOR_SNAPSHOT_VERSION,
  portfolioPolicy: { adultShareMin: 0.3, adultShareMax: 0.5, maxGenreShare: 1, minDistinctGenres: 1 },
  adultPlan: ADULT_PLAN,
  publicSurfaceDecisions: PUBLIC_SURFACE_DECISIONS,
  consistencyPatches: CONSISTENCY_PATCHES,
  /** Batch product policy: this pilot targets the Korean launch market (not a global constant). */
  marketPolicy: {
    targetLocale: "ko-KR",
    signalRegion: "KR",
    marketPriority: "domestic_first",
    maxSupportingSignals: 6,
    marketRoleMix: {
      proven: { min: 6, max: 7 },
      proven_twist: { min: 2, max: 3 },
      experimental: { min: 1, max: 1 },
    },
    maxPrimaryTropeRepeat: 2,
    coreTags: OFFICIAL_AUTHOR_QUALITY_CONTRACT.discoveryTags,
    maxTaglineWorldTerms: 2,
  } satisfies OfficialBatchMarketPolicy,
};

function readSnapshot(): ResearchSnapshot {
  const snapshot = readJson<ResearchSnapshot>(SNAPSHOT_PATH);
  const qa = validateResearchSnapshot(snapshot);
  if (!qa.ok) throw new Error(`research snapshot invalid: ${qa.errors.map((e) => e.code).join(",")}`);
  return snapshot;
}

function worldMarketInput(snapshot: ResearchSnapshot): WorldMarketInput {
  const policy = MANIFEST.marketPolicy;
  return {
    targetLocale: policy.targetLocale,
    marketPriority: policy.marketPriority,
    signalLines: formatMarketSignalLines(selectMarketSignals(snapshot, policy, MANIFEST.genre)),
    namingProfile: resolveNamingProfile(MANIFEST.genre),
    marketRoleMix: policy.marketRoleMix,
    maxPrimaryTropeRepeat: policy.maxPrimaryTropeRepeat,
    coreTags: policy.coreTags,
  };
}

/** Public trend URLs from the committed snapshot (observation only). */
const REFERENCE_URLS = [
  "https://www.aitimes.com/news/articleView.html?idxno=167810",
  "https://chatjanitor.com/",
  "https://qanispot.com/janitor-ai/",
  "https://savedelete.com/article/janitor-ai-romantic-chatbot-15m-users-women-majority/",
  "https://zeta-ai.io/ko/plots/f3ca37b2-0334-4d7d-8e71-26764ba2d671/profile",
  "https://zeta-ai.io/ko/plots/b03d0348-e2cf-4c31-b5f9-bae997ce2e5c/profile",
  "https://rofan.ai/",
  "https://navercorp.com/media/pressReleasesDetail?seq=34351",
];

function ensureDirs(): void {
  fs.mkdirSync(CHAR_DIR, { recursive: true });
}

function draftKeyFor(slot: number): string {
  return `pilot-rf-${String(slot).padStart(2, "0")}`;
}

function charPath(slot: number): string {
  return path.join(CHAR_DIR, `${draftKeyFor(slot)}.json`);
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function writeJson(file: string, value: unknown): void {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

// ── Cost report (reporting artifact over the canonical ledger) ──────────────

type LegacyLedgerSummary = {
  source: string;
  ledgerCutoff: string;
  successfulCompletions: number;
  billedCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  failedProviderAttempts: { tracked: false; lowerBoundFromSurvivingLogs: number };
  v1ReportedButIncomplete: { calls: number; costUsd: number };
};

type PilotCostFile = OfficialAuthorCostReport & {
  /** Everything before v2 physical-attempt accounting existed. */
  legacy?: LegacyLedgerSummary;
  ledgerCrossCheck?: { since: string; ledgerSuccessfulCompletions: number; ledgerBilledCostUsd: number };
};

const COST_FILE = path.join(PILOT_DIR, "cost.json");

function loadCost(): PilotCostFile {
  if (!fs.existsSync(COST_FILE)) return createAuthorCostReport();
  const raw = readJson<Partial<PilotCostFile> & { version?: number }>(COST_FILE);
  if (raw.version !== 2) {
    throw new Error("cost.json is v1 (per-success-line retries); run --step=cost-reconcile first");
  }
  return raw as PilotCostFile;
}

function saveCost(report: PilotCostFile): void {
  writeJson(COST_FILE, { ...report, imageCalls: 0 });
}

function ledgerTotals(sinceExclusive?: string): {
  count: number;
  cost: number;
  input: number;
  output: number;
  last: string;
} {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS count, COALESCE(SUM(actual_cost_usd), 0) AS cost,
              COALESCE(SUM(input_tokens), 0) AS input, COALESCE(SUM(output_tokens), 0) AS output,
              COALESCE(MAX(created_at), '') AS last
       FROM api_cost_ledger
       WHERE request_kind = ? AND (? IS NULL OR created_at > ?)`
    )
    .get(OFFICIAL_AUTHOR_REQUEST_KIND, sinceExclusive ?? null, sinceExclusive ?? null) as {
    count: number;
    cost: number;
    input: number;
    output: number;
    last: string;
  };
  return row;
}

/**
 * Canonical ledger is the source of truth. v1 cost.json only kept the
 * final-attempt lines (QA-rejected but billed completions were missing), so
 * the pre-v2 period is summarized straight from `api_cost_ledger`.
 */
function stepCostReconcile(): void {
  const current = fs.existsSync(COST_FILE) ? readJson<Record<string, unknown>>(COST_FILE) : {};
  if (current.version === 2) {
    const report = current as unknown as PilotCostFile;
    if (!report.legacy) throw new Error("v2 cost.json without legacy cutoff");
    const since = ledgerTotals(report.legacy.ledgerCutoff);
    report.ledgerCrossCheck = {
      since: report.legacy.ledgerCutoff,
      ledgerSuccessfulCompletions: since.count,
      ledgerBilledCostUsd: Math.round(since.cost * 1e6) / 1e6,
    };
    saveCost(report);
    console.log(
      `[pilot] cross-check since ${report.legacy.ledgerCutoff}: ledger ${since.count} / $${since.cost.toFixed(6)}; ` +
        `report ${report.successfulCompletions} success / $${report.billedCostUsd.toFixed(6)}`
    );
    return;
  }
  const totals = ledgerTotals();
  const logDir = "/tmp";
  let failedLower = 0;
  for (const file of fs.existsSync(logDir) ? fs.readdirSync(logDir) : []) {
    if (!/^pilot-.+\.log$/.test(file)) continue;
    const text = fs.readFileSync(path.join(logDir, file), "utf8");
    failedLower += (text.match(/attempt \d+ failed: (CheaperInference 5\d\d|The operation was aborted|fetch failed)/g) ?? []).length;
  }
  const v1 = current as { calls?: number; costUsd?: number };
  const report: PilotCostFile = {
    ...createAuthorCostReport(),
    legacy: {
      source: `api_cost_ledger request_kind=${OFFICIAL_AUTHOR_REQUEST_KIND} (successful provider completions only)`,
      ledgerCutoff: totals.last,
      successfulCompletions: totals.count,
      billedCostUsd: Math.round(totals.cost * 1e6) / 1e6,
      inputTokens: totals.input,
      outputTokens: totals.output,
      failedProviderAttempts: { tracked: false, lowerBoundFromSurvivingLogs: failedLower },
      v1ReportedButIncomplete: { calls: Number(v1.calls ?? 0), costUsd: Math.round(Number(v1.costUsd ?? 0) * 1e6) / 1e6 },
    },
  };
  saveCost(report);
  console.log(`[pilot] legacy baseline from ledger: ${totals.count} completions / $${totals.cost.toFixed(6)} (cutoff ${totals.last})`);
}

function recordRun(draftKey: string, task: OfficialAuthorTask, provenance: OfficialAuthorProvenance): void {
  try {
    recordAuthorRun(getDb(), { draftKey, task, provenance });
  } catch (error) {
    console.warn(`[pilot] author-run ledger skipped for ${draftKey}/${task}:`, (error as Error).message);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One workflow step with bounded retries. Each attempt gets its own
 * accounting transport, so a retry is counted once per step (not per line)
 * and every physical provider call is recorded exactly once.
 */
async function runWorkflowStep<T>(input: {
  report: PilotCostFile;
  draftKey: string | null;
  label: string;
  maxAttempts: number;
  quarantineKey: string;
  run: (transport: OfficialAuthorTransport, attempt: number, feedback: string | undefined) => Promise<T>;
  /** Last gate-rejected candidate, recorded in the quarantine for review. */
  lastRejected?: () => unknown;
}): Promise<T> {
  let feedback: string | undefined;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= input.maxAttempts; attempt += 1) {
    if (attempt > 1) recordWorkflowRetry(input.report);
    const transport = withAuthorAccounting(liveOfficialAuthorTransport, input.report, {
      draftKey: input.draftKey,
      workflowAttempt: attempt,
    });
    try {
      const out = await input.run(transport, attempt, feedback);
      clearQuarantine(PILOT_DIR, input.quarantineKey);
      saveCost(input.report);
      return out;
    } catch (error) {
      lastError = error;
      const message = String((error as Error)?.message ?? error);
      // Provider errors carry no content signal; QA rejections become next-attempt feedback.
      if (!/CheaperInference 5\d\d|aborted|fetch failed/.test(message)) feedback = message.slice(0, 2000);
      console.warn(`[pilot] ${input.label} attempt ${attempt} failed:`, message.slice(0, 300));
      saveCost(input.report);
      if (attempt < input.maxAttempts) await sleep(8000 * attempt);
    }
  }
  writeQuarantine(PILOT_DIR, input.quarantineKey, lastError, new Date(), input.lastRejected?.());
  throw lastError;
}

// ── World / characters (unchanged generation order) ──────────────────────────

function worldContextForBrief(world: OfficialWorldBible, brief: PortfolioBriefInput): string {
  const faction = world.factions.find((f) => f.name === brief.faction);
  const locations = world.locations
    .slice(0, 4)
    .map((location) => `${location.name}(${location.purpose})`)
    .join(" / ");
  return [
    `세계: ${world.name} — ${world.centralPremise}`,
    `현재: ${world.situation.biggestEvent}`,
    brief.faction && faction
      ? `소속 세력 ${faction.name}: ${faction.purpose} / 일반 시선: ${faction.publicView}`
      : "",
    `능력 규칙(한계·대가·금기): ${world.powerSystem.limits} / ${world.powerSystem.costs} / ${world.powerSystem.taboos}`,
    `주요 장소: ${locations}`,
    `유저 진입: ${world.userEntry.allowedRoles.join("·")}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function siblingSketches(briefs: PortfolioBriefInput[], excludeSlot: number): string[] {
  return briefs
    .filter((b) => b.slot !== excludeSlot)
    .map((b) => `${b.name}(${b.age}세 ${b.gender}, ${b.occupation}, ${b.archetype}, ${b.relationshipTrope})`);
}

function castList(briefs: PortfolioBriefInput[]): string[] {
  return briefs.map((b) => `${b.name} — ${b.occupation}(${b.faction})`);
}

async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await fn(items[index]!);
    }
  });
  await Promise.all(workers);
  return out;
}

async function stepWorld(modelId: string, maxAttempts: number): Promise<void> {
  const report = loadCost();
  const snapshot = readSnapshot();
  await runWorkflowStep({
    report,
    draftKey: "world",
    label: "world",
    maxAttempts,
    quarantineKey: "world",
    run: async (transport, attempt) => {
      const { bible, provenances } = await generateOfficialWorldBible({
        transport,
        world: {
          genre: MANIFEST.genre,
          worldKey: MANIFEST.worldKey,
          styleKey: MANIFEST.styleKey,
          market: worldMarketInput(snapshot),
          castIntent: castIntentLine(),
          slots: MANIFEST.slots,
          adultCandidates: MANIFEST.adultCandidates,
          genderMix: MANIFEST.genderMix,
          slotGenders: MANIFEST.slotGenders,
        },
        modelId,
        attempt,
      });
      // Market fit is planned before any Character Bible: gate it here.
      const marketQa = evaluateMarketFitPortfolio(
        bible.portfolio.map((b) => ({ draftKey: draftKeyFor(b.slot), name: b.name, adultCandidate: b.adultCandidate, marketFit: b.marketFit })),
        { snapshot, policy: MANIFEST.marketPolicy, genre: MANIFEST.genre }
      );
      if (!marketQa.ok) {
        throw new OfficialSupplyGateError("author_market_fit_rejected", marketQa.errors.map((e) => `${e.code}: ${e.message}`).join("; "), marketQa);
      }
      for (const provenance of provenances) recordRun("world", "world_bible", provenance);
      writeJson(path.join(PILOT_DIR, "world-bible.json"), { bible, provenances });
      console.log(`[pilot] world bible ok: ${bible.name} (attempt ${attempt})`);
    },
  });
}

type CharRevision = {
  step: "voice-fix" | "adult-fix" | "assetplan" | "public-fix" | "cast-cleanup" | "relationship-repair" | "consistency-fix";
  fields: string[];
  reasons: string[];
  at: string;
  /** Null for offline deterministic edits (no provider call). */
  provenance: OfficialAuthorProvenance | null;
};

type CharFile = {
  slot: number;
  draftKey: string;
  brief: PortfolioBriefInput;
  bible: OfficialCharacterBible;
  draft: OfficialCharacterDraft;
  appearance?: OfficialAppearanceLock;
  assetPlan?: OfficialAssetPlan;
  sceneContext?: OfficialCharacterSceneContext;
  provenances: OfficialAuthorProvenance[];
  revisions?: CharRevision[];
  charCount: number;
  quarantined?: boolean;
};

function compileForBrief(bible: OfficialCharacterBible, brief: PortfolioBriefInput): OfficialCharacterDraft {
  return compileOfficialDraftFromBible(bible, {
    draftKey: draftKeyFor(brief.slot),
    worldKey: MANIFEST.worldKey,
    styleKey: MANIFEST.styleKey,
    genres: ["로맨스 판타지"],
    audience: brief.audience,
    worldName: readWorld().name,
    hook: {
      archetype: brief.archetype,
      relationshipTrope: brief.relationshipTrope,
      occupation: brief.occupation,
      rpHook: brief.rpHook,
    },
  });
}

/** `checkTags: false` only for edits that leave tags untouched (e.g. relationship cleanup). */
function assertBibleAndDraft(
  bible: OfficialCharacterBible,
  brief: PortfolioBriefInput,
  opts: { checkTags?: boolean } = {}
): OfficialCharacterDraft {
  if (bible.identity.name !== brief.name) {
    throw new OfficialSupplyGateError("author_bible_rejected", `slot ${brief.slot}: bible name "${bible.identity.name}" ≠ brief "${brief.name}"`);
  }
  const region = evaluateInternalRegionConsistency(JSON.stringify({ brief, bible }), internalWorldRegions(readWorld().regions));
  if (!region.ok) {
    throw new OfficialSupplyGateError("author_world_conflict", `slot ${brief.slot}: ${region.errors.map((e) => e.message).join("; ")}`, region);
  }
  const bibleQa = validatePilotBible(bible, { adultExpected: brief.adultCandidate });
  if (!bibleQa.ok) {
    throw new OfficialSupplyGateError(
      "author_bible_rejected",
      `slot ${brief.slot} bible QA: ${bibleQa.errors.map((e) => `${e.code}(${e.message})`).join("; ")}`,
      bibleQa
    );
  }
  const tagQa = evaluateDiscoveryTags({ tags: bible.publicProfile.tags, bible, hook: brief }, MANIFEST.marketPolicy);
  if (opts.checkTags !== false && !tagQa.ok) {
    throw new OfficialSupplyGateError("author_tags_rejected", `slot ${brief.slot} tags: ${tagQa.errors.map((e) => e.message).join("; ")}`, tagQa);
  }
  const draft = compileForBrief(bible, brief);
  const draftQa = validatePilotDraftForTextLock(draft, []);
  if (!draftQa.ok) {
    throw new OfficialSupplyGateError(
      "author_draft_rejected",
      `slot ${brief.slot} draft QA: ${draftQa.errors.map((e) => `${e.code}(${e.message})`).join("; ")}`,
      draftQa
    );
  }
  return draft;
}

async function generateOneCharacter(
  brief: PortfolioBriefInput,
  world: OfficialWorldBible,
  siblings: PortfolioBriefInput[],
  modelId: string,
  maxAttempts: number,
  report: PilotCostFile
): Promise<CharFile> {
  const draftKey = draftKeyFor(brief.slot);
  return runWorkflowStep({
    report,
    draftKey,
    label: `slot ${brief.slot}`,
    maxAttempts,
    quarantineKey: `character-${draftKey}`,
    run: async (transport, attempt, feedback) => {
      const { bible, completions } = await generateOfficialCharacterBible({
        transport,
        part1: {
          brief,
          worldName: world.name,
          worldContext: worldContextForBrief(world, brief),
          siblingSketches: siblingSketches(siblings, brief.slot),
          feedback,
        },
        voice: {
          name: brief.name,
          age: brief.age,
          adultCandidate: brief.adultCandidate,
          speechDirection: brief.speechDirection,
          npcDemand: "특별한 이유가 없으면 1~2명을 만든다. 0명은 기존 관계망만으로 충분할 때만 허용.",
          marketFit: brief.marketFit,
          feedback,
        },
        bonds: {
          name: brief.name,
          age: brief.age,
          rpHook: brief.rpHook,
          adultCandidate: brief.adultCandidate,
          castList: castList(siblings),
          feedback,
        },
        modelId,
      });
      // A near-miss on voice fields or tags is repaired on the same bible
      // (canonical voice revision) instead of discarding part1 + bonds.
      let accepted = bible;
      const repairs: OfficialAuthorRawCompletion[] = [];
      for (let repair = 0; repair < 2; repair += 1) {
        const issues = [
          ...validatePilotBible(accepted, { adultExpected: brief.adultCandidate }).errors,
          ...evaluateDiscoveryTags({ tags: accepted.publicProfile.tags, bible: accepted, hook: brief }, MANIFEST.marketPolicy).errors,
        ];
        if (issues.length === 0) break;
        const fields = voiceFieldsFor(issues.map((e) => e.code));
        const repairable = issues.every((e) => voiceFieldsFor([e.code]).length > 0);
        if (!repairable || fields.length === 0) break;
        console.log(`[pilot] slot ${brief.slot} voice repair ${repair + 1}: ${fields.join(",")}`);
        const revised = await reviseOfficialCharacterVoice({
          transport,
          bible: accepted,
          voice: {
            name: brief.name,
            age: brief.age,
            adultCandidate: brief.adultCandidate,
            speechDirection: brief.speechDirection,
            npcDemand: "기존 NPC를 유지한다(새로 만들지 않는다).",
            marketFit: brief.marketFit,
          },
          fields,
          reasons: issues.map((e) => `${e.code}: ${e.message}`),
          modelId,
        });
        repairs.push(revised.completion);
        accepted = revised.bible;
      }
      const draft = assertBibleAndDraft(accepted, brief);
      const tasks: OfficialAuthorTask[] = ["character_bible_1", "character_bible_voice", "character_bible_bonds"];
      const provenances = [...completions, ...repairs].map((completion, i) => provenanceFor(completion, attempt * 10 + i));
      provenances.forEach((p, i) => recordRun(draftKey, tasks[i] ?? "character_bible_voice", p));
      const file: CharFile = {
        slot: brief.slot,
        draftKey,
        brief,
        bible: accepted,
        draft,
        provenances,
        charCount: officialSubstantiveCharCount(draft),
      };
      writeJson(charPath(brief.slot), file);
      console.log(`[pilot] slot ${brief.slot} ${brief.name} ok (${file.charCount} chars, attempt ${attempt})`);
      return file;
    },
  });
}

function readWorld(): OfficialWorldBible {
  return readJson<{ bible: OfficialWorldBible }>(path.join(PILOT_DIR, "world-bible.json")).bible;
}

function readChar(slot: number): CharFile {
  return readJson<CharFile>(charPath(slot));
}

async function stepCharacters(
  modelId: string,
  maxAttempts: number,
  concurrency: number,
  onlySlot?: number
): Promise<void> {
  const report = loadCost();
  const world = readWorld();
  const briefs = world.portfolio.filter((b) => (onlySlot ? b.slot === onlySlot : true));
  const pending = briefs.filter((brief) => {
    if (onlySlot) return true;
    try {
      const existing = readChar(brief.slot);
      if (existing && !existing.quarantined && existing.draft && existing.bible) {
        console.log(`[pilot] slot ${brief.slot} already complete — skipping`);
        return false;
      }
    } catch {
      // missing file → generate
    }
    return true;
  });
  // Per-slot isolation: one quarantine must not abort sibling slots.
  const results = await pool(pending, concurrency, async (brief) => {
    try {
      await generateOneCharacter(brief, world, world.portfolio, modelId, maxAttempts, report);
      return { slot: brief.slot, ok: true as const };
    } catch (error) {
      return { slot: brief.slot, ok: false as const, error: String((error as Error)?.message ?? error) };
    }
  });
  const failedSlots = results.filter((r) => !r.ok);
  if (failedSlots.length > 0) throw new Error(`quarantined slots: ${failedSlots.map((r) => r.slot).join(",")}`);
}

function sceneEntries(world: OfficialWorldBible, files: CharFile[]): ScenePortfolioEntry[] {
  return files
    .filter((f) => f.assetPlan)
    .map((f) => ({
      draftKey: f.draftKey,
      name: f.bible.identity.name,
      plan: f.assetPlan!,
      context: f.sceneContext ?? resolveOfficialCharacterSceneContext({ world, bible: f.bible, brief: f.brief }),
    }));
}

function stepPortfolioQa(): void {
  const world = readWorld();
  const files = world.portfolio.map((b) => readChar(b.slot));
  const drafts = files.map((f) => {
    if (!f.draft) throw new Error(`slot ${f.slot} has no draft (quarantined?)`);
    return f.draft;
  });
  const diversity = evaluateWorldDiversity(drafts, { intendedSingleGender: isSingleGenderIntent(MANIFEST.castIntent) });
  console.log("[pilot] world-diversity errors:", diversity.errors.length);
  for (const e of diversity.errors) console.log(`  - ${e.code}: ${e.message}`);
  const intent = evaluateCastIntent(drafts.map((d) => d.gender as CastGender), MANIFEST.castIntent);
  console.log("[pilot] cast intent ok:", intent.ok, intent.errors.map((e) => e.message));
  // Authored voices, not just the brief direction, decide the speech-archetype check.
  const roles = evaluateCastRoleDiversity(
    castRoleEntries(world.portfolio).map((entry, i) => {
      const speech = files[i]!.bible.speech;
      return { ...entry, speechDirection: `${entry.speechDirection} ${speech.register} ${speech.keywords.join(" ")}` };
    })
  );
  console.log("[pilot] cast roles ok:", roles.ok, roles.errors.map((e) => e.message), "royal/ducal:", roles.royalOrDuke);
  const graph = evaluateCastRelationshipGraph(
    files.map((f) => ({ draftKey: f.draftKey, name: f.bible.identity.name, relationships: f.bible.otherRelationships })),
    { removedNames: MANIFEST.replacement.replacedNames, replacedDraftKeys: MANIFEST.replacement.slots.map((s) => draftKeyFor(s.slot)) }
  );
  console.log("[pilot] relationships ok:", graph.ok, graph.errors.map((e) => e.message), `edges ${graph.stats.edges}, one-way ${graph.stats.oneWay.length}`);
  const regions = internalWorldRegions(world.regions);
  for (const f of files) {
    const region = evaluateInternalRegionConsistency(
      JSON.stringify({ brief: f.brief, bible: f.bible, plan: f.assetPlan, sceneContext: f.sceneContext }),
      regions
    );
    if (!region.ok) console.log(`[pilot] world conflict ${f.draftKey}:`, region.errors.map((e) => e.message));
  }
  const snapshot = readJson<{ signals: { source: string; scenarioHook?: string; worldMechanic?: string }[] }>(
    SNAPSHOT_PATH
  );
  const corpus = snapshot.signals.map((s) => ({
    source: s.source,
    phrases: s.scenarioHook ? [s.scenarioHook] : [],
    terms: s.worldMechanic ? [s.worldMechanic] : [],
  }));
  for (const draft of drafts) {
    const qa = evaluateOriginality(draft, corpus, []);
    if (!qa.ok) console.log(`[pilot] originality FAIL ${draft.draftKey}:`, qa.errors.map((e) => `${e.code} ${e.message}`));
  }
  const lorebook = validatePilotLorebook(world.lorebook, drafts);
  console.log("[pilot] lorebook ok:", lorebook.ok, lorebook.errors.map((e) => e.code));
  const balance = evaluatePortfolioBalance(
    drafts.map((d) => ({ draftKey: d.draftKey, primaryGenre: "로맨스 판타지" as const, nsfw: d.adult.nsfw })),
    MANIFEST.portfolioPolicy
  );
  console.log("[pilot] portfolio balance ok:", balance.ok, balance.errors.map((e) => e.code));
  for (const file of files) {
    const contract = evaluateAuthorQualityContract(file.bible);
    if (!contract.ok) console.log(`[pilot] contract FAIL ${file.draftKey}:`, contract.errors.map((e) => e.code));
  }
  const adult = evaluateAdultPortfolioDiversity(files.map((f) => f.bible));
  console.log("[pilot] adult portfolio ok:", adult.ok, adult.errors.map((e) => e.message), adult.warnings.map((w) => w.message));
  const scenes = evaluateScenePortfolioDiversity(sceneEntries(world, files), world.locations);
  console.log("[pilot] scene portfolio ok:", scenes.ok);
  for (const e of scenes.errors) console.log(`  - ${e.code}: ${e.message}`);
  for (const w of scenes.warnings) console.log(`  ~ ${w.code}: ${w.message}`);
  console.log("[pilot] lengths:", drafts.map((d) => `${d.draftKey}=${officialSubstantiveCharCount(d)}`).join(" "));
}

async function stepAppearance(modelId: string, maxAttempts: number, onlySlot?: number): Promise<void> {
  const report = loadCost();
  const world = readWorld();
  // With --slot, every other character's committed lock is the sibling set.
  const looks: string[] = onlySlot
    ? world.portfolio
        .filter((b) => b.slot !== onlySlot)
        .map((b) => readChar(b.slot))
        .filter((f) => f.appearance)
        .map((f) => `${f.bible.identity.name}: ${f.appearance!.identity.hairColor} ${f.appearance!.identity.hairLength}, ${f.appearance!.identity.eyeColor}, ${f.appearance!.identity.heightCm}cm`)
    : [];
  for (const brief of world.portfolio.filter((b) => !onlySlot || b.slot === onlySlot)) {
    const file = readChar(brief.slot);
    if (!file.bible) throw new Error(`slot ${brief.slot} has no bible`);
    const appearanceSource = [
      `얼굴: ${file.bible.appearance.faceShape}, ${file.bible.appearance.eyes}(${file.bible.appearance.eyeColor})`,
      `머리: ${file.bible.appearance.hairColor} ${file.bible.appearance.hairstyle}(${file.bible.appearance.hairLength})`,
      `키/체형: ${file.bible.identity.heightCm}cm ${file.bible.appearance.build}, ${file.bible.appearance.skin}`,
      `특징: ${file.bible.appearance.distinguishingFeatures}`,
      `의상: ${file.bible.appearance.defaultOutfit}, ${file.bible.appearance.accessories}`,
      `인상: ${file.bible.appearance.impression}`,
    ].join("\n");
    await runWorkflowStep({
      report,
      draftKey: file.draftKey,
      label: `appearance slot ${brief.slot}`,
      maxAttempts,
      quarantineKey: `appearance-${file.draftKey}`,
      run: async (transport, attempt) => {
        const { lock, completion } = await generateOfficialAppearanceLock({
          transport,
          appearance: {
            name: file.bible.identity.name,
            age: file.bible.identity.age,
            gender: file.bible.identity.gender,
            appearanceSource,
            siblingLooks: [...looks],
          },
          modelId,
        });
        const qa = validatePilotAppearance(file.draft, lock);
        if (!qa.ok) throw new OfficialSupplyGateError("author_appearance_rejected", qa.errors.map((e) => e.code).join(","), qa);
        recordRun(file.draftKey, "appearance", provenanceFor(completion, attempt));
        looks.push(
          `${file.bible.identity.name}: ${lock.identity.hairColor} ${lock.identity.hairLength}, ${lock.identity.eyeColor}, ${lock.identity.heightCm}cm`
        );
        writeJson(charPath(brief.slot), { ...file, appearance: lock });
        console.log(`[pilot] appearance slot ${brief.slot} ok (attempt ${attempt})`);
      },
    });
  }
}

// ── Scene planning (character-specific, portfolio-aware, sequential) ─────────

async function planOneCharacterScenes(input: {
  file: CharFile;
  world: OfficialWorldBible;
  planned: ScenePortfolioEntry[];
  modelId: string;
  maxAttempts: number;
  report: PilotCostFile;
  extraFeedback?: string;
}): Promise<CharFile> {
  const { file, world, planned } = input;
  const context = resolveOfficialCharacterSceneContext({ world, bible: file.bible, brief: file.brief });
  let rejectedScenes: unknown;
  return runWorkflowStep({
    report: input.report,
    draftKey: file.draftKey,
    label: `assetplan slot ${file.slot}`,
    maxAttempts: input.maxAttempts,
    quarantineKey: `assetplan-${file.draftKey}`,
    lastRejected: () => rejectedScenes,
    run: async (transport, attempt, feedback) => {
      const avoid = buildSceneAvoidList(planned, world.locations, context);
      const { plan, completion } = await generateOfficialAssetPlan({
        transport,
        plan: {
          name: file.bible.identity.name,
          adult: file.draft.adult.nsfw,
          defaultOutfit: file.bible.appearance.defaultOutfit,
          scene: context,
          avoid,
          feedback: [input.extraFeedback, feedback].filter(Boolean).join("\n") || undefined,
        },
        modelId: input.modelId,
      });
      const qa = validatePilotAssetPlan(file.draft, plan);
      if (!qa.ok) {
        throw new OfficialSupplyGateError("author_plan_rejected", qa.errors.map((e) => `${e.code}: ${e.message}`).join("; "), qa);
      }
      const candidate: ScenePortfolioEntry = { draftKey: file.draftKey, name: file.bible.identity.name, plan, context };
      const portfolioQa = evaluateSceneCandidateAgainstPortfolio(candidate, planned, world.locations);
      if (!portfolioQa.ok) {
        rejectedScenes = plan.slots
          .filter((s) => s.kind === "scene")
          .map((s) => ({ slotKey: s.slotKey, location: s.location, situation: s.situation }));
        throw new OfficialSupplyGateError(
          "author_scene_portfolio_rejected",
          portfolioQa.errors.map((e) => `${e.code}: ${e.message}`).join("; "),
          portfolioQa
        );
      }
      const provenance = provenanceFor(completion, attempt);
      recordRun(file.draftKey, "asset_plan", provenance);
      const next: CharFile = {
        ...file,
        assetPlan: plan,
        sceneContext: context,
        revisions: [
          ...(file.revisions ?? []),
          { step: "assetplan", fields: ["assetPlan"], reasons: ["scene planner collapse (portfolio)"], at: provenance.createdAt, provenance },
        ],
      };
      writeJson(charPath(file.slot), next);
      console.log(`[pilot] assetplan slot ${file.slot} ok (attempt ${attempt})`);
      return next;
    },
  });
}

async function stepAssetPlans(
  modelId: string,
  maxAttempts: number,
  onlySlot?: number,
  fromSlot?: number
): Promise<void> {
  const report = loadCost();
  const world = readWorld();
  const slots = world.portfolio.map((b) => b.slot);
  // --from=N resumes the sequential pass: slots before N keep their already re-planned scenes.
  const targets = onlySlot ? [onlySlot] : slots.filter((s) => s >= (fromSlot ?? 1));
  // Sequential: each character is planned against the scenes already chosen by its siblings.
  let files = slots.map((slot) => readChar(slot));
  for (const slot of targets) {
    const others = files.filter((f) => f.slot !== slot && (onlySlot || f.slot < slot));
    const planned = sceneEntries(world, others);
    const updated = await planOneCharacterScenes({
      file: files.find((f) => f.slot === slot)!,
      world,
      planned,
      modelId,
      maxAttempts,
      report,
    });
    files = files.map((f) => (f.slot === slot ? updated : f));
  }
  const qa = evaluateScenePortfolioDiversity(sceneEntries(world, files), world.locations);
  console.log("[pilot] scene portfolio ok:", qa.ok, qa.errors.map((e) => e.message));
  if (!qa.ok) throw new Error("scene portfolio QA failed — re-plan the offending slots with --step=assetplan --slot=N");
}

// ── Voice / adult minimal corrections ────────────────────────────────────────

function voiceFieldsFor(codes: string[]): OfficialVoiceRevisionField[] {
  const fields = new Set<OfficialVoiceRevisionField>();
  for (const code of codes) {
    if (code.startsWith("bible_greeting")) fields.add("greeting");
    if (code.startsWith("bible_pitch")) fields.add("publicDescription");
    if (code.startsWith("bible_speech")) fields.add("speech");
    if (code === "tag_bible_mismatch" || code === "bible_tags" || code === "tags_keyword_stuffing") fields.add("tags");
  }
  return [...fields];
}

async function stepVoiceFix(modelId: string, maxAttempts: number): Promise<void> {
  const report = loadCost();
  const world = readWorld();
  for (const brief of world.portfolio) {
    const file = readChar(brief.slot);
    const contract = evaluateAuthorQualityContract(file.bible);
    if (contract.ok) continue;
    const reasons = contract.errors.map((e) => `${e.code}: ${e.message}`);
    const fields = voiceFieldsFor(contract.errors.map((e) => e.code));
    console.log(`[pilot] voice-fix slot ${brief.slot}: ${fields.join(",")} ← ${reasons.join(" | ")}`);
    await runWorkflowStep({
      report,
      draftKey: file.draftKey,
      label: `voice-fix slot ${brief.slot}`,
      maxAttempts,
      quarantineKey: `voice-${file.draftKey}`,
      run: async (transport, attempt, feedback) => {
        const { bible, completion } = await reviseOfficialCharacterVoice({
          transport,
          bible: file.bible,
          voice: {
            name: brief.name,
            age: brief.age,
            adultCandidate: brief.adultCandidate,
            speechDirection: brief.speechDirection,
            npcDemand: "기존 NPC를 유지한다(새로 만들지 않는다).",
          },
          fields,
          reasons: [...reasons, ...(feedback ? [feedback] : [])],
          modelId,
        });
        const still = evaluateAuthorQualityContract(bible);
        if (!still.ok) throw new OfficialSupplyGateError("author_contract_rejected", still.errors.map((e) => `${e.code}: ${e.message}`).join("; "), still);
        const draft = assertBibleAndDraft(bible, brief);
        const provenance = provenanceFor(completion, attempt);
        recordRun(file.draftKey, "character_bible_voice", provenance);
        writeJson(charPath(brief.slot), {
          ...file,
          bible,
          draft,
          charCount: officialSubstantiveCharCount(draft),
          revisions: [...(file.revisions ?? []), { step: "voice-fix", fields, reasons, at: provenance.createdAt, provenance }],
        });
        console.log(`[pilot] voice-fix slot ${brief.slot} ok (attempt ${attempt})`);
      },
    });
  }
}

async function stepAdultFix(modelId: string, maxAttempts: number, onlySlot?: number): Promise<void> {
  const report = loadCost();
  const world = readWorld();
  for (const brief of world.portfolio.filter((b) => !onlySlot || b.slot === onlySlot)) {
    const draftKey = draftKeyFor(brief.slot);
    const plan = ADULT_PLAN[draftKey];
    if (!plan) continue;
    const file = readChar(brief.slot);
    if (file.draft.adult.nsfw !== true) throw new Error(`${draftKey} has an adult plan but is not an adult sheet`);
    const participantMinAge = file.draft.adult.participantMinAge;
    const siblingDynamics = world.portfolio
      .filter((b) => b.slot !== brief.slot && ADULT_PLAN[draftKeyFor(b.slot)])
      .map((b) => readChar(b.slot).bible)
      .filter((b) => b.adultSection)
      .flatMap((b) => extractAdultDynamics(b.adultSection!).map((d) => ADULT_DYNAMICS[d].label));
    await runWorkflowStep({
      report,
      draftKey,
      label: `adult-fix slot ${brief.slot}`,
      maxAttempts,
      quarantineKey: `adult-${draftKey}`,
      run: async (transport, attempt, feedback) => {
        const { bible, completion } = await reviseOfficialAdultProfile({
          transport,
          bible: file.bible,
          participantMinAge,
          plan,
          siblingDynamics: [...new Set(siblingDynamics)],
          feedback,
          modelId,
        });
        const draft = assertBibleAndDraft(bible, brief);
        if (draft.adult.nsfw !== true || draft.adult.participantMinAge !== participantMinAge) {
          throw new OfficialSupplyGateError("adult_contract_drift", "participantMinAge must not change");
        }
        const provenance = provenanceFor(completion, attempt);
        recordRun(draftKey, "adult_profile", provenance);
        writeJson(charPath(brief.slot), {
          ...file,
          bible,
          draft,
          charCount: officialSubstantiveCharCount(draft),
          revisions: [
            ...(file.revisions ?? []),
            { step: "adult-fix", fields: ["adultSection"], reasons: [onlySlot ? "manifest adult plan for a replaced slot" : "adult portfolio convergence (느린 신뢰·절제, all suggestive)"], at: provenance.createdAt, provenance },
          ],
        });
        console.log(`[pilot] adult-fix slot ${brief.slot} ok (attempt ${attempt})`);
      },
    });
  }
  const files = world.portfolio.map((b) => readChar(b.slot));
  const qa = evaluateAdultPortfolioDiversity(files.map((f) => f.bible));
  console.log("[pilot] adult portfolio ok:", qa.ok, qa.errors.map((e) => e.message), qa.warnings.map((w) => w.message));
  if (!qa.ok) throw new Error("adult portfolio diversity failed");
}

/** Offline: facts-only Domestic Market Fit review of the committed cast (no scores, no rewrites). */
function stepMarketFitReview(): void {
  const world = readWorld();
  const review = buildDomesticMarketFitReview({
    world,
    snapshot: readSnapshot(),
    policy: MANIFEST.marketPolicy,
    genre: MANIFEST.genre,
    characters: world.portfolio.map((b) => {
      const file = readChar(b.slot);
      return { draftKey: file.draftKey, brief: file.brief, bible: file.bible };
    }),
  });
  writeJson(path.join(PILOT_DIR, "market-fit-review.json"), review);
  for (const row of review.rows) {
    console.log(`[pilot] ${row.draftKey} ${row.name} | ${row.primaryTrope} | "${row.publicTagline}" | ${row.findings.join(" ; ") || "-"}`);
  }
  const p = review.portfolio;
  console.log("[pilot] names:", [...p.names.errors, ...p.names.warnings].map((i) => `${i.code}: ${i.message}`));
  console.log("[pilot] tropes:", p.tropes.primaryCounts, [...p.tropes.errors, ...p.tropes.warnings].map((i) => i.message));
  console.log("[pilot] repeated tags:", p.repeatedTags);
}

async function stepStyles(modelId: string, maxAttempts: number): Promise<void> {
  const report = loadCost();
  await runWorkflowStep({
    report,
    draftKey: null,
    label: "styles",
    maxAttempts,
    quarantineKey: "styles",
    run: async (transport, attempt) => {
      const { candidates, completion } = await generateOfficialStyleBoard({
        transport,
        board: { genre: MANIFEST.genre, styleKey: MANIFEST.styleKey, allowedReferenceUrls: REFERENCE_URLS, candidateCount: 4 },
        modelId,
      });
      const provenance = provenanceFor(completion as OfficialAuthorRawCompletion, attempt);
      recordRun("style", "style_board", provenance);
      writeJson(path.join(PILOT_DIR, "style-candidates.json"), {
        styleKey: MANIFEST.styleKey,
        genre: MANIFEST.genre,
        stage: "candidates_proposed",
        candidates,
        provenance,
        note: "사용자 선택 전. candidate_approved/style_locked로 자동 진행하지 않는다.",
      });
      console.log(`[pilot] style board ok: ${candidates.length} candidates (attempt ${attempt})`);
    },
  });
}

// ── Slot replacement (briefs only; world fields and kept briefs untouched) ───

type WorldFile = {
  bible: OfficialWorldBible;
  provenances: OfficialAuthorProvenance[];
  portfolioRevisions?: { slots: number[]; replacedNames: string[]; reason: string; at: string; provenance: OfficialAuthorProvenance }[];
};

const WORLD_PATH = path.join(PILOT_DIR, "world-bible.json");

function castIntentLine(): string {
  const intent = MANIFEST.castIntent;
  return `${intent.targetAudience} · ${intent.romanceTargetProfile} · ${formatCastGenderMix(intent.desiredGenderMix)}`;
}

function castRoleEntries(briefs: readonly PortfolioBriefInput[]): CastRoleEntry[] {
  return briefs.map((b) => ({
    draftKey: draftKeyFor(b.slot),
    name: b.name,
    occupation: b.occupation,
    archetype: b.archetype,
    socialPosition: b.socialPosition,
    visualSilhouette: b.visualSilhouette,
    rpHook: b.rpHook,
    speechDirection: b.speechDirection,
  }));
}

/** Gate for re-planned briefs against the kept cast (market fit, names, tropes, roles, gender intent). */
function evaluateReplacementBriefs(
  briefs: readonly PortfolioBriefInput[],
  kept: readonly PortfolioBriefInput[],
  snapshot: ResearchSnapshot
): { errors: string[] } {
  const errors: string[] = [];
  const policy = MANIFEST.marketPolicy;
  const expected = resolveNamingProfile(MANIFEST.genre);
  for (const b of briefs) {
    if (b.age < 19) errors.push(`${b.slot}: age ${b.age} < 19`);
    if (!b.marketFit) {
      errors.push(`${b.slot}: marketFit missing`);
      continue;
    }
    const qa = validateMarketFitBrief(b.marketFit, { snapshot, policy, adultCandidate: b.adultCandidate, expectedNamingProfile: expected });
    errors.push(...qa.errors.map((e) => `${b.slot}: ${e.code}: ${e.message}`));
    if (!hasUserRelationshipCue(b.rpHook)) errors.push(`${b.slot}: rpHook does not state the user relationship`);
    const region = evaluateInternalRegionConsistency(JSON.stringify(b), internalWorldRegions(readWorld().regions));
    errors.push(...region.errors.map((e) => `${b.slot}: ${e.code}: ${e.message}`));
  }
  const cast = [...kept, ...briefs].sort((a, z) => a.slot - z.slot);
  const newNames = new Set(briefs.map((b) => b.name));
  const names = evaluateNamePortfolio(
    cast.map((b) => ({
      draftKey: draftKeyFor(b.slot),
      name: b.name,
      namingProfile: b.marketFit?.namingProfile ?? (b.gender === "other" ? "nonhuman_designation" : expected),
      kinNames: [],
    })),
    { observed: observedMarketNames(snapshot), hooks: Object.fromEntries(cast.map((b) => [draftKeyFor(b.slot), b.rpHook])) }
  );
  for (const issue of [...names.errors, ...names.warnings]) {
    // Kept names are not re-litigated; new names must come out clean.
    if ([...newNames].some((n) => issue.message.includes(n))) errors.push(`name ${issue.code}: ${issue.message}`);
  }
  const tropes = evaluateMarketTropePortfolio(
    cast.map((b) => ({
      draftKey: draftKeyFor(b.slot),
      primaryTrope: b.marketFit?.relationshipTrope.primary ?? b.relationshipTrope,
      secondaryTropes: b.marketFit?.relationshipTrope.secondary ?? [],
    })),
    policy
  );
  errors.push(...tropes.errors.map((e) => `${e.code}: ${e.message}`));
  const roles = evaluateCastRoleDiversity(castRoleEntries(cast));
  errors.push(...roles.errors.map((e) => `${e.code}: ${e.message}`));
  const intent = evaluateCastIntent(cast.map((b) => b.gender), MANIFEST.castIntent);
  errors.push(...intent.errors.map((e) => `${e.code}: ${e.message}`));
  return { errors };
}

async function stepReplaceSlots(modelId: string, maxAttempts: number): Promise<void> {
  const report = loadCost();
  const snapshot = readSnapshot();
  const worldFile = readJson<WorldFile>(WORLD_PATH);
  const world = worldFile.bible;
  const plan = MANIFEST.replacement;
  const replaced = new Set(plan.slots.map((s) => s.slot));
  const kept = world.portfolio.filter((b) => !replaced.has(b.slot));
  const current = world.portfolio.filter((b) => replaced.has(b.slot)).map((b) => b.name);
  if (current.some((name) => !plan.replacedNames.includes(name))) {
    console.log(`[pilot] replace-slots: slots already re-planned (${current.join(", ")}) — nothing to do`);
    return;
  }
  const keptSiblings = kept.map(
    (b) => `${b.name} — ${b.gender}, ${b.occupation}, ${b.archetype}, 트로프 ${b.relationshipTrope}, 훅 ${b.rpHook}, 외형 ${b.visualSilhouette}, 말투 ${b.speechDirection}`
  );
  await runWorkflowStep({
    report,
    draftKey: "world",
    label: "replace-slots",
    maxAttempts,
    quarantineKey: "portfolio-replacement",
    run: async (transport, attempt, feedback) => {
      const { briefs, completion } = await generateOfficialPortfolioReplacement({
        transport,
        replacement: {
          worldName: world.name,
          centralPremise: world.centralPremise,
          factionNames: world.factions.map((f) => f.name),
          locationNames: world.locations.map((l) => l.name),
          market: worldMarketInput(snapshot),
          castIntent: castIntentLine(),
          keptSiblings,
          slots: plan.slots,
          feedback,
        },
        modelId,
      });
      const gate = evaluateReplacementBriefs(briefs, kept, snapshot);
      if (gate.errors.length) {
        throw new OfficialSupplyGateError("author_replacement_rejected", gate.errors.join("; "));
      }
      const provenance = provenanceFor(completion, attempt);
      recordRun("world", "world_bible", provenance);
      const portfolio = [...kept, ...briefs].sort((a, z) => a.slot - z.slot);
      writeJson(WORLD_PATH, {
        ...worldFile,
        bible: { ...world, portfolio },
        portfolioRevisions: [
          ...(worldFile.portfolioRevisions ?? []),
          {
            slots: [...replaced],
            replacedNames: plan.replacedNames,
            reason: `cast intent ${formatCastGenderMix(MANIFEST.castIntent.desiredGenderMix)} (${MANIFEST.castIntent.targetAudience})`,
            at: provenance.createdAt,
            provenance,
          },
        ],
      });
      // The replaced characters' old sheets are obsolete; history stays in git.
      for (const slot of replaced) fs.rmSync(charPath(slot), { force: true });
      console.log(`[pilot] replace-slots ok (attempt ${attempt}): ${briefs.map((b) => `${b.slot} ${b.name}`).join(", ")}`);
    },
  });
}

/** Offline: human-approved public-surface decisions (tagline / tags only). */
function stepPublicFix(): void {
  const world = readWorld();
  for (const [draftKey, decision] of Object.entries(MANIFEST.publicSurfaceDecisions)) {
    const brief = world.portfolio.find((b) => draftKeyFor(b.slot) === draftKey);
    if (!brief) throw new Error(`${draftKey}: no brief`);
    const file = readChar(brief.slot);
    const profile = file.bible.publicProfile;
    let tags = [...profile.tags];
    for (const [from, to] of decision.replaceTags ?? []) tags = tags.map((t) => (t === from ? to : t));
    for (const add of decision.addTags ?? []) if (!tags.includes(add)) tags.push(add);
    const tagline = decision.tagline ?? profile.tagline;
    if (tagline === profile.tagline && JSON.stringify(tags) === JSON.stringify(profile.tags)) {
      console.log(`[pilot] public-fix ${draftKey}: already applied`);
      continue;
    }
    const bible: OfficialCharacterBible = { ...file.bible, publicProfile: { ...profile, tagline, tags } };
    const draft = assertBibleAndDraft(bible, file.brief);
    const fields = [tagline !== profile.tagline ? "tagline" : "", JSON.stringify(tags) !== JSON.stringify(profile.tags) ? "tags" : ""].filter(Boolean);
    writeJson(charPath(brief.slot), {
      ...file,
      bible,
      draft,
      charCount: officialSubstantiveCharCount(draft),
      revisions: [
        ...(file.revisions ?? []),
        { step: "public-fix", fields, reasons: ["PR #1087 human review: relationship-first tagline / grounded tags"], at: new Date().toISOString(), provenance: null },
      ],
    });
    console.log(`[pilot] public-fix ${draftKey}: ${fields.join("+")}`);
  }
}

function castIdentities(world: OfficialWorldBible): CastIdentity[] {
  return world.portfolio.map((b) => ({ draftKey: draftKeyFor(b.slot), name: b.name }));
}

/**
 * Offline: canonical relationship repair through the cast-relationship owner.
 * Aliases → canonical full names, self/removed links dropped, unknown /
 * ambiguous / duplicate targets refused, and kept characters gain minimal
 * public awareness of replaced characters that declared a public tie.
 */
function stepRelationshipRepair(): void {
  const world = readWorld();
  const cast = castIdentities(world);
  const removedNames = MANIFEST.replacement.replacedNames;
  const files = world.portfolio.map((b) => readChar(b.slot));
  const normalized = files.map((file) => {
    const n = normalizeOfficialCastRelationships(file.bible.otherRelationships, { cast, selfDraftKey: file.draftKey, removedNames });
    if (n.issues.length) throw new Error(`relationship repair refused: ${n.issues.map((i) => i.message).join("; ")}`);
    return { file, n };
  });
  const replacedKeys = MANIFEST.replacement.slots.map((s) => draftKeyFor(s.slot));
  const additions = reconcileReplacementPublicRelationships(
    normalized.map(({ file, n }) => ({
      draftKey: file.draftKey,
      name: file.bible.identity.name,
      relationships: n.relationships,
      publicRole: file.bible.identity.occupation,
    })),
    replacedKeys
  );
  for (const { file, n } of normalized) {
    const added = additions.get(file.draftKey) ?? [];
    const next = [...n.relationships, ...added];
    if (JSON.stringify(next) === JSON.stringify(file.bible.otherRelationships)) continue;
    const bible: OfficialCharacterBible = { ...file.bible, otherRelationships: next };
    const draft = assertBibleAndDraft(bible, file.brief, { checkTags: false });
    const reasons = [
      n.renamed.length ? `canonical targets: ${n.renamed.map((r) => `${r.from}→${r.to}`).join(", ")}` : "",
      n.dropped.length ? `dropped: ${n.dropped.map((d) => `${d.target} (${d.code})`).join(", ")}` : "",
      added.length ? `public awareness added: ${added.map((a) => a.target).join(", ")}` : "",
    ].filter(Boolean);
    writeJson(charPath(file.slot), {
      ...file,
      bible,
      draft,
      charCount: officialSubstantiveCharCount(draft),
      revisions: [
        ...(file.revisions ?? []),
        { step: "relationship-repair", fields: ["otherRelationships"], reasons, at: new Date().toISOString(), provenance: null },
      ],
    });
    console.log(`[pilot] relationship-repair ${file.draftKey}: ${reasons.join(" | ")}`);
  }
}

function patchString(root: Record<string, unknown>, dotted: string, from: string, to: string): "applied" | "already" {
  const keys = dotted.split(".");
  let node: unknown = root;
  for (const key of keys.slice(0, -1)) node = (node as Record<string, unknown>)[key];
  const leaf = keys[keys.length - 1]!;
  const holder = node as Record<string, unknown>;
  const value = holder?.[leaf];
  if (typeof value !== "string") throw new Error(`consistency patch: ${dotted} is not a string`);
  if (value.includes(from)) {
    holder[leaf] = value.replace(from, to);
    return "applied";
  }
  if (value.includes(to)) return "already";
  throw new Error(`consistency patch: ${dotted} no longer contains the expected text`);
}

function replaceTermsDeep<T>(value: T, terms: readonly [string, string][]): T {
  if (typeof value === "string") return terms.reduce((s, [a, b]) => s.split(a).join(b), value as string) as T;
  if (Array.isArray(value)) return value.map((v) => replaceTermsDeep(v, terms)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, replaceTermsDeep(v, terms)])) as T;
  }
  return value;
}

/** Offline: manifest-declared world-consistency repairs for one sheet (brief, bible, asset-plan and scene-context wording). */
function stepConsistencyFix(): void {
  const worldFile = readJson<WorldFile>(WORLD_PATH);
  for (const patch of MANIFEST.consistencyPatches) {
    const slot = Number(patch.draftKey.slice(-2));
    const file = readChar(slot);
    const root = JSON.parse(JSON.stringify({ brief: file.brief, bible: file.bible })) as Record<string, unknown>;
    const applied = patch.rewrites.map(([dotted, from, to]) => patchString(root, dotted, from, to));
    const fixed = replaceTermsDeep(root, patch.terms) as { brief: PortfolioBriefInput; bible: OfficialCharacterBible };
    const assetPlan = file.assetPlan ? replaceTermsDeep(file.assetPlan, patch.terms) : file.assetPlan;
    const sceneContext = file.sceneContext ? replaceTermsDeep(file.sceneContext, patch.terms) : file.sceneContext;
    if (
      JSON.stringify(fixed) === JSON.stringify({ brief: file.brief, bible: file.bible }) &&
      JSON.stringify(assetPlan) === JSON.stringify(file.assetPlan) &&
      JSON.stringify(sceneContext) === JSON.stringify(file.sceneContext)
    ) {
      console.log(`[pilot] consistency-fix ${patch.draftKey}: already applied`);
      continue;
    }
    const draft = assertBibleAndDraft(fixed.bible, fixed.brief);
    if (assetPlan) {
      const planQa = validatePilotAssetPlan(draft, assetPlan);
      if (!planQa.ok) throw new Error(`consistency-fix ${patch.draftKey}: asset plan ${planQa.errors.map((e) => e.code).join(",")}`);
    }
    worldFile.bible.portfolio = worldFile.bible.portfolio.map((b) => (b.slot === slot ? fixed.brief : b));
    writeJson(WORLD_PATH, worldFile);
    writeJson(charPath(slot), {
      ...file,
      brief: fixed.brief,
      bible: fixed.bible,
      draft,
      assetPlan,
      sceneContext,
      charCount: officialSubstantiveCharCount(draft),
      revisions: [
        ...(file.revisions ?? []),
        {
          step: "consistency-fix",
          fields: ["brief", "identity", "backstory", "situation", "publicProfile", "wording"],
          reasons: [patch.reason, `rewrites ${applied.filter((a) => a === "applied").length}/${applied.length}; terms ${patch.terms.map(([a, b]) => `${a}→${b}`).join(", ")}`],
          at: new Date().toISOString(),
          provenance: null,
        },
      ],
    });
    console.log(`[pilot] consistency-fix ${patch.draftKey}: ${applied.filter((a) => a === "applied").length} rewrites + terms`);
  }
}

function parseArgs(): { step: string; slot?: number; from?: number; concurrency: number; maxAttempts: number } {
  const args = process.argv.slice(2);
  const get = (key: string): string | undefined => {
    const hit = args.find((a) => a.startsWith(`--${key}=`));
    return hit?.slice(key.length + 3);
  };
  return {
    step: get("step") ?? "portfolio-qa",
    slot: get("slot") ? Number(get("slot")) : undefined,
    from: get("from") ? Number(get("from")) : undefined,
    concurrency: Number(get("concurrency") ?? 2),
    maxAttempts: Number(get("attempts") ?? 3),
  };
}

async function main(): Promise<void> {
  const { step, slot, from, concurrency, maxAttempts } = parseArgs();
  const offline = ["portfolio-qa", "cost-reconcile", "market-fit-review", "public-fix", "relationship-repair", "consistency-fix"].includes(step);
  if (!offline && process.env.OFFICIAL_PILOT_LIVE !== "1") {
    console.error("[pilot] refusing: set OFFICIAL_PILOT_LIVE=1 to run live provider generation.");
    process.exit(2);
  }
  ensureDirs();
  writeJson(path.join(PILOT_DIR, "manifest.json"), MANIFEST);
  const modelId = resolveOfficialAuthorModelId();
  console.log(`[pilot] step=${step} model=${modelId} concurrency=${concurrency} attempts=${maxAttempts}`);
  switch (step) {
    case "world":
      return stepWorld(modelId, maxAttempts);
    case "characters":
      return stepCharacters(modelId, maxAttempts, concurrency);
    case "character":
      if (!slot) throw new Error("--step=character requires --slot=N");
      return stepCharacters(modelId, maxAttempts, 1, slot);
    case "portfolio-qa":
      return stepPortfolioQa();
    case "appearance":
      return stepAppearance(modelId, maxAttempts, slot);
    case "replace-slots":
      return stepReplaceSlots(modelId, maxAttempts);
    case "public-fix":
      return stepPublicFix();
    case "relationship-repair":
      return stepRelationshipRepair();
    case "consistency-fix":
      return stepConsistencyFix();
    case "assetplan":
      return stepAssetPlans(modelId, maxAttempts, slot, from);
    case "voice-fix":
      return stepVoiceFix(modelId, maxAttempts);
    case "adult-fix":
      return stepAdultFix(modelId, maxAttempts, slot);
    case "styles":
      return stepStyles(modelId, maxAttempts);
    case "cost-reconcile":
      return stepCostReconcile();
    case "market-fit-review":
      return stepMarketFitReview();
    default:
      throw new Error(`unknown step ${step}`);
  }
}

main()
  .then(() => console.log("[pilot] done."))
  .catch((error) => {
    console.error("[pilot] fatal:", (error as Error).stack ?? error);
    process.exit(1);
  });
