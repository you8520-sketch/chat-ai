import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { sanitizeGenerationPreparationUi } from "@/lib/generationPreparationUi";
import { createStreamReveal } from "@/lib/streamReveal";
import { planSuccessDoneFinalContentReveal } from "@/lib/streamSuccessDoneReconcile";
import { streamRevealOptionsFromInterval } from "@/lib/streamRevealTiming";
import {
  applyExplicitHtmlFlashTurnFlag,
  applyInstantReplaceDuringPostStreamLock,
  applyStatusSseToStreamTurnMode,
  createInitialStreamTurnModeState,
  planStreamDoneRevealDecision,
  resolveInstantRevealAtStreamDone,
  shouldLockPostStreamFromStatusMessage,
} from "@/lib/streamTurnModeClassification";

const TICK = streamRevealOptionsFromInterval(1);
const STREAM_INTERVAL_MS = 28;

/** Fixture strings — route.ts remains the producer owner. */
const NORMAL_STATUS_WIDGET_GENERATION_MESSAGE = "상태창 생성 중…";
const HTML_FLASH_GENERATION_MESSAGE = "HTML 생성 중…";
const PRE_STREAM_STATUS_MESSAGE = "생성 중…";

const PREP_FIXTURE = sanitizeGenerationPreparationUi({
  phase: "preparing",
  badges: ["relationship"],
});

/** Mirrors ChatClient status SSE prep UI ordering (apply prep, then clear if post-stream). */
function finalGenerationPrepUiAfterStatusEvent(
  postStreamLocked: boolean,
  sanitizedPrep: ReturnType<typeof sanitizeGenerationPreparationUi>
): ReturnType<typeof sanitizeGenerationPreparationUi> {
  let finalPrep = null as ReturnType<typeof sanitizeGenerationPreparationUi>;
  if (sanitizedPrep) finalPrep = sanitizedPrep;
  if (postStreamLocked) finalPrep = null;
  return finalPrep;
}

function assertRouteProducesStatusMessage(message: string) {
  const routeSrc = readFileSync("src/app/api/chat/route.ts", "utf8");
  assert.ok(
    routeSrc.includes(`message: "${message}"`),
    `expected route.ts to send status message: ${message}`
  );
}

describe("G37 status widget vs HTML flash — producer inventory strings", () => {
  it("normal widget path uses canonical status message from route.ts", () => {
    assertRouteProducesStatusMessage(NORMAL_STATUS_WIDGET_GENERATION_MESSAGE);
    assert.equal(
      shouldLockPostStreamFromStatusMessage(NORMAL_STATUS_WIDGET_GENERATION_MESSAGE),
      true
    );
  });

  it("HTML flash path uses HTML generation status (post-stream lock only)", () => {
    assertRouteProducesStatusMessage(HTML_FLASH_GENERATION_MESSAGE);
    assert.equal(shouldLockPostStreamFromStatusMessage(HTML_FLASH_GENERATION_MESSAGE), true);
  });
});

describe("G37 status SSE — generation prep UI ordering", () => {
  it("post-stream status clears prep UI last even when generationUi is present", () => {
    let state = createInitialStreamTurnModeState();
    state = applyStatusSseToStreamTurnMode(state, NORMAL_STATUS_WIDGET_GENERATION_MESSAGE);
    assert.equal(state.postStreamLocked, true);
    assert.equal(state.htmlFlashStreamTurn, false);
    assert.equal(
      finalGenerationPrepUiAfterStatusEvent(state.postStreamLocked, PREP_FIXTURE),
      null
    );
  });

  it("pre-stream status preserves prep UI when generationUi is present", () => {
    let state = createInitialStreamTurnModeState();
    state = applyStatusSseToStreamTurnMode(state, PRE_STREAM_STATUS_MESSAGE);
    assert.equal(state.postStreamLocked, false);
    assert.deepEqual(
      finalGenerationPrepUiAfterStatusEvent(state.postStreamLocked, PREP_FIXTURE),
      PREP_FIXTURE
    );
  });
});

