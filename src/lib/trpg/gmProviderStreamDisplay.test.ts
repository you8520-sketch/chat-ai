import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  markTrpgProviderStreamSeen,
  resolveTrpgGmContentStreaming,
  resolveTrpgGmRevealComplete,
  resolveTrpgGmShownNarration,
  resolveTrpgGmStreamNarrationSource,
} from "./gmProviderStreamDisplay";

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
});
