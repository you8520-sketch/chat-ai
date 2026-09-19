/**
 * Deterministic episodic capture quality benchmark (CQ-01..CQ-25).
 *
 * Cursor does NOT assign quality scores. Fixtures, pipeline stage outputs,
 * required/forbidden concepts, and failure taxonomy are artifacts for
 * GPT/user evaluation. No live provider calls.
 */
import Module from "module";

const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";
import {
  persistEpisodicMemoryFactsCore,
  summarizeEpisodicFactPersistCandidates,
} from "@/lib/episodicMemoryFacts";
import { EPISODIC_FACTS_EXTRACT_INSTRUCTIONS } from "./memory-episodic-prompt";
import { sanitizeEpisodicExtractedFacts } from "./memory-episodic-normalize";
import {
  EPISODIC_FACTS_MAX_PER_SHARED_TURN,
  parseSharedEpisodicSection,
} from "./memory-episodic-shared";
import type { EpisodicExtractedFact } from "./memory-episodic-types";

export type CaptureFailureClass =
  | "EXTRACTION_MISS"
  | "SCHEMA_LOSS"
  | "VALIDATION_LOSS"
  | "CAPACITY_RANKING_LOSS"
  | "CONSOLIDATION_FAILURE"
  | "NONE"
  | "EXPECTED_OMIT";

export type PipelineStageTrace = {
  stage: string;
  count: number;
  facts: EpisodicExtractedFact[];
  dropped?: number;
  note?: string;
};

export type CqBenchmarkCase = {
  id: string;
  title: string;
  scenario: string;
  sourceUserText?: string;
  /** Ideal model output for MUST CAPTURE cases; [] for OMIT cases. */
  goldenFacts: EpisodicExtractedFact[];
  requiredConcepts: string[];
  forbiddenConcepts: string[];
  /** Deterministic prompt-level risk (no live model). */
  promptLevelRisk?: CaptureFailureClass;
  promptRiskReason?: string;
  expectRuntimePersist: boolean;
};

const CHAT = 972001;
const USER = 972002;
const CHAR = 972003;

function fact(
  partial: EpisodicExtractedFact
): EpisodicExtractedFact {
  return partial;
}

/** Trace facts through sanitize → shared parse → persist summary stages. */
export function traceEpisodicCapturePipeline(
  rawFacts: unknown[],
  opts: { sourceUserText?: string } = {}
): PipelineStageTrace[] {
  const traces: PipelineStageTrace[] = [];
  traces.push({
    stage: "raw_model_output",
    count: rawFacts.length,
    facts: Array.isArray(rawFacts) ? (rawFacts as EpisodicExtractedFact[]) : [],
  });

  const sanitized = sanitizeEpisodicExtractedFacts(rawFacts, { requireEvidence: true });
  traces.push({
    stage: "sanitize_require_evidence",
    count: sanitized.length,
    facts: sanitized,
    dropped: rawFacts.length - sanitized.length,
  });

  const sharedParse = parseSharedEpisodicSection({ extracted_facts: rawFacts });
  traces.push({
    stage: "shared_initial_parse",
    count: sharedParse.facts.length,
    facts: sharedParse.facts,
    note: sharedParse.valid ? "valid" : "invalid_or_empty",
  });

  const summary = summarizeEpisodicFactPersistCandidates(rawFacts, {
    sourceUserText: opts.sourceUserText,
  });
  traces.push({
    stage: "persist_insertable",
    count: summary.insertableCount,
    facts: summary.insertable,
    dropped: summary.skippedCount,
    note: summary.skippedReasons.join("; ") || undefined,
  });

  return traces;
}