describe("G37 P0-2 — pre-fix reproduction (deterministic lifecycle)", () => {
  it("normal Status Widget status must not set htmlFlashStreamTurn", () => {
    let state = createInitialStreamTurnModeState();
    state = applyStatusSseToStreamTurnMode(state, NORMAL_STATUS_WIDGET_GENERATION_MESSAGE);
    assert.equal(state.postStreamLocked, true);
    assert.equal(state.htmlFlashStreamTurn, false);

    state = applyExplicitHtmlFlashTurnFlag(state, false);
    const decision = planStreamDoneRevealDecision({
      streamIntervalMs: STREAM_INTERVAL_MS,
      htmlFlashStreamTurn: state.htmlFlashStreamTurn,
      htmlFlashTurn: false,
      revealIdle: false,
      hasFinalContent: true,
    });
    assert.equal(decision.instantReveal, false);
    assert.equal(decision.forcedFlushAtDone, false);
    assert.equal(decision.pr826DeferPathEntered, true);
  });

  it("legacy regex would have misclassified normal widget status as HTML flash", () => {
    const legacyMisclass = /HTML|상태창 생성/i.test(NORMAL_STATUS_WIDGET_GENERATION_MESSAGE);
    assert.equal(legacyMisclass, true);
    assert.equal(
      applyStatusSseToStreamTurnMode(createInitialStreamTurnModeState(), NORMAL_STATUS_WIDGET_GENERATION_MESSAGE)
        .htmlFlashStreamTurn,
      false
    );
  });
});

describe("G37 stream turn mode — regression matrix", () => {
  it("R1 normal Status Widget message — lock only, no instant reveal", () => {
    let state = createInitialStreamTurnModeState();
    state = applyStatusSseToStreamTurnMode(state, NORMAL_STATUS_WIDGET_GENERATION_MESSAGE);
    assert.equal(state.htmlFlashStreamTurn, false);
    assert.equal(state.postStreamLocked, true);
    const instant = resolveInstantRevealAtStreamDone({
      streamIntervalMs: STREAM_INTERVAL_MS,
      htmlFlashStreamTurn: state.htmlFlashStreamTurn,
      htmlFlashTurn: false,
    });
    assert.equal(instant, false);
  });

  it("R2 actual HTML Flash turn — explicit htmlFlashTurn on done", () => {
    let state = createInitialStreamTurnModeState();
    state = applyStatusSseToStreamTurnMode(state, HTML_FLASH_GENERATION_MESSAGE);
    assert.equal(state.htmlFlashStreamTurn, false);
    state = applyExplicitHtmlFlashTurnFlag(state, true);
    assert.equal(state.htmlFlashStreamTurn, true);
    assert.equal(
      resolveInstantRevealAtStreamDone({
        streamIntervalMs: STREAM_INTERVAL_MS,
        htmlFlashStreamTurn: state.htmlFlashStreamTurn,
        htmlFlashTurn: true,
      }),
      true
    );
  });

  it("R2b HTML visual card — instant replace during post-stream lock", () => {
    let state = createInitialStreamTurnModeState();
    state = applyStatusSseToStreamTurnMode(state, NORMAL_STATUS_WIDGET_GENERATION_MESSAGE);
    assert.equal(state.htmlFlashStreamTurn, false);
    state = applyInstantReplaceDuringPostStreamLock(state, true);
    assert.equal(state.htmlFlashStreamTurn, true);
  });

  it("R3 normal G37 + widget — PR826 defer path, no forced flush", async () => {
    const A = "가".repeat(400);
    const B = "나".repeat(600);
    let displayed = A;
    const streamTarget = A + B;
    let flushCount = 0;

    const reveal = createStreamReveal(
      {
        onAppend: (c) => {
          displayed += c;
        },
      },
      TICK
    );
    const origFlush = reveal.flush.bind(reveal);
    reveal.flush = () => {
      flushCount += 1;
      origFlush();
    };

    reveal.enqueue(B);
    let turnMode = createInitialStreamTurnModeState();
    turnMode = applyStatusSseToStreamTurnMode(
      turnMode,
      NORMAL_STATUS_WIDGET_GENERATION_MESSAGE
    );
    turnMode = applyExplicitHtmlFlashTurnFlag(turnMode, false);

    const decision = planStreamDoneRevealDecision({
      streamIntervalMs: STREAM_INTERVAL_MS,
      htmlFlashStreamTurn: turnMode.htmlFlashStreamTurn,
      htmlFlashTurn: false,
      revealIdle: reveal.isIdle(),
      hasFinalContent: true,
    });
    assert.equal(decision.instantReveal, false);
    assert.equal(decision.forcedFlushAtDone, false);
    assert.equal(decision.pr826DeferPathEntered, true);

    if (!decision.forcedFlushAtDone) {
      const plan = planSuccessDoneFinalContentReveal({
        displayed,
        streamTarget,
        finalContent: streamTarget,
        revealIdle: reveal.isIdle(),
        instantRevealMode: false,
      });
      assert.equal(plan.action, "noop");
    }

    assert.equal(flushCount, 0);
    await reveal.waitUntilIdle();
    assert.equal(displayed, streamTarget);
  });

  it("R4 widget initial empty → repair — status during repair does not force instant", () => {
    let state = createInitialStreamTurnModeState();
    state = applyStatusSseToStreamTurnMode(state, NORMAL_STATUS_WIDGET_GENERATION_MESSAGE);
    assert.equal(state.htmlFlashStreamTurn, false);
    const decision = planStreamDoneRevealDecision({
      streamIntervalMs: STREAM_INTERVAL_MS,
      htmlFlashStreamTurn: state.htmlFlashStreamTurn,
      htmlFlashTurn: false,
      revealIdle: false,
      hasFinalContent: true,
    });
    assert.equal(decision.instantReveal, false);
    assert.equal(decision.pr826DeferPathEntered, true);
  });

  it("R5 no Status Widget — ordinary stream done uses PR826 defer when pending", () => {
    const decision = planStreamDoneRevealDecision({
      streamIntervalMs: STREAM_INTERVAL_MS,
      htmlFlashStreamTurn: false,
      htmlFlashTurn: false,
      revealIdle: false,
      hasFinalContent: true,
    });
    assert.equal(decision.pr826DeferPathEntered, true);
    assert.equal(decision.forcedFlushAtDone, false);
  });
});

