/**
 * PR-S2A qualification fixtures — ≥30 positive, ≥40 negative.
 */
import Module from "module";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractDeterministicSceneEvidenceFromUserMessage } from "@/lib/sceneEvidenceDeterministic";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

type Pos = { msg: string; expect: string };
type Neg = { msg: string };

function positives(): Pos[] {
  const body: Pos[] = [
    { msg: "렌은 셔츠를 벗었다.", expect: "BODY_REGION_EXPOSED" },
    { msg: "렌은 젖은 셔츠를 머리 위로 벗어 의자에 걸었다.", expect: "BODY_REGION_EXPOSED" },
    { msg: "렌은 소매를 걷어 올려 팔을 내보였다.", expect: "BODY_REGION_EXPOSED" },
    { msg: "렌은 웃옷을 벗고 등을 드러냈다.", expect: "BODY_REGION_EXPOSED" },
    { msg: "렌은 재킷을 벗어 던졌다.", expect: "BODY_REGION_EXPOSED" },
    { msg: "렌은 찢어진 셔츠를 그대로 벗어 던졌다.", expect: "BODY_REGION_EXPOSED" },
    { msg: "나는 셔츠를 벗고 등을 보였다.", expect: "BODY_REGION_EXPOSED" },
    { msg: "렌은 코트를 벗었다.", expect: "BODY_REGION_EXPOSED" },
  ];
  const items: Pos[] = [
    { msg: "렌은 독촉장을 꺼내 로코에게 내밀었다.", expect: "VISIBLE_ITEM_PRESENTED" },
    { msg: "렌은 목걸이를 꺼내 보여줬다.", expect: "VISIBLE_ITEM_PRESENTED" },
    { msg: "렌은 사진을 꺼내 건넸다.", expect: "VISIBLE_ITEM_PRESENTED" },
    { msg: "렌은 열쇠를 테이블에 내밀었다.", expect: "VISIBLE_ITEM_PRESENTED" },
    { msg: "렌은 지갑을 꺼내 제시했다.", expect: "VISIBLE_ITEM_PRESENTED" },
  ];
  const docs: Pos[] = [
    { msg: "렌은 접힌 계약서를 펴 로코 앞에 내려놓았다.", expect: "DOCUMENT_PRESENTED" },
    { msg: "렌은 병원 검사 결과지를 책상 위에 펼쳤다.", expect: "DOCUMENT_PRESENTED" },
    { msg: "렌은 진단서를 꺼내 건넸다.", expect: "DOCUMENT_PRESENTED" },
    { msg: "렌은 서류를 꺼내 로코에게 건넸다.", expect: "DOCUMENT_PRESENTED" },
    { msg: "렌은 처방전을 책상 위에 펼쳤다.", expect: "DOCUMENT_PRESENTED" },
  ];
  const abilities: Pos[] = [
    { msg: "렌은 손을 뻗어 무너지는 철골의 중력을 뒤집었다.", expect: "ABILITY_MANIFESTED" },
    { msg: "렌은 중력을 뒤집어 잔해를 공중에 멈췄다.", expect: "ABILITY_MANIFESTED" },
    { msg: "렌은 불에 손을 대자 화염을 피워 올렸다.", expect: "ABILITY_MANIFESTED" },
    { msg: "렌은 순간 이동을 사용했다.", expect: "ABILITY_MANIFESTED" },
    { msg: "렌은 능력을 발동해 빛을 드러냈다.", expect: "ABILITY_MANIFESTED" },
    { msg: "렌은 손을 감싸 상처를 치유했다.", expect: "ABILITY_MANIFESTED" },
  ];
  const symptoms: Pos[] = [
    { msg: "렌은 갑자기 피를 토했다.", expect: "PHYSICAL_SYMPTOM_DISPLAYED" },
    { msg: "능력을 거둔 렌이 입을 막았지만 손가락 사이로 피가 흘렀다.", expect: "PHYSICAL_SYMPTOM_DISPLAYED" },
    { msg: "렌의 코피가 흘렀다.", expect: "PHYSICAL_SYMPTOM_DISPLAYED" },
    { msg: "렌은 그 자리에 쓰러졌다.", expect: "PHYSICAL_SYMPTOM_DISPLAYED" },
    { msg: "렌에게 고열이 났다.", expect: "PHYSICAL_SYMPTOM_DISPLAYED" },
    { msg: "렌의 손이 심하게 떨렸다.", expect: "PHYSICAL_SYMPTOM_DISPLAYED" },
  ];
  return [...body, ...items, ...docs, ...abilities, ...symptoms];
}

