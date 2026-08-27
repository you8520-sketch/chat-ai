import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  properPrefixesOfControlMarker,
  projectStreamVisibleWithoutIncompleteControlMarkers,
  stripIncompleteControlMarkerSuffix,
} from "./incompleteMarkerSuffix";
import { stripS4ServerControlFromText } from "./serverControlStrip";
import { S4_TRANSFER_BLOCK, S4_TRANSFER_END } from "@/lib/s4GenerationTransfer/types";
import {
  STATUS_VALUES_BLOCK,
  STATUS_VALUES_END,
} from "@/lib/statusWidget/parseValues";

const S4_MARKER = S4_TRANSFER_BLOCK;
const CONTROL_PREFIXES = ["<", "<<", "<<<", "<<<S", "<<<S4", "<<<S4_", "<<<S4_K"];

function assertNoControlPrefixLeak(visible: string): void {
  for (const prefix of CONTROL_PREFIXES) {
    assert.ok(!visible.includes(prefix), `leaked prefix: ${prefix}`);
  }
  assert.ok(!visible.includes(S4_MARKER));
  assert.ok(!visible.includes(STATUS_VALUES_BLOCK));
}

describe("incompleteMarkerSuffix", () => {
  it("properPrefixes covers every split position of S4 marker", () => {
    const prefixes = properPrefixesOfControlMarker(S4_MARKER);
    for (let i = 1; i < S4_MARKER.length; i++) {
      assert.ok(prefixes.includes(S4_MARKER.slice(0, i)));
    }
  });

  it("all split positions — raw += chunk; visible = strip(raw)", () => {
    const prose = "한국어 RP 본문입니다.";
    for (let splitAt = 0; splitAt <= S4_MARKER.length; splitAt++) {
      let rawBuffer = prose;
      const parts = [S4_MARKER.slice(0, splitAt), S4_MARKER.slice(splitAt)];
      let visible = prose;
      for (const chunk of parts) {
        if (!chunk) continue;
        rawBuffer += chunk;
        visible = stripS4ServerControlFromText(
          projectStreamVisibleWithoutIncompleteControlMarkers(rawBuffer, {
            startMarkers: [S4_MARKER, STATUS_VALUES_BLOCK],
            blocks: [
              { start: S4_MARKER, end: S4_TRANSFER_END },
              { start: STATUS_VALUES_BLOCK, end: STATUS_VALUES_END },
            ],
          })
        );
        assertNoControlPrefixLeak(visible);
      }
      assert.equal(visible, prose);
    }
  });

  it("UTF-8 Korean prose immediately before marker split", () => {
    const prose = "비밀을 말했다.";
    let rawBuffer = prose;
    let visible = prose;
    for (const chunk of ["<<<S4_KNOWLEDGE_TRANS", "FER>>>"]) {
      rawBuffer += chunk;
      visible = stripS4ServerControlFromText(
        projectStreamVisibleWithoutIncompleteControlMarkers(rawBuffer, {
          startMarkers: [S4_MARKER],
          blocks: [{ start: S4_MARKER, end: S4_TRANSFER_END }],
        })
      );
      assertNoControlPrefixLeak(visible);
    }
    assert.equal(visible, prose);
  });

  it("complete block removed from visible", () => {
    const prose = "본문.";
    const raw = `${prose}\n${S4_MARKER}\n{"nonce":"n"}\n${S4_TRANSFER_END}`;
    const visible = stripS4ServerControlFromText(raw);
    assert.equal(visible, prose);
  });

  it("STATUS partial prefix at tail", () => {
    const prose = "RP";
    const visible = stripIncompleteControlMarkerSuffix(`${prose}<<<STATUS`, [
      STATUS_VALUES_BLOCK,
    ]);
    assert.equal(visible, prose);
  });
});
