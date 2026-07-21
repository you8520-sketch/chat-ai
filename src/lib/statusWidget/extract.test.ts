import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_STATUS_WIDGET } from "./defaultTemplate";
import {
  buildWidgetExtractSystem,
  buildWidgetExtractUserBlock,
  normalizeWidgetExtraction,
} from "./extractNormalize";
import { allocateWidgetExtractNarrativeSlices } from "./proseStrip";
import { collectWidgetJsonKeys } from "./prompt";
import { parseStatusWidgetJson, serializeStatusWidget } from "./serialize";

describe("statusWidget extract", () => {
  it("collectWidgetJsonKeys includes field keys and template placeholders", () => {
    const keys = collectWidgetJsonKeys(DEFAULT_STATUS_WIDGET);
    assert.ok(keys.includes("시간"));
    assert.ok(keys.includes("장소"));
    assert.ok(keys.includes("속마음"));
    assert.ok(keys.includes("현재상황"));
    assert.ok(keys.includes("의식의흐름"));
  });

  it("normalizeWidgetExtraction maps id/label keys and rejects placeholders", () => {
    const normalized = normalizeWidgetExtraction(
      {
        시간: "14:30",
        장소: "<scene value>",
        속마음: "…",
        현재상황: "대화 중",
      },
      DEFAULT_STATUS_WIDGET
    );
    assert.equal(normalized["시간"], "14:30");
    assert.equal(normalized["현재상황"], "대화 중");
    assert.equal(normalized["장소"], undefined);
    assert.equal(normalized["속마음"], undefined);
  });

  it("normalizeWidgetExtraction does not backfill from previous turn values", () => {
    const normalized = normalizeWidgetExtraction({ 시간: "15:00" }, DEFAULT_STATUS_WIDGET);
    assert.equal(normalized["시간"], "15:00");
    assert.equal(normalized["장소"], undefined);
    assert.equal(normalized["속마음"], undefined);
    assert.equal(normalized["현재상황"], undefined);
  });

  it("serializeStatusWidget round-trips optional initialValue without breaking legacy widgets", () => {
    const legacy = parseStatusWidgetJson(
      JSON.stringify({
        version: 1,
        name: "상태창",
        htmlTemplate: "{{날짜}}",
        fields: [{ id: "date", label: "날짜", instruction: "n월 n일 형식" }],
        placement: "bottom",
      })
    );
    assert.ok(legacy);
    assert.equal(legacy!.fields[0]!.initialValue, undefined);

    const withInit = {
      ...DEFAULT_STATUS_WIDGET,
      fields: [
        {
          id: "date",
          label: "날짜",
          instruction: "n월 n일 형식",
          initialValue: "3월 18일",
        },
      ],
    };
    const parsed = parseStatusWidgetJson(serializeStatusWidget(withInit));
    assert.ok(parsed);
    assert.equal(parsed!.fields[0]!.initialValue, "3월 18일");
  });

  it("buildWidgetExtractSystem lists required JSON keys", () => {
    const system = buildWidgetExtractSystem(DEFAULT_STATUS_WIDGET, collectWidgetJsonKeys(DEFAULT_STATUS_WIDGET));
    assert.match(system, /"시간"/);
    assert.match(system, /Never copy placeholders/);
  });

  it("buildWidgetExtractSystem anchors extraction to the LAST scene (chat39 multi-scene regression)", () => {
    // chat39 turn 769: 새벽 3시 사령실 → *** 스킵 → 다음날 오후 8시 렌 저택.
    // Extractor must still prefer END-of-turn / LAST scene over an earlier clock.
    const system = buildWidgetExtractSystem(DEFAULT_STATUS_WIDGET, collectWidgetJsonKeys(DEFAULT_STATUS_WIDGET));
    assert.match(system, /END of this turn/);
    assert.match(system, /LAST scene/);
    assert.match(system, /time skips/i);
    assert.match(system, /explicit prose\/user/);
    assert.match(system, /\[PREVIOUS TURN WIDGET VALUES\] canonical anchor/);
  });

  it("buildWidgetExtractSystem initializes calendar/clock fields on first fill without requiring prose", () => {
    // Verbose examples live here (not in the runtime prompt):
    // - "1부터 시작" → first value 1 (via that field's instruction)
    // - date format only → invent one matching date
    // - HH:MM format only → invent one matching clock
    // - no elapsed time → keep prior date/clock
    // - "다음날 아침" → advance date/clock; counters follow their own instruction
    // - March → spring-like season; 23:30 → night (date/clock/season consistency only)
    const system = buildWidgetExtractSystem(
      DEFAULT_STATUS_WIDGET,
      collectWidgetJsonKeys(DEFAULT_STATUS_WIDGET)
    );
    assert.match(system, /Calendar\/clock\/season\/weather/);
    assert.match(system, /never output "—" just because prose omits them/);
    assert.match(system, /initialValue/);
    assert.match(system, /MUST invent one scene-consistent real value/);
    assert.match(system, /Counters \(days-met, D-DAY, elapsed days\) follow each field's own instruction\/initialValue only/);
    assert.match(system, /do not auto-sync them to date/);
    assert.match(system, /never paste previous values as-is/);
    // Compressed prompt must not reintroduce long example lists
    assert.doesNotMatch(system, /"1부터 시작"/);
    assert.doesNotMatch(system, /두 시간 후/);
    assert.doesNotMatch(system, /다음날 아침/);
  });

  it("buildWidgetExtractUserBlock includes optional initialValue for first-fill priority", () => {
    const widget = {
      ...DEFAULT_STATUS_WIDGET,
      fields: [
        {
          id: "date",
          label: "날짜",
          instruction: "n월 n일 형식",
          initialValue: "3월 18일",
        },
        {
          id: "time",
          label: "현재시각",
          instruction: "HH:MM 형식",
        },
      ],
    };
    const block = buildWidgetExtractUserBlock({
      charName: "레온",
      personaName: "렌",
      userMessage: "복도에서 마주친다.",
      assistantProse: "실내 복도에서 두 사람이 마주쳤다.",
      widget,
      source: "character",
    });
    assert.match(block, /날짜[\s\S]*n월 n일 형식/);
    assert.match(block, /initialValue: 3월 18일/);
    assert.match(block, /first fill; init calendar\/clock fields per rules/);
    assert.doesNotMatch(block, /initialValue: 14:30/);
  });

  it("buildWidgetExtractSystem makes the field instruction the authority on WHOSE inner state to write", () => {
    const system = buildWidgetExtractSystem(
      DEFAULT_STATUS_WIDGET,
      collectWidgetJsonKeys(DEFAULT_STATUS_WIDGET),
      "character"
    );
    // Instruction-first: NPC 지시 → CHARACTER, 유저 지시 → USER
    assert.match(system, /instruction states WHOSE inner state to write — obey it exactly/);
    assert.match(system, /\{\{char\}\}의 속마음[\s\S]*write \[CHARACTER\]'s inner state/);
    assert.match(system, /NPC의 속마음/);
    assert.match(system, /\{\{user\}\}의 속마음[\s\S]*write \[USER\]'s/);
    assert.match(system, /유저의 속마음/);
    assert.match(system, /never output the literals "NPC", "PC"/);
    // Source is only the default when the instruction names no one
    assert.match(system, /does not name anyone, default to \[CHARACTER\] \(the NPC\)/);
    assert.match(system, /Never substitute the other person's feelings/);
    assert.match(system, /\(자리비움\)/);
  });

  it("buildWidgetExtractSystem defaults unnamed inner-state fields to the USER for user-source widgets", () => {
    const system = buildWidgetExtractSystem(
      DEFAULT_STATUS_WIDGET,
      collectWidgetJsonKeys(DEFAULT_STATUS_WIDGET),
      "user"
    );
    assert.match(system, /does not name anyone, default to \[USER\] \(the user persona\)/);
    // Instruction-first rule stays the same regardless of source
    assert.match(system, /instruction states WHOSE inner state to write — obey it exactly/);
  });

  it("buildWidgetExtractUserBlock appends an instruction-first POV reminder right before generation (recency)", () => {
    const block = buildWidgetExtractUserBlock({
      charName: "레온",
      personaName: "렌",
      userMessage: "유저 메시지",
      assistantProse: "렌은 걱정에 휩싸였다.",
      widget: DEFAULT_STATUS_WIDGET,
      source: "character",
    });
    assert.match(block, /\[REMINDER\][\s\S]*지시사항이 지정한 인물의 시점/);
    assert.match(block, /NPC의 것을 요구하면 \[CHARACTER\]\(레온\)/);
    assert.match(block, /유저의 것을 요구하면 \[USER\]\(렌\)/);
    assert.match(block, /명시되지 않은 필드는 \[CHARACTER\]\(레온\) 기준/);
    // Reminder must be the last block so it sits closest to generation.
    assert.ok(block.trimEnd().endsWith("(자리비움)\"으로 남겨라."));

    const userBlock = buildWidgetExtractUserBlock({
      charName: "레온",
      personaName: "렌",
      userMessage: "유저 메시지",
      assistantProse: "렌은 걱정에 휩싸였다.",
      widget: DEFAULT_STATUS_WIDGET,
      source: "user",
    });
    // Same instruction-first rule; only the unnamed-field default flips to the user persona.
    assert.match(userBlock, /명시되지 않은 필드는 \[USER\]\(렌\) 기준/);
    assert.ok(userBlock.trimEnd().endsWith("(자리비움)\"으로 남겨라."));
  });

  it("buildWidgetExtractUserBlock includes character identity but excludes user note and persona text", () => {
    const block = buildWidgetExtractUserBlock({
      charName: "레온",
      characterIdentity: "이름: 레온\n성별: 남성 — 절대 준수.",
      personaName: "렌",
      userPersona: "이름/호칭: 렌\n\n성별: 남성 — 절대 준수.",
      userNote: "비밀 유저노트",
      userMessage: "마중 나와줘.",
      assistantProse: "레온이 렌을 마중 나왔다.",
      widget: DEFAULT_STATUS_WIDGET,
      source: "character",
    });
    assert.match(block, /\[CHARACTER IDENTITY — MUST OBEY\]/);
    assert.match(block, /성별: 남성 — 절대 준수/);
    assert.doesNotMatch(block, /\[USER PERSONA — MUST OBEY\]/);
    assert.doesNotMatch(block, /이름\/호칭: 렌/);
    assert.doesNotMatch(block, /\[USER NOTE\]/);
    assert.doesNotMatch(block, /비밀 유저노트/);
  });

  it("allocateWidgetExtractNarrativeSlices prioritizes current turn within budget", () => {
    const current = "A".repeat(5000);
    const previous = "B".repeat(5000);
    const slices = allocateWidgetExtractNarrativeSlices(current, previous, 8000);
    assert.equal(slices.currentSlice.length, 5000);
    assert.equal(slices.previousSlice.length, 3000);
    assert.ok(slices.previousSlice.startsWith("B"));
  });

  it("allocateWidgetExtractNarrativeSlices includes the full current turn by default", () => {
    const current = "A".repeat(12000);
    const previous = "B".repeat(5000);
    const slices = allocateWidgetExtractNarrativeSlices(current, previous);
    assert.equal(slices.currentSlice.length, 12000);
    assert.equal(slices.previousSlice.length, 5000);
  });
});