describe("G37 ChatClient wiring — no status-string HTML flash heuristic", () => {
  it("ChatClient does not classify status messages via /HTML|상태창 생성/ regex", () => {
    const src = readFileSync("src/app/chat/[id]/ChatClient.tsx", "utf8");
    assert.equal(/HTML\|상태창 생성/i.test(src), false);
    assert.match(src, /applyStatusSseToStreamTurnMode/);
    assert.match(src, /resolveInstantRevealAtStreamDone/);
  });

  it("ChatClient clears generation prep UI after post-stream lock for status events", () => {
    const src = readFileSync("src/app/chat/[id]/ChatClient.tsx", "utf8");
    const statusBlock = src.slice(
      src.indexOf('if (data.type === "status")'),
      src.indexOf('if (data.type === "stream_heartbeat")')
    );
    assert.match(statusBlock, /if \(prep\) \{\s*setGenerationPrepUi\(prep\);\s*\}/);
    assert.match(statusBlock, /if \(nextTurnMode\.postStreamLocked\) \{\s*setGenerationPrepUi\(null\);\s*\}/);
  });
});

describe("G37 reveal.flush owner inventory (ChatClient contract)", () => {
  it("documents flush callsite categories for audit", () => {
    const FLUSH_CALLSITES = [
      "USER_CLICK_CATCHUP",
      "VISIBILITY_RETURN",
      "HTML_INSTANT_DONE",
      "ERROR",
      "TRAFFIC_OVERLOAD",
      "SUCCESS_DONE_OTHER",
    ] as const;
    assert.equal(FLUSH_CALLSITES.length, 6);
    const normalWidgetDecision = planStreamDoneRevealDecision({
      streamIntervalMs: STREAM_INTERVAL_MS,
      htmlFlashStreamTurn: false,
      htmlFlashTurn: false,
      revealIdle: false,
      hasFinalContent: true,
    });
    assert.equal(normalWidgetDecision.forcedFlushAtDone, false);
  });
});