function classifyRuntimeFailure(
  cq: CqBenchmarkCase,
  traces: PipelineStageTrace[]
): CaptureFailureClass {
  if (!cq.expectRuntimePersist) return "EXPECTED_OMIT";
  if (cq.goldenFacts.length === 0) return cq.promptLevelRisk ?? "EXTRACTION_MISS";

  const raw = traces[0]?.count ?? 0;
  const sanitized = traces[1]?.count ?? 0;
  const insertable = traces[3]?.count ?? 0;

  if (raw === 0) return "EXTRACTION_MISS";
  if (sanitized === 0 && raw > 0) return "SCHEMA_LOSS";
  if (insertable === 0 && sanitized > 0) return "VALIDATION_LOSS";
  if (insertable < Math.min(cq.goldenFacts.length, EPISODIC_FACTS_MAX_PER_SHARED_TURN)) {
    return "CAPACITY_RANKING_LOSS";
  }
  return "NONE";
}

export const CQ_BENCHMARK_CASES: CqBenchmarkCase[] = [
  {
    id: "CQ-01",
    title: "Identity disclosure",
    scenario: "User explicitly reveals durable real name.",
    sourceUserText: "내 진짜 이름은 박서윤이야. 앞으로 이렇게 불러.",
    goldenFacts: [
      fact({
        category: "character",
        subject: "user",
        attribute: "real_name",
        value: "park_seoyoon",
        importance: "critical",
        fact_text: "유저는 자신의 진짜 이름이 박서윤이라고 명시적으로 밝혔다.",
        evidence_type: "explicit_user_statement",
      }),
    ],
    requiredConcepts: ["real_name", "박서윤", "explicit_user_statement"],
    forbiddenConcepts: ["inferred_identity"],
    expectRuntimePersist: true,
  },
  {
    id: "CQ-02",
    title: "Relationship milestone",
    scenario: "Explicit relationship status change by mutual agreement.",
    goldenFacts: [
      fact({
        category: "relationship",
        subject: "char_user",
        attribute: "relationship_status",
        value: "lovers",
        importance: "critical",
        fact_text: "캐릭터와 유저는 서로 연인이 되기로 명시적으로 합의했다.",
        evidence_type: "explicit_scene_event",
      }),
    ],
    requiredConcepts: ["relationship_status", "lovers", "explicit agreement"],
    forbiddenConcepts: ["inferred_dating"],
    expectRuntimePersist: true,
  },
  {
    id: "CQ-03",
    title: "Betrayal",
    scenario: "Major betrayal event with future continuity impact.",
    goldenFacts: [
      fact({
        category: "relationship",
        subject: "char_user",
        attribute: "betrayal_event",
        value: "alliance_broken",
        importance: "critical",
        fact_text: "캐릭터는 유저의 신뢰를 배신해 동맹을 깨뜨렸다.",
        evidence_type: "explicit_scene_event",
      }),
    ],
    requiredConcepts: ["betrayal", "alliance_broken"],
    forbiddenConcepts: ["personality_label"],
    expectRuntimePersist: true,
  },
  {
    id: "CQ-04",
    title: "Reconciliation",
    scenario: "Major conflict resolution affecting future state.",
    goldenFacts: [
      fact({
        category: "relationship",
        subject: "char_user",
        attribute: "conflict_resolution",
        value: "reconciled",
        importance: "important",
        fact_text: "캐릭터와 유저는 큰 갈등 후 서로 오해를 풀고 화해했다.",
        evidence_type: "explicit_scene_event",
      }),
    ],
    requiredConcepts: ["reconciled", "conflict_resolution"],
    forbiddenConcepts: [],
    expectRuntimePersist: true,
  },
  {
    id: "CQ-05",
    title: "Secret disclosure",
    scenario: "Important secret revealed with attribution.",
    goldenFacts: [
      fact({
        category: "character",
        subject: "char",
        attribute: "hidden_identity",
        value: "guild_member",
        importance: "critical",
        fact_text: "캐릭터는 자신이 길드원이라는 비밀을 유저에게 밝혔다.",
        evidence_type: "explicit_character_claim",
      }),
    ],
    requiredConcepts: ["secret", "attribution", "explicit_character_claim"],
    forbiddenConcepts: ["objective_canon_state"],
    expectRuntimePersist: true,
  },
  {
    id: "CQ-06",
    title: "Durable preference",
    scenario: "Explicit current-user durable preference.",
    sourceUserText: "나는 앞으로도 항상 3인칭 서술을 선호해.",
    goldenFacts: [
      fact({
        category: "preference",
        subject: "user",
        attribute: "narration_style",
        value: "third_person",
        importance: "important",
        fact_text: "유저는 앞으로 항상 3인칭 서술을 선호한다고 명시했다.",
        evidence_type: "explicit_user_statement",
      }),
    ],
    requiredConcepts: ["preference", "third_person"],
    forbiddenConcepts: [],
    expectRuntimePersist: true,
  },
  {
    id: "CQ-07",
    title: "Explicit role/position preference",
    scenario: "Current-turn explicit durable roleplay position preference.",
    sourceUserText: "나는 앞으로 항상 탑 포지션으로 진행하고 싶어.",
    goldenFacts: [
      fact({
        category: "preference",
        subject: "user",
        attribute: "roleplay_position",
        value: "top",
        importance: "important",
        fact_text: "유저는 앞으로 항상 탑 포지션으로 진행하고 싶다고 명시했다.",
        evidence_type: "explicit_user_statement",
      }),
    ],
    requiredConcepts: ["roleplay_position", "top"],
    forbiddenConcepts: ["inferred_from_scene"],
    expectRuntimePersist: true,
  },
  {
    id: "CQ-08",
    title: "Boundary / prohibition",
    scenario: "Explicit durable boundary.",
    sourceUserText: "앞으로는 신체 접촉 묘사는 하지 말아줘.",
    goldenFacts: [
      fact({
        category: "rule",
        subject: "user",
        attribute: "physical_contact_boundary",
        value: "prohibited",
        importance: "critical",
        fact_text: "유저는 앞으로 신체 접촉 묘사를 금지하는 경계를 명시했다.",
        evidence_type: "explicit_user_statement",
      }),
    ],
    requiredConcepts: ["boundary", "prohibited"],
    forbiddenConcepts: [],
    expectRuntimePersist: true,
  },
  {
    id: "CQ-09",
    title: "Consequential distinctive utterance",
    scenario:
      'USER: "너 싸우는 거 보면 아직 아마추어 같아." → evaluation provokes rivalry reaction.',
    sourceUserText: "너 싸우는 거 보면 아직 아마추어 같아.",
    goldenFacts: [
      fact({
        category: "relationship",
        subject: "ren_user",
        attribute: "evaluation_event",
        value: "amateur_critique",
        importance: "important",
        fact_text: "유저는 렌의 실력을 아마추어 같다고 평가해 렌의 반발을 불러냈다.",
        evidence_type: "explicit_scene_event",
      }),
    ],
    requiredConcepts: ["evaluation", "amateur_critique", "reaction"],
    forbiddenConcepts: ["raw_dialogue_dump", "personality_inference"],
    promptLevelRisk: "EXTRACTION_MISS",
    promptRiskReason:
      "Prompt L26 limits dialogue capture to decision/rule/boundary/preference/disclosure; evaluation may be omitted by model.",
    expectRuntimePersist: true,
  },
  {
    id: "CQ-10",
    title: "Important praise / insult",
    scenario: "Distinctive evaluation with long-term callback value.",
    goldenFacts: [
      fact({
        category: "relationship",
        subject: "char_user",
        attribute: "evaluation_event",
        value: "coward_label",
        importance: "important",
        fact_text: "유저는 캐릭터를 겁쟁이라고 평가해 캐릭터의 분노를 불러냈다.",
        evidence_type: "explicit_scene_event",
      }),
    ],
    requiredConcepts: ["insult", "evaluation_event"],
    forbiddenConcepts: ["raw_quote_only"],
    promptLevelRisk: "EXTRACTION_MISS",
    promptRiskReason: "Same dialogue gate as CQ-09 unless framed as historical significance.",
    expectRuntimePersist: true,
  },
  {
    id: "CQ-11",
    title: "Nickname / shared phrase",
    scenario: "Meaningful recurring nickname established.",
    goldenFacts: [
      fact({
        category: "relationship",
        subject: "char_user",
        attribute: "shared_nickname",
        value: "little_star",
        importance: "normal",
        fact_text: "캐릭터와 유저는 서로를 별똥별이라 부르기로 했다.",
        evidence_type: "explicit_scene_event",
      }),
    ],
    requiredConcepts: ["nickname", "shared_phrase"],
    forbiddenConcepts: ["raw_dialogue_only"],
    promptLevelRisk: "EXTRACTION_MISS",
    promptRiskReason: "Nickname may be treated as dialogue unless explicitly durable.",
    expectRuntimePersist: true,
  },
  {
    id: "CQ-12",
    title: "Important location discovery",
    scenario: "Plot-relevant location discovered.",
    goldenFacts: [
      fact({
        category: "location",
        subject: "hidden_sanctuary",
        attribute: "discovery",
        value: "found",
        importance: "important",
        fact_text: "유저와 캐릭터는 숨겨진 성역의 위치를 발견했다.",
        evidence_type: "explicit_scene_event",
      }),
    ],
    requiredConcepts: ["location", "discovery"],
    forbiddenConcepts: [],
    expectRuntimePersist: true,
  },
  {
    id: "CQ-13",
    title: "Goal / quest",
    scenario: "New durable objective.",
    goldenFacts: [
      fact({
        category: "quest",
        subject: "party",
        attribute: "objective",
        value: "find_artifact",
        importance: "important",
        fact_text: "유저와 캐릭터는 잃어버린 유물을 찾는 것을 새 목표로 삼았다.",
        evidence_type: "explicit_scene_event",
      }),
    ],
    requiredConcepts: ["quest", "objective"],
    forbiddenConcepts: ["ledger_promise"],
    expectRuntimePersist: true,
  },
  {
    id: "CQ-14",
    title: "Character claim",
    scenario: "Character claims hidden identity; must preserve attribution.",
    goldenFacts: [
      fact({
        category: "character",
        subject: "char",
        attribute: "claimed_status",
        value: "royal_blood",
        importance: "important",
        fact_text: "캐릭터는 자신이 왕족 혈통이라고 주장했다.",
        evidence_type: "explicit_character_claim",
      }),
    ],
    requiredConcepts: ["attribution", "claimed_status"],
    forbiddenConcepts: ["objective_truth"],
    expectRuntimePersist: true,
  },
  {
    id: "CQ-15",
    title: "Greeting / small talk",
    scenario: "Pure greeting — should omit.",
    goldenFacts: [],
    requiredConcepts: [],
    forbiddenConcepts: ["greeting_stored"],
    expectRuntimePersist: false,
  },
  {
    id: "CQ-16",
    title: "Temporary emotion",
    scenario: "Transient feeling without durable fact.",
    goldenFacts: [],
    requiredConcepts: [],
    forbiddenConcepts: ["temporary_emotion_stored"],
    expectRuntimePersist: false,
  },
  {
    id: "CQ-17",
    title: "Mundane action",
    scenario: "walk/look/sit without durable consequence.",
    goldenFacts: [],
    requiredConcepts: [],
    forbiddenConcepts: ["mundane_action_stored"],
    expectRuntimePersist: false,
  },
  {
    id: "CQ-18",
    title: "Transient combat state",
    scenario: "Momentary stance/damage without durable consequence.",
    goldenFacts: [],
    requiredConcepts: [],
    forbiddenConcepts: ["transient_combat_stored"],
    expectRuntimePersist: false,
  },
  {
    id: "CQ-19",
    title: "Assistant psychological inference",
    scenario: "One-scene possessive/psychopathic label — must omit.",
    goldenFacts: [
      fact({
        category: "character",
        subject: "char",
        attribute: "personality_change",
        value: "possessive",
        importance: "important",
        fact_text: "캐릭터는 유저에게 극단적인 소유욕을 가진 인물로 변했다.",
        evidence_type: "explicit_scene_event",
      }),
    ],
    requiredConcepts: [],
    forbiddenConcepts: ["possessive", "personality_change"],
    expectRuntimePersist: false,
  },
  {
    id: "CQ-20",
    title: "Promise — Relationship Ledger owner",
    scenario: "Promise must not be stored in episodic.",
    goldenFacts: [
      fact({
        category: "relationship",
        subject: "char_user",
        attribute: "promise",
        value: "return_tomorrow",
        importance: "important",
        fact_text: "캐릭터는 내일 반드시 돌아오겠다고 약속했다.",
        evidence_type: "explicit_scene_event",
      }),
    ],
    requiredConcepts: [],
    forbiddenConcepts: ["promise", "relationship_ledger_owned"],
    expectRuntimePersist: false,
  },
  {
    id: "CQ-21",
    title: "Item ownership / transfer — Ledger owner",
    scenario: "Item transfer must not be stored in episodic.",
    goldenFacts: [
      fact({
        category: "item",
        subject: "sword",
        attribute: "ownership",
        value: "transferred_to_user",
        importance: "important",
        fact_text: "캐릭터는 검을 유저에게 건네주었다.",
        evidence_type: "explicit_scene_event",
      }),
    ],
    requiredConcepts: [],
    forbiddenConcepts: ["ownership", "relationship_ledger_owned"],
    expectRuntimePersist: false,
  },
  {
    id: "CQ-22",
    title: "Canon repeat",
    scenario: "Restating existing canon — omit from episodic.",
    goldenFacts: [],
    requiredConcepts: [],
    forbiddenConcepts: ["canon_duplication"],
    expectRuntimePersist: false,
  },
  {
    id: "CQ-23",
    title: "Repeated durable fact",
    scenario: "Same preference repeated across turns — audit consolidation.",
    goldenFacts: [
      fact({
        category: "preference",
        subject: "user",
        attribute: "favorite_drink",
        value: "syrup_coffee",
        importance: "important",
        fact_text: "사용자는 커피에 시럽을 두 번 넣어 마신다.",
        evidence_type: "explicit_user_statement",
      }),
    ],
    requiredConcepts: ["duplicate_accumulation_audit"],
    forbiddenConcepts: [],
    expectRuntimePersist: true,
  },
  {
    id: "CQ-24",
    title: "Changed fact",
    scenario: "Explicit previous durable fact changes — latest value audit.",
    goldenFacts: [
      fact({
        category: "preference",
        subject: "user",
        attribute: "favorite_drink",
        value: "black_coffee",
        importance: "important",
        fact_text: "사용자는 이제 커피에 시럽을 넣지 않는다고 명시했다.",
        evidence_type: "explicit_user_statement",
      }),
    ],
    requiredConcepts: ["changed_preference"],
    forbiddenConcepts: [],
    expectRuntimePersist: true,
  },
  {
    id: "CQ-25",
    title: "Overloaded salient turn",
    scenario: "5+ salient candidates in one turn — max-3 survival audit.",
    goldenFacts: [
      fact({
        category: "character",
        subject: "user",
        attribute: "real_name",
        value: "park_seoyoon",
        importance: "critical",
        fact_text: "유저는 자신의 진짜 이름이 박서윤이라고 명시적으로 밝혔다.",
        evidence_type: "explicit_user_statement",
      }),
      fact({
        category: "relationship",
        subject: "char_user",
        attribute: "relationship_status",
        value: "lovers",
        importance: "critical",
        fact_text: "캐릭터와 유저는 서로 연인이 되기로 명시적으로 합의했다.",
        evidence_type: "explicit_scene_event",
      }),
      fact({
        category: "relationship",
        subject: "char_user",
        attribute: "betrayal_event",
        value: "alliance_broken",
        importance: "critical",
        fact_text: "캐릭터는 유저의 신뢰를 배신해 동맹을 깨뜨렸다.",
        evidence_type: "explicit_scene_event",
      }),
      fact({
        category: "character",
        subject: "char",
        attribute: "hidden_identity",
        value: "guild_member",
        importance: "critical",
        fact_text: "캐릭터는 자신이 길드원이라는 비밀을 유저에게 밝혔다.",
        evidence_type: "explicit_character_claim",
      }),
      fact({
        category: "relationship",
        subject: "ren_user",
        attribute: "evaluation_event",
        value: "amateur_critique",
        importance: "important",
        fact_text: "유저는 렌의 실력을 아마추어 같다고 평가해 렌의 반발을 불러냈다.",
        evidence_type: "explicit_scene_event",
      }),
      fact({
        category: "location",
        subject: "current_room",
        attribute: "scene_location",
        value: "tavern",
        importance: "normal",
        fact_text: "유저와 캐릭터는 현재 선술집에 있다.",
        evidence_type: "explicit_scene_event",
      }),
    ],
    requiredConcepts: ["max_3_survival_order", "identity", "relationship", "betrayal", "secret"],
    forbiddenConcepts: [],
    expectRuntimePersist: true,
  },
];

