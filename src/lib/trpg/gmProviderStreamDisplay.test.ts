import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  markTrpgProviderStreamSeen,
  resolveTrpgGmContentStreaming,
  resolveTrpgGmLiveAssetResolution,
  resolveTrpgGmRevealComplete,
  resolveTrpgGmShownNarration,
  resolveTrpgGmStreamNarrationSource,
  stripLiveGmNarrationText,
} from "./gmProviderStreamDisplay";
import { enforceGmSceneAssetMarkers } from "./gmSceneAssets";

describe("gmProviderStreamDisplay", () => {
  it("marks provider stream seen when hidden draft arrives before GM slot", () => {
    let seen = markTrpgProviderStreamSeen(false, undefined);
    assert.equal(seen, false);
    seen = markTrpgProviderStreamSeen(seen, "스트리밍 중");
    assert.equal(seen, true, "HIDDEN_DRAFT_MARKS_PROVIDER_STREAM_SEEN=true");
    seen = markTrpgProviderStreamSeen(seen, undefined);
    assert.equal(seen, true);
  });

  it("fast-complete-before-GM-slot shows canonical without fake replay", () => {
    const seen = markTrpgProviderStreamSeen(false, "스트리밍 중");
    const hidden = resolveTrpgGmShownNarration({
      directProviderStream: seen,
      allowGm: false,
      narrationSource: resolveTrpgGmStreamNarrationSource({
        providerStreamSeen: seen,
        gmStreamDraft: "스트리밍 중",
        canonicalNarration: null,
      }),
      decorativeShownText: "",
    });
    assert.equal(hidden, "", "GM hidden while actor presentation active");

    const canonical = "스트리밍 중\n\n완성된 장면 prose";
    const slotOpen = resolveTrpgGmShownNarration({
      directProviderStream: seen,
      allowGm: true,
      narrationSource: resolveTrpgGmStreamNarrationSource({
        providerStreamSeen: seen,
        gmStreamDraft: undefined,
        canonicalNarration: canonical,
      }),
      decorativeShownText: "",
    });
    assert.equal(slotOpen, canonical, "FAST_COMPLETE_BEFORE_GM_SLOT_NO_REPLAY=true");
    assert.equal(
      resolveTrpgGmRevealComplete({
        directProviderStream: seen,
        narrationSource: canonical,
        canonicalNarration: canonical,
        decorativeShownLen: 0,
      }),
      true,
      "NO_GM_REPLAY=true"
    );
    assert.match(slotOpen, /^스트리밍/, "NO_GM_DISAPPEAR=true");
  });

  it("uses contentStreaming hint during live provider draft growth", () => {
    assert.equal(
      resolveTrpgGmContentStreaming({
        directProviderStream: true,
        allowGm: true,
        canonicalNarration: null,
        narrationSource: "부분 텍스트",
        decorativeRevealActive: false,
        decorativeProgressive: false,
      }),
      true,
      "DIRECT_PROVIDER_CONTENT_STREAMING_HINT=true"
    );
    assert.equal(
      resolveTrpgGmContentStreaming({
        directProviderStream: true,
        allowGm: true,
        canonicalNarration: "완료",
        narrationSource: "완료",
        decorativeRevealActive: false,
        decorativeProgressive: false,
      }),
      false
    );
  });

  it("LIVE_ASSET_RESOLUTION=false during provider draft; canonical owner enforces max", () => {
    const raw =
      "장면.\n[캐릭터에셋: 12|분노]\n[캐릭터에셋: 13|웃음]\n[태그: 대합실]";
    const live = stripLiveGmNarrationText(raw);
    assert.match(live, /장면/, "LIVE_TEXT_STREAMING=true");
    assert.doesNotMatch(live, /캐릭터에셋/, "LIVE_ASSET_RESOLUTION=false");
    assert.doesNotMatch(live, /\[태그:/, "LIVE_ASSET_RESOLUTION=false");
    assert.equal(
      resolveTrpgGmLiveAssetResolution({ directProviderStream: true, canonicalCommitted: false }),
      false
    );
    assert.equal(
      resolveTrpgGmLiveAssetResolution({ directProviderStream: true, canonicalCommitted: true }),
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
    assert.doesNotMatch(canonical.text, /\[태그: 대합실\]/);
    assert.match(canonical.text, /장면/);
    assert.match(live, /^장면/, "NO_GM_DISAPPEAR=true");
  });

  it("never shows malformed partial asset marker in live prose", () => {
    const partial = "hello [캐릭터에셋: 12|분";
    const live = stripLiveGmNarrationText(partial);
    assert.doesNotMatch(live, /캐릭터에셋/);
    assert.match(live, /hello/);
  });
});
