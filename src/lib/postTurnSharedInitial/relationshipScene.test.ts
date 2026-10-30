import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildRelationshipSceneProse,
  hasRelationshipSceneCandidate,
  locateRelationshipScenes,
} from "./relationshipScene";

const T71_LIKE = `"수리는 확실하게 해 두는 게 좋을 거다, 메딕. 그 녀석은 내 자산이니까. 흠집 하나라도 더 냈다간, 네 머리통에 핸드 드릴을 박아주지."

제이의 서늘한 경고에 6은 어깨를 으쓱하며 양손을 들어 올렸다.

"Wow, protective owner. Understood. I'll make him as good as new. No unauthorized amputations, promise."
(와우, 소유욕이 강하신 주인이시네요. 알겠습니다. 새것처럼 고쳐놓죠. 허가 없는 절단은 안 할게요, 약속하죠.)

제이는 오스카를 향해 턱짓을 했다.

"여기서 이 녀석의 처치가 끝날 때까지 감시해라. 끝나는 대로 네 숙소로 돌아가서 대기하고."`;

describe("locateRelationshipScenes", () => {
  it("finds the T71-shaped promise and keeps the speaker/deadline context", () => {
    const windows = locateRelationshipScenes(T71_LIKE);
    assert.equal(windows.length, 1);
    const text = windows[0].text;
    assert.match(text, /No unauthorized amputations, promise/);
    assert.match(text, /약속하죠/);
    assert.match(text, /제이의 서늘한 경고에/);
    // The nearby order to Oscar is OUTSIDE this window: it is the distractor
    // that previously became the promise deadline. Keep the window tight.
    assert.doesNotMatch(text, /여기서 이 녀석의 처치가 끝날 때까지/);
    assert.deepEqual(windows[0].tier, "commitment");
  });

  it("does not trigger on ordinary 'I will' narration", () => {
    const prose = `"I'll make him as good as new." 6은 메스를 내려놓았다.`;
    assert.equal(hasRelationshipSceneCandidate(prose), false);
    assert.deepEqual(locateRelationshipScenes(prose), []);
  });

  it("finds Korean 약속 windows", () => {
    const prose = `리안은 한숨을 쉬었다.\n\n"내일 아침에 다시 올게, 약속할게."\n\n서윤은 고개를 끄덕였다.`;
    const windows = locateRelationshipScenes(prose);
    assert.equal(windows.length, 1);
    assert.match(windows[0].text, /약속할게/);
    assert.match(windows[0].text, /서윤은 고개를 끄덕였다/);
  });

  it("uses 장담 only as a fallback when no explicit commitment exists", () => {
    const prose = `리안은 웃었다.\n\n"그건 장담할 수 없어."\n\n서윤은 창밖을 보았다.`;
    const windows = locateRelationshipScenes(prose);
    assert.equal(windows.length, 1);
    assert.equal(windows[0].tier, "fallback");
  });

  it("skips cues inside OOC/meta spans", () => {
    const prose = `*[ooc: 다음 턴에 약속 장면을 넣어줘.]*\n\n리안은 조용히 앉아 있었다.`;
    assert.equal(hasRelationshipSceneCandidate(prose), false);
    assert.deepEqual(locateRelationshipScenes(prose), []);
  });

  it("keeps two distant promises as two labelled windows", () => {
    const filler = "평범한 장면이 이어진다. ".repeat(80);
    const prose = `"내일 다시 올게, 약속해."\n\n${filler}\n\n"창고 열쇠는 내가 맡을게, 약속하지."\n\n카일은 고개를 끄덕였다.`;
    const windows = locateRelationshipScenes(prose);
    assert.equal(windows.length, 2);
    assert.match(windows[0].text, /내일 다시 올게/);
    assert.match(windows[1].text, /창고 열쇠/);
    const proseBlock = buildRelationshipSceneProse(windows);
    assert.match(proseBlock, /--- scene 1 ---/);
    assert.match(proseBlock, /--- scene 2 ---/);
  });

  it("merges overlapping cue windows and respects the total budget", () => {
    const prose = `"약속할게. 정말 약속해."\n\n리안은 손을 내밀었다.`;
    const windows = locateRelationshipScenes(prose);
    assert.equal(windows.length, 1);
    assert.ok(windows[0].text.length <= 1200);
  });

  it("returns no window for empty prose", () => {
    assert.deepEqual(locateRelationshipScenes("   "), []);
  });

  it("does not trigger on a possession-only (T80-shaped) scene", () => {
    const prose = `"이 반지는 이제 네 거야." 제이가 오스카의 손에 수류탄 안전핀 반지를 쥐여 주었다.`;
    assert.equal(hasRelationshipSceneCandidate(prose), false);
  });
});
