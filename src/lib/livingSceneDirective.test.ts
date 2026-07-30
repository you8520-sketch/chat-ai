import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildLivingSceneDirective,
  detectPartingOrBoundary,
  detectRepetitionRisk,
  renderLivingSceneDirectiveForPrompt,
} from "@/lib/livingSceneDirective";

describe("livingSceneDirective", () => {
  it("parting input → PARTING_OR_BOUNDARY, eventSource NONE, no tactical/lore", () => {
    const d = buildLivingSceneDirective({
      mode: "interactive",
      recentMessages: [
        { role: "assistant", content: "괜찮아요. 천천히 말해도 돼요." },
        { role: "user", content: "응" },
      ],
      currentUserMessage: "가방끈을 고쳐 메며 말한다. 「난 먼저 들어갈게. 오늘은 그쯤 해도 돼.」",
      lorebookText: "작전 임무 조사 단서 메시지",
      memoryText: "작전 계획 단서",
    });
    assert.equal(d.scenePhase, "PARTING_OR_BOUNDARY");
    assert.equal(d.eventSource, "NONE");
    assert.ok(!d.progressionTypes.includes("active_thread_consequence" as never));
    assert.ok(d.progressionTypes.includes("relationship_aftereffect"));
    assert.ok(d.progressionTypes.includes("future_intent"));
    const block = renderLivingSceneDirectiveForPrompt(d);
    assert.ok(block.includes("[PRIVATE SCENE CONTINUITY RULE]"));
    assert.ok(!block.includes("권장 강도:"));
    assert.ok(
      /\bQUIET\b/.test(block) ||
        /\bORDINARY\b/.test(block) ||
        block.includes("에너지: QUIET") ||
        block.includes("에너지: ORDINARY")
    );
    assert.ok(!block.includes("TARGET_LENGTH"));
  });

  it("lorebook alone does not create tactical direction on quiet turn", () => {
    const d = buildLivingSceneDirective({
      mode: "interactive",
      recentMessages: [{ role: "assistant", content: "로비에서 잠시 숨을 고른다." }],
      currentUserMessage: "창밖을 바라본다.",
      lorebookText: "작전 임무 조사 단서 메시지 보고서",
    });
    assert.equal(d.eventSource, "NONE");
    assert.ok(!d.progressionTypes.some((t) => String(t).includes("tactical")));
    assert.ok(!renderLivingSceneDirectiveForPrompt(d).includes("작전/조사"));
  });

  it("triggered event wins and does not add second event pressure types from lore", () => {
    const d = buildLivingSceneDirective({
      mode: "interactive",
      currentUserMessage: "고개를 든다.",
      lorebookText: "작전 임무",
      triggeredEventText: "[TRIGGERED] 복도 경보",
    });
    assert.equal(d.scenePhase, "TRIGGERED_EVENT");
    assert.equal(d.eventSource, "TRIGGERED_EVENT");
    assert.ok(d.progressionTypes.includes("triggered_event_followthrough"));
  });

  it("active scene from current cue", () => {
    const d = buildLivingSceneDirective({
      mode: "interactive",
      currentUserMessage:
        "경보음이 복도 가까이 번진다. 「여기서 기다리면 더 위험해. 움직이자.」",
    });
    assert.equal(d.scenePhase, "ACTIVE_SCENE");
    assert.ok(d.eventSource === "CURRENT_USER_CUE" || d.eventSource === "RECENT_ACTIVE_THREAD");
  });

  it("detectPartingOrBoundary requires phrase context", () => {
    assert.equal(
      detectPartingOrBoundary("가방끈을 고쳐 메며 말한다. 「난 먼저 들어갈게. 오늘은 그쯤 해도 돼.」"),
      true
    );
    assert.equal(detectPartingOrBoundary("경보가 울린다. 위험해. 작전 시작."), false);
  });

  it("repetition risk does not grant event source", () => {
    const recent = [
      { role: "assistant" as const, content: "괜찮아요. 말하지 않아도 돼요." },
      { role: "user" as const, content: "응..." },
      { role: "assistant" as const, content: "걱정하지 마. 괜찮으니까." },
      { role: "user" as const, content: "미안" },
      { role: "assistant" as const, content: "괜찮다니까. 침묵도 괜찮아." },
      { role: "user" as const, content: "음" },
    ];
    assert.equal(detectRepetitionRisk(recent), true);
    const d = buildLivingSceneDirective({
      mode: "interactive",
      recentMessages: recent,
      currentUserMessage: "고개만 끄덕인다.",
      lorebookText: "단서 작전",
    });
    assert.equal(d.repetitionRisk, true);
    assert.equal(d.eventSource, "NONE");
    assert.ok(d.progressionTypes.includes("character_routine"));
  });
});