function negatives(): Neg[] {
  return [
    { msg: "렌이 셔츠를 벗는다면 문신이 보일 것이다." },
    { msg: "렌이 셔츠를 벗는다면 등에 무언가 보일지도 모른다." },
    { msg: "내가 셔츠를 벗으면 볼 거야?" },
    { msg: "등을 보여주면 믿을까?" },
    { msg: "렌은 셔츠를 벗지 않았다." },
    { msg: "렌은 서류를 꺼내지 않았다." },
    { msg: "조금 뒤 셔츠를 벗을 생각이다." },
    { msg: "렌은 나중에 검사 결과를 보여주겠다고 말했다." },
    { msg: "곧 능력을 사용할 것이다." },
    { msg: "예전에는 등을 보여준 적이 있었다." },
    { msg: "그때는 계약서를 꺼낸 적이 있다." },
    { msg: "예전에 피를 토한 적이 있었다." },
    { msg: "친구가 렌이 셔츠를 벗었다고 들었다." },
    { msg: "소설 속에서는 렌이 중력을 뒤집었다." },
    { msg: "설정상으로는 독촉장을 꺼냈다." },
    { msg: "작품 속 이야기일 뿐이다." },
    { msg: "로코가 렌의 셔츠를 벗기려 했다." },
    { msg: "로코가 렌의 셔츠를 찢으려 했다." },
    { msg: "렌이 중력을 조작할 수 있다면..." },
    { msg: "그런 힘을 쓴 적은 없다." },
    { msg: "마치 셔츠를 벗은 것처럼 느껴졌다." },
    { msg: "속마음을 드러냈다." },
    { msg: "렌은 그냥 서 있었다." },
    { msg: "렌은 피곤해 보였다." },
    { msg: "렌의 표정은 굳어 있었다." },
    { msg: "나는 이계 출신이야." }, // disclosure ≠ scene evidence
    { msg: "거액의 빚이 있다." },
    { msg: "등에 실험체 문신이 있다." },
    { msg: "천공의 권능을 숨긴다." },
    { msg: "엘리시온 브레이크를 쓸 수 있다." },
    { msg: "만약에 계약서를 보여준다면?" },
    { msg: "서류를 보여줄까?" },
    { msg: "능력을 쓰려다 말았다." },
    { msg: "벗으려 했으나 멈췄다." },
    { msg: "누군가가 독촉장을 꺼냈다." },
    { msg: "렌은 셔츠를 벗을 예정이다." },
    { msg: "회상 속에서 등을 드러냈다." },
    { msg: "가정: 렌이 피를 토한다." },
    { msg: "렌이 방독면을 쓴 채 서 있다." },
    { msg: "공개 페르소나: 검은 머리의 청년." },
  ];
}

describe("PR-S2A qualification fixtures", () => {
  const pos = positives();
  const neg = negatives();

  it(`has ≥30 positive and ≥40 negative (pos=${pos.length}, neg=${neg.length})`, () => {
    assert.ok(pos.length >= 30);
    assert.ok(neg.length >= 40);
  });

  it("all positive fixtures emit expected event type", () => {
    let miss = 0;
    for (const p of pos) {
      const drafts = extractDeterministicSceneEvidenceFromUserMessage({
        chatId: 1,
        characterId: 1,
        turnNumber: 1,
        userMessage: p.msg,
      });
      if (!drafts.some((d) => d.eventType === p.expect)) {
        miss++;
      }
    }
    assert.equal(miss, 0, `positive misses=${miss}`);
  });

  it("all negative fixtures emit zero events", () => {
    let falsePos = 0;
    for (const n of neg) {
      const drafts = extractDeterministicSceneEvidenceFromUserMessage({
        chatId: 1,
        characterId: 1,
        turnNumber: 1,
        userMessage: n.msg,
      });
      if (drafts.length > 0) falsePos++;
    }
    assert.equal(falsePos, 0, `false positives=${falsePos}`);
  });
});
