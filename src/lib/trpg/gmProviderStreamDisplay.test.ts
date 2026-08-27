import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveTrpgGmContentStreaming,
  resolveTrpgGmLiveAssetResolution,
  resolveTrpgGmPacingSource,
  resolveTrpgGmRevealActive,
  resolveTrpgGmRevealComplete,
  resolveTrpgGmShownNarration,
  resolveTrpgGmSourceBuffer,
  stripLiveGmNarrationText,
} from "./gmProviderStreamDisplay";
import { enforceGmSceneAssetMarkers } from "./gmSceneAssets";
import { resolveTrpgRevealVisibleCount, trpgRevealTextExtended } from "./revealTiming";

describe("gmProviderStreamDisplay", () => {
  it("HIDDEN_DRAFT_COUNTS_AS_VISIBLE=false while GM slot closed", () => {
    const pacing = resolveTrpgGmPacingSource({
      gmStreamDraft: "스트리밍 중",
      canonicalNarration: null,
    });
    assert.match(pacing, /스트리밍/);
    assert.equal(
      resolveTrpgGmShownNarration({
        allowGm: false,
        skipDecorativeReveal: false,
        pacingSource: pacing,
        visibleCursorText: pacing,
      }),
      "",
      "source buffer may grow while visible chars stay 0"
    );
    assert.equal(
      resolveTrpgGmRevealActive({
        allowGm: false,
        skipDecorativeReveal: false,
        isFreshLogKey: true,
      }),
      false
    );
  });

  it("GM_STREAM_SPEED_RESPECTED: slot open starts from visible cursor 0, not instant dump", () => {
    const pacing = resolveTrpgGmPacingSource({
      gmStreamDraft: "완성된 장면 prose",
      canonicalNarration: null,
    });
    assert.equal(
      resolveTrpgGmShownNarration({
        allowGm: true,
        skipDecorativeReveal: false,
        pacingSource: pacing,
        visibleCursorText: "",
      }),
      "",
      "GM_CANONICAL_INSTANT_JUMP=false at cursor 0"
    );
    assert.equal(
      resolveTrpgGmShownNarration({
        allowGm: true,
        skipDecorativeReveal: false,
        pacingSource: pacing,
        visibleCursorText: "완성",
      }),
      "완성",
      "GM_STREAM_SPEED_RESPECTED=true"
    );
  });

  it("canonical before GM slot still paces from 0; no replay / no disappear", () => {
    const pacing = resolveTrpgGmPacingSource({
      gmStreamDraft: undefined,
      canonicalNarration: "스트리밍 중\n\n완성된 장면 prose",
    });
    const hidden = resolveTrpgGmShownNarration({
      allowGm: false,
      skipDecorativeReveal: false,
      pacingSource: pacing,
      visibleCursorText: "",
    });
    assert.equal(hidden, "");
    const partial = resolveTrpgGmShownNarration({
      allowGm: true,
      skipDecorativeReveal: false,
      pacingSource: pacing,
      visibleCursorText: "스트리밍 중",
    });
    assert.equal(partial, "스트리밍 중", "NO_GM_REPLAY=true");
    assert.match(partial, /^스트리밍/, "NO_GM_DISAPPEAR=true");
    assert.equal(
      resolveTrpgGmRevealComplete({
        allowGm: true,
        skipDecorativeReveal: false,
        pacingSource: pacing,
        decorativeShownLen: Array.from(partial).length,
      }),
      false,
      "GM_CANONICAL_INSTANT_JUMP=false"
    );
  });

  it("prefix extension continues visible cursor without reset", () => {
    const prefix = "장면 앞부분";
    const extended = prefix + " 그리고 이어짐";
    assert.equal(trpgRevealTextExtended(prefix, extended), true);
    assert.equal(
      resolveTrpgRevealVisibleCount({
        previousSession: { text: prefix, active: true, kind: "gm" },
        nextSession: { text: extended, active: true, kind: "gm" },
        storedCount: Array.from(prefix).length,
        finishOwned: false,
        reducedMotion: false,
      }),
      Array.from(prefix).length,
      "live draft growth does not restart cursor"
    );
  });

  it("uses contentStreaming hint during live provider draft growth", () => {
    assert.equal(
      resolveTrpgGmContentStreaming({
        allowGm: true,
        canonicalNarration: null,
        pacingSource: "부분 텍스트",
        decorativeRevealActive: true,
        decorativeProgressive: false,
      }),
      true,
      "DIRECT_PROVIDER_CONTENT_STREAMING_HINT=true"
    );
    assert.equal(
      resolveTrpgGmContentStreaming({
        allowGm: true,
        canonicalNarration: "완료",
        pacingSource: "완료",
        decorativeRevealActive: true,
        decorativeProgressive: false,
      }),
      false
    );
  });

  it("LIVE_ASSET_RESOLUTION=false until canonical reveal complete", () => {
    const raw =
      "장면.\n[캐릭터에셋: 12|분노]\n[캐릭터에셋: 13|웃음]\n[태그: 대합실]";
    const live = stripLiveGmNarrationText(raw);
    assert.match(live, /장면/, "LIVE_TEXT_STREAMING=true");
    assert.doesNotMatch(live, /캐릭터에셋/, "LIVE_ASSET_RESOLUTION=false");
    assert.equal(
      resolveTrpgGmLiveAssetResolution({ canonicalCommitted: false, revealComplete: false }),
      false
    );
    assert.equal(
      resolveTrpgGmLiveAssetResolution({ canonicalCommitted: true, revealComplete: false }),
      false
    );
    assert.equal(
      resolveTrpgGmLiveAssetResolution({ canonicalCommitted: true, revealComplete: true }),
      true,
      "CANONICAL_ASSET_RESOLUTION=true"
    );
    const canonical = enforceGmSceneAssetMarkers(raw, {
      aiParticipantIds: new Set([12, 13]),
      characterTagsByParticipant: new Map([
        [12, new Set(["분노"])],
        [13, new Set(["웃음"])],
      ]),
      scenarioTags: new Set(["대합실"]),
    });
    assert.equal(canonical.kept.length, 2, "ONE_ASSET_ENFORCEMENT_OWNER=true");
    assert.match(resolveTrpgGmPacingSource({ gmStreamDraft: raw, canonicalNarration: null }), /장면/);
    assert.equal(resolveTrpgGmSourceBuffer({ gmStreamDraft: "a", canonicalNarration: "ab" }), "ab");
  });

  it("never shows malformed partial asset marker in live prose", () => {
    const partial = "hello [캐릭터에셋: 12|분";
    const live = stripLiveGmNarrationText(partial);
    assert.doesNotMatch(live, /캐릭터에셋/);
    assert.match(live, /hello/);
  });
});