function cleanup() {
  const db = getDb();
  db.prepare("DELETE FROM episodic_memory_facts WHERE chat_id=?").run(CHAT);
  db.prepare("DELETE FROM chats WHERE id=?").run(CHAT);
  db.prepare("DELETE FROM users WHERE id=?").run(USER);
  db.prepare("DELETE FROM characters WHERE id=?").run(CHAR);
}

before(() => installIsolatedTestDatabase());
after(() => uninstallIsolatedTestDatabase());

before(() => {
  cleanup();
  const db = getDb();
  db.prepare(`INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`).run(
    USER,
    `cq-${USER}@test.local`,
    "cq",
    "x"
  );
  db.prepare(`INSERT INTO characters (id, name) VALUES (?,?)`).run(CHAR, "CqChar");
  db.prepare(`INSERT INTO chats (id, user_id, character_id, mode) VALUES (?,?,?,'safe')`).run(
    CHAT,
    USER,
    CHAR
  );
});

after(() => cleanup());

describe("episodic capture quality benchmark CQ-01..25", () => {
  const matrix: Array<{
    id: string;
    runtimeFailureClass: CaptureFailureClass;
    promptLevelRisk: CaptureFailureClass | null;
    pipeline: PipelineStageTrace[];
    insertableCount: number;
  }> = [];

  for (const cq of CQ_BENCHMARK_CASES) {
    it(`${cq.id} traces pipeline stages (no quality score)`, () => {
      const traces = traceEpisodicCapturePipeline(cq.goldenFacts, {
        sourceUserText: cq.sourceUserText,
      });
      const runtimeClass = classifyRuntimeFailure(cq, traces);
      const insertable = traces[3]?.count ?? 0;

      matrix.push({
        id: cq.id,
        runtimeFailureClass: runtimeClass,
        promptLevelRisk: cq.promptLevelRisk ?? null,
        pipeline: traces,
        insertableCount: insertable,
      });

      if (cq.expectRuntimePersist) {
        assert.ok(
          insertable > 0,
          `${cq.id}: golden facts should survive runtime pipeline`
        );
      } else if (cq.goldenFacts.length > 0) {
        assert.equal(
          insertable,
          0,
          `${cq.id}: forbidden facts should be blocked by validation`
        );
      } else {
        assert.equal(insertable, 0, `${cq.id}: omit case should persist nothing`);
      }
    });
  }

  it("CQ-25 max-3 preserves first three in model output order (no importance sort)", () => {
    const cq = CQ_BENCHMARK_CASES.find((c) => c.id === "CQ-25");
    assert.ok(cq);
    const summary = summarizeEpisodicFactPersistCandidates(cq.goldenFacts);
    assert.equal(summary.insertableCount, EPISODIC_FACTS_MAX_PER_SHARED_TURN);
    assert.deepEqual(
      summary.insertable.map((f) => f.attribute),
      ["real_name", "relationship_status", "betrayal_event"]
    );
  });

  it("CQ-23/CQ-24 cross-turn DB accumulates duplicates; recall latest-wins by cat:subj:attr", () => {
    const db = getDb();
    const base = CQ_BENCHMARK_CASES.find((c) => c.id === "CQ-23")!.goldenFacts[0];
    const changed = CQ_BENCHMARK_CASES.find((c) => c.id === "CQ-24")!.goldenFacts[0];

    persistEpisodicMemoryFactsCore(db, {
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      sourceTurn: 10,
      sourceUserMessageId: 1001,
      sourceUserText: "커피에 시럽 두 번",
      facts: [base],
    });
    persistEpisodicMemoryFactsCore(db, {
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      sourceTurn: 11,
      sourceUserMessageId: 1002,
      sourceUserText: "이제 시럽 안 넣어",
      facts: [changed],
    });

    const rows = db
      .prepare(
        `SELECT source_turn, attribute, value FROM episodic_memory_facts
         WHERE chat_id=? AND attribute='favorite_drink' ORDER BY source_turn`
      )
      .all(CHAT) as Array<{ source_turn: number; attribute: string; value: string }>;

    assert.equal(rows.length, 2, "CONSOLIDATION: write path keeps both turns (no merge)");
    assert.deepEqual(
      rows.map((r) => r.value),
      ["syrup_coffee", "black_coffee"]
    );
  });

  it("writes benchmark matrix artifact for external evaluation", () => {
    const reportDir = join(process.cwd(), "docs", "audits", "episodic-capture-quality");
    mkdirSync(reportDir, { recursive: true });

    const payload = {
      generated_at: new Date().toISOString(),
      main_commit: "d20d4a21b55ca0024a6b01b53d0dc8e9f502b1a7",
      canonical_extraction_owner: "EPISODIC_FACTS_EXTRACT_INSTRUCTIONS",
      max_facts_per_turn: EPISODIC_FACTS_MAX_PER_SHARED_TURN,
      note: "Cursor does not assign quality scores. Evaluate required/forbidden concepts externally.",
      cases: CQ_BENCHMARK_CASES.map((cq) => {
        const traces = traceEpisodicCapturePipeline(cq.goldenFacts, {
          sourceUserText: cq.sourceUserText,
        });
        return {
          id: cq.id,
          title: cq.title,
          scenario: cq.scenario,
          required_concepts: cq.requiredConcepts,
          forbidden_concepts: cq.forbiddenConcepts,
          golden_fact_count: cq.goldenFacts.length,
          prompt_level_risk: cq.promptLevelRisk ?? null,
          prompt_risk_reason: cq.promptRiskReason ?? null,
          runtime_failure_class: classifyRuntimeFailure(cq, traces),
          pipeline_stages: traces.map((t) => ({
            stage: t.stage,
            count: t.count,
            dropped: t.dropped ?? 0,
            note: t.note ?? null,
            fact_keys: t.facts.map(
              (f) => `${f.category}:${f.subject}:${f.attribute}:${f.value}`
            ),
          })),
        };
      }),
      matrix,
    };

    writeFileSync(
      join(reportDir, "benchmark-matrix.json"),
      `${JSON.stringify(payload, null, 2)}\n`,
      "utf8"
    );
    assert.ok(matrix.length >= 25);
  });
});

describe("prompt dialogue rule deterministic analysis", () => {
  it("CQ-09 post-patch allows consequential speech as historical significance", () => {
    assert.ok(
      EPISODIC_FACTS_EXTRACT_INSTRUCTIONS.includes("consequential speech"),
      "patch: evaluation/insult/nickname path documented in canonical owner"
    );
    assert.ok(
      !EPISODIC_FACTS_EXTRACT_INSTRUCTIONS.includes(
        "Dialogue is only saved when it produces a durable decision"
      ),
      "removed blanket dialogue gate that excluded evaluations"
    );
  });
});
