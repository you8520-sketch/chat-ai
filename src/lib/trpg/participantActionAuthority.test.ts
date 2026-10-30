import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gmAiActionText, resolveTrpgCanonicalAttempt } from "./canonicalAttempt";
import { buildTrpgGmUserBlock, TRPG_GM_LABEL_AI_ATTEMPT, TRPG_GM_SYSTEM } from "./gmPrompt";

/**
 * Campaign 45 round 3 locks. The stored bodies are the originals.
 * 강이현's model text before the stay fallback was not logged; this fixture
 * uses the lock that was actually stored.
 */
const KANG_STAY = "강이현은 제자리에 서서 상황을 살핀다.";

const REN_LOCK =
  '남은 차를 마저 비우고 잔을 테이블에 내려놓는다. 자리에서 일어나 우산을 집어 든다. 권태현과 강이현을 본다. "잘 마셨다. 오늘은 여기까지. 들어가자."';

const KWON_LOCK = `렌이 남은 차를 깔끔하게 비우고 잔을 내려놓자, 권태현은 기다렸다는 듯 낮게 웃으며 짚고 있던 테이블을 밀어 몸을 일으켰다. 거구의 무게감에 낡은 나무 바닥이 가볍게 삐걱거리는 소리를 냈다.

의자 등받이에 걸쳐 두었던 묵직한 외투를 거칠게 낚아채 어깨 위로 툭 걸친 그는, 목덜미를 대충 쓸어넘기며 문가 쪽으로 성큼 걸음을 옮겼다.

“그래, 오늘은 여기까지 하지.”

출입문 앞에 멈춰 선 태현은 주머니에 한 손을 찔러 넣은 채 렌과 강이현을 향해 몸을 반쯤 돌렸다. 멎어든 빗줄기 너머로 차갑게 식은 밤바람이 문틈 사이로 슬그머니 스며들고 있었다.

“밤길 미끄러우니까 발 헛디뎌서 엉덩방아나 찧지 말고 잘들 기어들어가라. 내일 꼴사납게 멍든 얼굴로 나타나지 말고.”

능글맞은 목소리 끝에 피식 조소를 매달았지만, 문손잡이를 잡은 그의 잿빛 눈동자는 평소의 사나운 날을 거둔 채 꽤 느긋한 빛을 띠고 있었다.

<<<ACTION_TYPE>>>
free

<<<INTENT>>>
권태현은 렌의 말에 맞춰 자리에서 일어나 외투를 걸치고 문가로 이동한 뒤, 렌과 강이현에게 잘 들어가라는 가벼운 작별 인사를 건네며 문을 열고 나갈 준비를 하려 했다.`;

function aiWire(name: string, participantId: number, body: string): string {
  return buildTrpgGmUserBlock({
    worldBrief: "모밀찻집",
    memoryBlock: "",
    opening: false,
    actions: [
      {
        participantId,
        name,
        body,
        participantKind: "ai_character",
        statKey: "dex",
        d20: null,
        finalScore: null,
        dc: null,
        tier: null,
      },
    ],
  });
}

describe("campaign 45 round 3 participant action authority", () => {
  it("sends the stay lock as 강이현's whole act when the stored body has no intent", () => {
    const resolved = resolveTrpgCanonicalAttempt({
      participantKind: "ai_character",
      submissionBody: KANG_STAY,
    });
    assert.equal(resolved.canonicalAttempt, "");
    const wire = gmAiActionText(resolved.canonicalAttempt, resolved.presentationProse);
    assert.equal(wire, KANG_STAY);
    const block = aiWire("강이현", 89, wire);
    assert.match(block, new RegExp(TRPG_GM_LABEL_AI_ATTEMPT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(block, /강이현은 제자리에 서서 상황을 살핀다/);
    assert.doesNotMatch(block, /우산/);
    assert.doesNotMatch(block, /일어/);
  });

  it("keeps 권태현's prepare-to-open intent and quote-only lines, and leaves the novel out", () => {
    const resolved = resolveTrpgCanonicalAttempt({
      participantKind: "ai_character",
      submissionBody: KWON_LOCK,
    });
    const wire = gmAiActionText(resolved.canonicalAttempt, resolved.presentationProse);
    assert.match(wire, /문을 열고 나갈 준비를 하려 했다/);
    assert.match(wire, /그래, 오늘은 여기까지 하지/);
    assert.match(wire, /밤길 미끄러우니까 발 헛디뎌서/);
    assert.doesNotMatch(wire, /문손잡이를 잡은/);
    assert.doesNotMatch(wire, /문을 잡아당겨 열/);
    const block = aiWire("권태현", 88, wire);
    assert.match(block, /준비를 하려 했다/);
  });

  it("keeps 렌's umbrella and look as the human act, distinct from a walk to the door", () => {
    const resolved = resolveTrpgCanonicalAttempt({
      participantKind: "human",
      submissionBody: REN_LOCK,
    });
    assert.equal(resolved.canonicalAttempt, REN_LOCK);
    const block = buildTrpgGmUserBlock({
      worldBrief: "모밀찻집",
      memoryBlock: "",
      opening: false,
      actions: [
        {
          participantId: 87,
          name: "렌",
          body: resolved.canonicalAttempt,
          participantKind: "human",
          statKey: "dex",
          d20: null,
          finalScore: null,
          dc: null,
          tier: null,
        },
      ],
    });
    assert.match(block, /우산을 집어 든다/);
    assert.match(block, /권태현과 강이현을 본다/);
    assert.match(block, /잘 마셨다\. 오늘은 여기까지\. 들어가자/);
    assert.doesNotMatch(block, /문 앞/);
    assert.doesNotMatch(block, /출입문/);
  });

  it("tells the GM that this round's lock is the act and earlier preparation is not completion", () => {
    const craft = TRPG_GM_SYSTEM.slice(
      TRPG_GM_SYSTEM.indexOf("[ROUND CRAFT]"),
      TRPG_GM_SYSTEM.indexOf("[LENGTH — SCENE RESPONSIVE]")
    );
    assert.equal((craft.match(/This round's lock is that PC's whole voluntary act/g) ?? []).length, 1);
    assert.equal(
      (craft.match(/Earlier preparation stays preparation until this lock completes it/g) ?? []).length,
      1
    );
    assert.equal(
      (craft.match(/An unchosen act, move, line, promise, or inner state stays unconfirmed/g) ?? []).length,
      1
    );
    assert.doesNotMatch(TRPG_GM_SYSTEM, /Submitted canonical actions fix intent only/);
    assert.match(TRPG_GM_SYSTEM, /participant input fixes this round's voluntary act/);
  });
});
