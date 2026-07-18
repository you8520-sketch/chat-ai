import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detectMetaNarration,
  detectRegisterSwitching,
  evaluateStep73Sample,
  extractDialogueLines,
} from "@/lib/registerMetaAudit";

describe("registerMetaAudit", () => {
  it("extracts dialogue lines from paragraph layout", () => {
    const text = `백하율은 고개를 끄덕였다.\n\n"네, 알겠습니다."\n\n그는 창밖을 바라봤다.`;
    assert.deepEqual(extractDialogueLines(text), ["네, 알겠습니다."]);
  });

  it("flags register mixing within one turn", () => {
    const text = `"알겠습니다."\n\n"…그렇소."`;
    const r = detectRegisterSwitching(text);
    assert.equal(r.fail, true);
    assert.ok(r.kinds.includes("formal"));
    assert.ok(r.kinds.includes("archaic"));
  });

  it("passes consistent formal register", () => {
    const text = `"네, 알겠습니다."\n\n"그렇습니다. 잠시만 기다려 주세요."`;
    assert.equal(detectRegisterSwitching(text).fail, false);
  });

  it("detects meta narration about speech register", () => {
    const text = `그는 말투가 공손해졌다.\n\n"…알겠습니다."`;
    assert.equal(detectMetaNarration(text).fail, true);
  });

  it("does not flag register words inside dialogue", () => {
    const text = `"존댓말 쓰지 마세요."\n\n백하율은 고개를 저었다.`;
    assert.equal(detectMetaNarration(text).fail, false);
  });

  it("evaluateStep73Sample marks archaic leak in modern genre", () => {
    const text = `"이것이오, 기록과 다르오."\n\n그는 석문을 가리켰다.`;
    const v = evaluateStep73Sample("fantasy-0", text, ["판타지"]);
    assert.equal(v.speechConsistency, "FAIL");
  });

  it("allows archaic dialogue in wuxia genre", () => {
    const text = `"그렇소."\n\n그는 검집에 손을 얹었다.`;
    const v = evaluateStep73Sample("wuxia-0", text, ["무협"]);
    assert.equal(v.speechConsistency, "PASS");
  });
});
