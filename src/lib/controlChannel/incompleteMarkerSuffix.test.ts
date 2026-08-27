import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  properPrefixesOfControlMarker,
  projectStreamVisibleWithoutIncompleteControlMarkers,
  stripIncompleteControlMarkerSuffix,
} from "./incompleteMarkerSuffix";
import {
  stripIncompleteServerControlTails,
  stripS4ServerControlFromText,
} from "./serverControlStrip";
import { S4_TRANSFER_BLOCK, S4_TRANSFER_END } from "@/lib/s4GenerationTransfer/types";
import {
  STATUS_VALUES_BLOCK,
  STATUS_VALUES_END,
} from "@/lib/statusWidget/parseValues";

const S4_MARKER = S4_TRANSFER_BLOCK;
const CONTROL_PREFIXES = ["<", "<<", "<<<", "<<<s", "<<<s4", "<<<s4_", "<<<s4_k"];

function assertNoControlPrefixLeak(visible: string): void {
  const folded = visible.toLowerCase();
  for (const prefix of CONTROL_PREFIXES) {
    assert.ok(!folded.includes(prefix), `leaked prefix: ${prefix}`);
  }
  assert.ok(!folded.includes(S4_MARKER.toLowerCase()));
  assert.ok(!folded.includes(STATUS_VALUES_BLOCK.toLowerCase()));
}

function mixedCase(marker: string): string {
  return [...marker]
    .map((char, index) =>
      /[A-Za-z]/.test(char)
        ? index % 2 === 0
          ? char.toLowerCase()
          : char.toUpperCase()
        : char
    )
    .join("");
}

function assertAllSplitPositionsHidden(marker: string): void {
  const prose = "한국어 RP 본문입니다.";
  for (let splitAt = 0; splitAt <= marker.length; splitAt++) {
    let rawBuffer = prose;
    const parts = [marker.slice(0, splitAt), marker.slice(splitAt)];
    let visible = prose;
    for (const chunk of parts) {
      if (!chunk) continue;
      rawBuffer += chunk;
      visible = stripS4ServerControlFromText(rawBuffer);
      assertNoControlPrefixLeak(visible);
    }
    assert.equal(visible, prose);
  }
}

describe("incompleteMarkerSuffix", () => {
  it("properPrefixes covers every split position of S4 marker", () => {
    const prefixes = properPrefixesOfControlMarker(S4_MARKER);
    for (let i = 1; i < S4_MARKER.length; i++) {
      assert.ok(prefixes.includes(S4_MARKER.slice(0, i)));
    }
  });

  it("S4 canonical all split positions — raw += chunk; visible = strip(raw)", () => {
    assertAllSplitPositionsHidden(S4_MARKER);
  });

  it("S4 lowercase all split positions", () => {
    assertAllSplitPositionsHidden(S4_MARKER.toLowerCase());
  });

  it("S4 mixed-case all split positions", () => {
    assertAllSplitPositionsHidden(mixedCase(S4_MARKER));
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

  it("lowercase unclosed S4 block is hidden without becoming canonical", () => {
    const prose = "본문";
    const raw = `${prose}\n${S4_MARKER.toLowerCase()}\n{"nonce":`;
    assert.equal(stripS4ServerControlFromText(raw), prose);
  });

  it("STATUS uppercase + lowercase all split positions", () => {
    const prose = "RP";
    for (const marker of [STATUS_VALUES_BLOCK, STATUS_VALUES_BLOCK.toLowerCase()]) {
      for (let splitAt = 0; splitAt <= marker.length; splitAt++) {
        let rawBuffer = prose;
        for (const chunk of [marker.slice(0, splitAt), marker.slice(splitAt)]) {
          if (!chunk) continue;
          rawBuffer += chunk;
          const visible = stripIncompleteServerControlTails(rawBuffer);
          assert.equal(visible, prose);
        }
      }
    }
  });

  it("STATUS representative case variants are withheld", () => {
    const prose = "RP";
    for (const partial of [
      "<<<status",
      "<<<STATUS",
      "<<<status_values",
      "<<<STATUS_VALUES c",
      "<<<status_values u",
    ]) {
      const visible = stripIncompleteControlMarkerSuffix(`${prose}${partial}`, [
        STATUS_VALUES_BLOCK,
        "<<<STATUS_VALUES char>>>",
        "<<<STATUS_VALUES user>>>",
      ]);
      assert.equal(visible, prose, partial);
    }
  });
});
