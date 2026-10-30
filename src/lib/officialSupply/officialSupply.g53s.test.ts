import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCharacterExperienceSystem,
  buildCharacterExperienceUser,
  buildCharacterBible1System,
  buildCharacterVoiceSystem,
  formatOfficialCharacterExperience,
  OFFICIAL_CHARACTER_EXPERIENCE_KEYS,
  type OfficialCharacterExperience,
} from "./authorPrompts";
import {
  OFFICIAL_ROFAN_GENRE,
  recommendOfficialAuthoringDirection,
  resolveOfficialAuthoringPlan,
} from "./genreProfile";
import { isTagGrounded } from "./marketFit";
import { formatUserRelationPlanForPrompt, FREE_USER_RELATION_PLAN } from "./userRelationStart";

const MODERN_PLAN = resolveOfficialAuthoringPlan(recommendOfficialAuthoringDirection("현대/일상"));
const ROFAN_PLAN = resolveOfficialAuthoringPlan({ genre: OFFICIAL_ROFAN_GENRE });

/** The two canon fields actually observed in the G5-3R run. */
const OBSERVED_CANON: Pick<OfficialCharacterExperience, "tension" | "firstAction"> = {
  tension:
    "당신이 들고 있는 중요한 이야기를 가볍게 넘기지 않으려 애쓰지만, 분위기를 풀려는 버릇이 자꾸 끼어든다.",
  firstAction: "당신의 말을 듣고 엉뚱한 비유를 꺼내려다 입을 다문다. “아니, 이번엔 제대로 들을게.”",
};

const CANON: OfficialCharacterExperience = {
  desire: "어색한 침묵을 웃음으로 바꿔 사람들이 다시 말을 걸게 만들고 싶다.",
  contradiction: "모두를 편하게 해 주려 하지만 정작 자신의 진심은 농담 뒤에 숨긴다.",
  behavior: "누가 난처해하면 그 말의 과장을 받아쳐 웃긴 비유로 만들고 작은 해결책을 낸다.",
  incident: "농담으로 덮은 오해가 커진 뒤로는 먼저 사실을 확인하려 한다.",
  tension: "가벼운 말로 분위기를 풀려는 습관과, 지금은 아무 말도 하지 않으려는 결심이 부딪힌다.",
  daily: "할 일을 짧은 목록으로 적고, 남의 말버릇을 기억해 별명을 붙인다.",
  cost: "웃음으로 빨리 풀수록 누군가는 진지하게 받아들여지지 않았다고 느낀다.",
  play: "농담으로 시작해 오해를 키우거나 풀고, 농담을 멈추는 순간을 고르는 경험.",
  voice: "“이건 오해가 아니라 오해가 정기구독한 것 같은데.”",
  firstAction: "탁자에 놓인 메모를 자기 쪽으로 당겨 날짜를 짚는다.",
};

/** Player preemption: the canon decides what the player holds, said, or feels. */
const PLAYER_STAKE = /당신(?:이|의)\s*(?:들고|말한|말을|겪|느낀|가진|준비한|맡은)/;

describe("G5-3S A — the observed canon preempted the player", () => {
  it("reproduces the preemption in the G5-3R experience", () => {
    assert.match(OBSERVED_CANON.tension, PLAYER_STAKE);
    assert.match(OBSERVED_CANON.firstAction, PLAYER_STAKE);
  });

  it("the canonical owner now forbids only AI-invented player stake, words and feelings", () => {
    const system = buildCharacterExperienceSystem();
    assert.match(
      system,
      /제작자가 castIntent에 적은 사용자 역할·관계·설정은 정본이므로 그대로 유지한다/
    );
    assert.match(system, /AI가 임의로 플레이어의 역할·소지품·안건·방문 목적·관계 상태를 추가하지 않는다/);
    assert.match(system, /castIntent에 없는 사용자 발화·감정·선택·결말도 만들지 않는다/);
    assert.match(
      system,
      /firstAction은 castIntent에 고정된 사실만 전제하고, 플레이어의 발화나 감정 없이도 성립하는 이 인물 자신의 행동/
    );
  });

  it("the experience request no longer invites a user-facing tension or a reaction-first action", () => {
    const user = buildCharacterExperienceUser({
      genre: "현대/일상",
      gender: "female",
      castIntent: "",
      authoring: MODERN_PLAN,
    });
    assert.match(user, /이 인물이 장면으로 들고 나오는 긴장/);
    assert.match(user, /플레이어의 말·감정 없이도 스스로 하는 첫 행동/);
    assert.doesNotMatch(user, /사용자와 처음 부딪히는 긴장/);
  });

  it("keeps the ten-field canon intact and ordered", () => {
    assert.equal(OFFICIAL_CHARACTER_EXPERIENCE_KEYS.length, 10);
    const lines = formatOfficialCharacterExperience(CANON);
    assert.equal(lines.length, 10);
    assert.deepEqual(
      lines.map((line) => line.split(":")[0]),
      ["욕망", "모순", "행동", "사건 씨앗", "첫 긴장", "일상", "대가", "플레이 경험", "말투", "첫 행동"]
    );
  });
});

