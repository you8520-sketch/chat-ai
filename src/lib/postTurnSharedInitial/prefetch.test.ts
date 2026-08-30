import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { statusWidgetDiagnosticHash } from "@/lib/statusWidget/diagnostics";
import {
  hashAssistantProseForSuggestionPrefetch,
  resolvePrefetchedSuggestedReplies,
} from "./prefetch";

const VALID_REPLIES = [
  { kind: "escalate" as const, text: "*손을 뻗으며* \"잠깐, 그 말부터 다시 들어보자.\" *눈을 맞추며*" },
  { kind: "soften" as const, text: "*미소 지으며* \"괜찮아, 천천히 말해도 돼.\" *어깨를 풀며*" },
  { kind: "pivot" as const, text: "*시계를 보며* \"일단 밥부터 먹고 얘기할까?\" *문 쪽을 가리키며*" },
];

describe("T14/T15 shared suggestion prose fingerprint", () => {
  it("T15 final prose unchanged — valid prefetch kept", () => {
    const prose = "*그는 고개를 들었다.* \"안녕.\"";
    const hash = hashAssistantProseForSuggestionPrefetch(prose);
    const kept = resolvePrefetchedSuggestedReplies({
      prefetched: VALID_REPLIES,
      prefetchAssistantProseHash: hash,
      finalAssistantProse: prose,
    });
    assert.deepEqual(kept, VALID_REPLIES);
  });

  it("T14 final prose changed — stale prefetch discarded", () => {
    const sharedInputProse = "*그는 고개를 들었다.* \"안녕.\"";
    const finalProse = "*그는 고개를 들었다.* \"안녕.\" *미소.*";
    const hash = hashAssistantProseForSuggestionPrefetch(sharedInputProse);
    assert.notEqual(statusWidgetDiagnosticHash(finalProse), hash);
    const kept = resolvePrefetchedSuggestedReplies({
      prefetched: VALID_REPLIES,
      prefetchAssistantProseHash: hash,
      finalAssistantProse: finalProse,
    });
    assert.equal(kept, null);
  });

  it("prefetch present but hash missing — fail-closed discard", () => {
    const kept = resolvePrefetchedSuggestedReplies({
      prefetched: VALID_REPLIES,
      prefetchAssistantProseHash: null,
      finalAssistantProse: "*그는 고개를 들었다.* \"안녕.\"",
    });
    assert.equal(kept, null);
  });
});
