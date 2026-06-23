import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pushLiveStreamDelta } from "@/lib/statusWindow";

describe("pushLiveStreamDelta", () => {
  it("sends instant replace when append catch-up fails to avoid duplicate tail", () => {
    const events: object[] = [];
    const send = (obj: object) => events.push(obj);

    const prior =
      "역할 몸입 중, 성인 콘텐츠 허용.\n\n그는 천천히 고개를 들었다.";
    const target =
      "그는 천천히 고개를 들었다. 창밖으로 빗줄기가 떨어지고 있었다.";

    const r = pushLiveStreamDelta(send, target, prior, target, {
      replaceInstant: true,
      lastSentToClient: prior,
    });

    assert.equal(r.lastCleanSent, target);
    assert.equal(r.lastSentToClient, target);
    assert.deepEqual(events, [{ type: "replace", text: target, instant: true }]);
  });

  it("appends missing middle when client text is a prefix of server clean", () => {
    const events: object[] = [];
    const send = (obj: object) => events.push(obj);

    const laggedClient = "첫 문장.";
    const serverClean = "첫 문장. 둘째 문장. 셋째 문장.";

    const r = pushLiveStreamDelta(send, serverClean, serverClean, null, {
      lastSentToClient: laggedClient,
    });

    assert.equal(r.lastSentToClient, serverClean);
    assert.deepEqual(events, [
      { type: "append", text: " 둘째 문장. 셋째 문장.", forceAppend: true },
    ]);
  });

  it("does not send overlapping LCP append when raw prefix diverges", () => {
    const events: object[] = [];
    const send = (obj: object) => events.push(obj);

    const lastSent = "ABCDEFGHIJ";
    const target = "ABCDEFGHXYZ";

    const r = pushLiveStreamDelta(send, target, target, null, {
      lastSentToClient: lastSent,
    });

    assert.equal(r.lastSentToClient, target);
    assert.deepEqual(events, [{ type: "replace", text: target, instant: true }]);
  });

  it("instant replace when server clean diverges from client prefix", () => {
    const events: object[] = [];
    const send = (obj: object) => events.push(obj);

    const laggedClient =
      "역할 몸입 중, 성인 콘텐츠 허용.\n\n그는 천천히 고개를 들었다.";
    const serverClean =
      "그는 천천히 고개를 들었다. 창밖으로 빗줄기가 떨어지고 있었다.";

    const r = pushLiveStreamDelta(send, serverClean, serverClean, null, {
      lastSentToClient: laggedClient,
    });

    assert.equal(r.lastSentToClient, serverClean);
    assert.deepEqual(events, [{ type: "replace", text: serverClean, instant: true }]);
  });
});