describe("G5-3S A — downstream owners stop materializing the player's role", () => {
  it("keeps creator-specified castIntent settings as canon", () => {
    const user = buildCharacterExperienceUser({
      genre: "현대/일상",
      gender: "female",
      castIntent: "유저는 사건을 의뢰한 탐정이고, 두 사람은 같은 사건을 겪은 사이",
      authoring: MODERN_PLAN,
    });
    assert.match(user, /캐스트 의도: 유저는 사건을 의뢰한 탐정이고/);
    assert.match(user, /사용자가 직접 적은 의도만 욕망과 첫 장면의 제약으로 따른다/);
  });

  it("the entry-scene owner defers to explicit fixedFacts and forbids additions beyond them", () => {
    const modern = buildCharacterBible1System(MODERN_PLAN);
    assert.match(modern, /fixedFacts\(role_bound·relationship_bound\)에 명시된 사실만 쓴다/);
    assert.match(modern, /free이거나 고정 사실이 없으면 .* 새로 배정하지 않는다/);
    assert.match(modern, /고정 사실에 없는 유저의 발화·감정·방문 목적은 만들지 않는다/);
    assert.doesNotMatch(modern, /유저 선택권·관계 진행·결말 목록으로 분량을 채우지 않는다.*고정 사실.*만들지 않는다/);
  });

  it("leaves the rofan parity wording byte-identical", () => {
    const rofan = buildCharacterBible1System(ROFAN_PLAN);
    const defaultPlan = buildCharacterBible1System();
    assert.equal(rofan, defaultPlan);
    assert.doesNotMatch(rofan, /fixedFacts\(role_bound·relationship_bound\)에 명시된 사실만/);
    assert.match(rofan, /유저 선택권·페르소나 설명/);
  });
});

describe("G5-3S A — the relation-start owner keeps creator-fixed roles", () => {
  it("free start fixes no role or relationship", () => {
    const lines = formatUserRelationPlanForPrompt(FREE_USER_RELATION_PLAN);
    assert.match(lines[0]!, /free/);
    assert.match(lines[1]!, /role_bound/);
  });

  it("relationship_bound keeps the explicit shared past", () => {
    const lines = formatUserRelationPlanForPrompt({
      type: "relationship_bound",
      fixed: "두 사람은 같은 사건을 겪었고 서로의 과거를 안다",
    });
    assert.match(lines[0]!, /relationship_bound/);
    assert.match(lines[0]!, /두 사람은 같은 사건을 겪었고 서로의 과거를 안다/);
    assert.match(lines[1]!, /고정 사실만 확정하고 유저 성별·감정·행동·결말은 확정하지 않는다/);
  });

  it("role_bound keeps the explicit role text in the same owner", () => {
    const lines = formatUserRelationPlanForPrompt({
      type: "role_bound",
      fixed: "유저는 사건을 의뢰한 탐정이다",
    });
    assert.match(lines[0]!, /role_bound/);
    assert.match(lines[0]!, /유저는 사건을 의뢰한 탐정이다/);
  });
});

describe("G5-3S B — the canon voice reaches the opening", () => {
  it("requires the canon register in the first line and first action", () => {
    const modern = buildCharacterVoiceSystem(true, MODERN_PLAN);
    assert.match(modern, /첫 대사·첫 행동에서 정본의 말투와 반응 방식/);
    assert.match(modern, /정본의 예시 문장을 그대로 복사하지는 않는다/);
    assert.match(modern, /고정 사실에 없는 유저의 발화·감정·방문 목적을 대사나 서술로 확정하지 않는다/);
  });

  it("does not impose a single friendly register", () => {
    const modern = buildCharacterVoiceSystem(true, MODERN_PLAN);
    assert.doesNotMatch(modern, /밝고 다정/);
    assert.doesNotMatch(modern, /반드시 유머/);
    assert.match(modern, /회피·직설·비꼼·과장 등/);
  });

  it("keeps the unspoken-state rule but scopes it to facts the sheet did not fix", () => {
    const modern = buildCharacterVoiceSystem(true, MODERN_PLAN);
    assert.match(modern, /고정 사실에 없는 유저의 발화·감정·방문 목적을 대사나 서술로 확정하지 않는다/);
  });

  it("leaves the rofan greeting wording byte-identical", () => {
    const rofan = buildCharacterVoiceSystem(true, ROFAN_PLAN);
    assert.equal(rofan, buildCharacterVoiceSystem(true));
    assert.doesNotMatch(rofan, /첫 대사·첫 행동에서 정본의 말투/);
  });
});

describe("G5-3S C — outcome tags stay rejected while grounded tags pass", () => {
  it("rejects a relationship-outcome tag the sheet never states", () => {
    const stems = new Set<string>();
    const bibleText = "해온시장 상인회 공지와 재개발 일정이 서로 다르게 전해진다.";
    assert.equal(isTagGrounded("관계 회복", stems, bibleText, "현대/일상"), false);
  });

  it("accepts a tag whose words the sheet actually contains", () => {
    const stems = new Set(["회복"]);
    const bibleText = "오해를 풀고 신뢰를 회복하려는 마음이 있다.";
    assert.equal(isTagGrounded("관계 회복", stems, bibleText, "현대/일상"), true);
  });

  it("still accepts the selected genre's own name and refuses unrelated popular keywords", () => {
    assert.equal(isTagGrounded("현대/일상", new Set(), "", "현대/일상"), true);
    assert.equal(isTagGrounded("재개발 붐", new Set(), "시장 공지", "현대/일상"), false);
  });

  it("tells the tag owner not to lock an outcome for a free relationship", () => {
    const modern = buildCharacterVoiceSystem(true, MODERN_PLAN);
    assert.match(modern, /관계 시작이 free면 아직 일어나지 않은 관계의 결과/);
    assert.match(modern, /정본에 이미 있는 성격·경험·갈등의 방향만/);
    assert.doesNotMatch(buildCharacterVoiceSystem(true, ROFAN_PLAN), /관계 시작이 free면/);
  });
});
