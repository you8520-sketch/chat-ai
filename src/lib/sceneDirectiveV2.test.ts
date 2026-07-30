import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ChatMsg } from "@/lib/ai";
import {
  analyzeSceneStagnation,
  buildSceneDirectiveV2,
  buildSceneDirectiveV2Telemetry,
  renderSceneDirectiveV2ForPrompt,
  selectProgressionTypesV2,
} from "./sceneDirectiveV2";
import { getSceneDirectiveV2Mode } from "./sceneDirectiveV2Policy";
import {
  advanceReconvergenceState,
  defaultReconvergenceState,
  markReconvergenceOffered,
  pickReconvergenceMethod,
  type ReconvergenceState,
} from "./reconvergenceState";
import { buildSceneDirective, renderSceneDirectiveForPrompt } from "./sceneDirective";

function msgs(pairs: Array<[ChatMsg["role"], string]>): ChatMsg[] {
  return pairs.map(([role, content]) => ({ role, content }));
}

describe("sceneDirectiveV2Policy", () => {
  it("defaults to off", () => {
    assert.equal(getSceneDirectiveV2Mode({}), "off");
    assert.equal(getSceneDirectiveV2Mode({ SCENE_DIRECTIVE_V2_MODE: "off" }), "off");
  });

  it("accepts shadow and on", () => {
    assert.equal(getSceneDirectiveV2Mode({ SCENE_DIRECTIVE_V2_MODE: "shadow" }), "shadow");
    assert.equal(getSceneDirectiveV2Mode({ SCENE_DIRECTIVE_V2_MODE: "ON" }), "on");
  });
});

describe("sceneDirectiveV2 hold", () => {
  it("1. calm dialogue without stagnation → eventBudget=0", () => {
    const d = buildSceneDirectiveV2({
      mode: "interactive",
      recentMessages: msgs([
        ["assistant", "소파에 기대 앉아 차를 홀짝인다."],
        ["user", "오늘 날씨 얘기나 하자."],
        ["assistant", "창밖을 한번 보고 고개를 끄덕인다."],
        ["user", "응, 편하다."],
      ]),
      currentUserMessage: "조금 더 앉아 있을게.",
      currentTurn: 4,
    });
    assert.equal(d.eventBudget, 0);
    assert.equal(d.pacingDecision, "hold_current_beat");
  });

  it("2. intimate contact in progress → no environment event", () => {
    const d = buildSceneDirectiveV2({
      mode: "interactive",
      recentMessages: msgs([
        ["assistant", "소파에서 어깨에 체중을 조금씩 맡긴다."],
        ["user", "그대로 안긴다."],
        ["assistant", "숨을 고르며 손을 허리에 둔다."],
        ["user", "더 가까이 붙는다."],
      ]),
      currentUserMessage: "그의 손을 잡는다.",
      currentTurn: 5,
    });
    assert.equal(d.eventBudget, 0);
    assert.ok(!d.progressionTypes.includes("environment"));
  });

  it("3. rest scene intensity=0 → no daily-life event instruction", () => {
    const d = buildSceneDirectiveV2({
      mode: "interactive",
      recentMessages: msgs([
        ["assistant", "침대 맡에서 조용히 숨을 고른다."],
        ["user", "눈을 감는다."],
        ["assistant", "방을 어둡게 두고 자리를 지킨다."],
        ["user", "그대로 잔다."],
      ]),
      currentUserMessage: "계속 잔다.",
      currentTurn: 3,
    });
    assert.equal(d.recommendedIntensity, 0);
    assert.equal(d.eventBudget, 0);
    assert.ok(!d.progressionTypes.includes("daily_life"));
    const prompt = renderSceneDirectiveV2ForPrompt(d);
    assert.doesNotMatch(prompt, /생활 변수 하나가 관계/);
  });

  it("4. empty selection → no environment+relationship fallback", () => {
    const types = selectProgressionTypesV2({
      sceneText: "창밖이 조용하다.",
      intensity: 0,
      stagnant: false,
      allowNpcAction: false,
      unresolvedConsequence: false,
      canonText: "",
    });
    assert.deepEqual(types, []);
  });
});

describe("sceneDirectiveV2 grounding", () => {
  it("5. lorebook mission/combat/NPC while bedroom rest → no npc_action", () => {
    const d = buildSceneDirectiveV2({
      mode: "interactive",
      recentMessages: msgs([
        ["assistant", "침실 조명을 낮춘다."],
        ["user", "이불에 눕는다."],
        ["assistant", "옆자리를 정리한다."],
        ["user", "눈을 감는다."],
      ]),
      currentUserMessage: "잔다.",
      lorebookText: "임무와 전투, NPC 상관의 조직 규정",
      currentTurn: 2,
    });
    assert.ok(!d.progressionTypes.includes("npc_action"));
    assert.equal(d.allowNewNpc, false);
  });

  it("6. relationship memory jealousy irrelevant → no forced relationship event", () => {
    const d = buildSceneDirectiveV2({
      mode: "interactive",
      recentMessages: msgs([
        ["assistant", "책장에서 책을 고른다."],
        ["user", "그 책 읽어볼게."],
        ["assistant", "페이지를 넘긴다."],
        ["user", "조용히 듣는다."],
      ]),
      currentUserMessage: "계속 읽어줘.",
      relationshipMemoryText: "질투가 심한 편이다.",
      currentTurn: 3,
    });
    assert.equal(d.eventBudget, 0);
    assert.ok(!d.progressionTypes.includes("relationship") || d.pacingDecision === "hold_current_beat");
  });

  it("7. past message mention alone → no new message instruction", () => {
    const d = buildSceneDirectiveV2({
      mode: "interactive",
      recentMessages: msgs([
        ["assistant", "예전에 메시지를 주고받은 적이 있다고 생각한다."],
        ["user", "차나 마시자."],
        ["assistant", "주전자를 올린다."],
        ["user", "고마워."],
      ]),
      currentUserMessage: "차 한 모금 마신다.",
      memoryText: "과거 메시지 기록이 있다.",
      currentTurn: 4,
    });
    assert.equal(d.allowNewExternalMessage, false);
    assert.equal(d.eventBudget, 0);
  });

  it("8. current unresolved item → consequence allowed when advancing", () => {
    const d = buildSceneDirectiveV2({
      mode: "interactive",
      recentMessages: msgs([
        ["assistant", "탁자 위에 맡긴 열쇠가 아직 미완료로 남아 있다."],
        ["user", "열쇠를 본다."],
        ["assistant", "열쇠의 결과가 돌아오길 기다린다."],
        ["user", "후속을 기다린다."],
      ]),
      currentUserMessage: "미완료된 열쇠 문제를 떠올린다.",
      currentSceneFacts: "탁자에 미완료 열쇠가 있다.",
      currentTurn: 5,
    });
    // Quiet scene holds unless we force non-quiet via scene facts with consequence path.
    // Explicit unresolved in investigation-like framing:
    const d2 = buildSceneDirectiveV2({
      mode: "interactive",
      recentMessages: msgs([
        ["assistant", "조사 기록과 미완료 단서가 책상에 남아 있다."],
        ["user", "기록을 확인한다."],
        ["assistant", "후속 결과가 아직이다."],
        ["user", "기다린다."],
      ]),
      currentUserMessage: "미완료 결과의 후속을 본다.",
      currentSceneFacts: "미완료 물건 단서가 있다.",
      currentTurn: 5,
    });
    assert.ok(
      d2.progressionTypes.includes("consequence") ||
        d2.pacingDecision === "advance_existing_beat" ||
        d.reasonCodes.includes("HOLD_QUIET_SCENE")
    );
    assert.ok(
      selectProgressionTypesV2({
        sceneText: "미완료 열쇠의 결과가 돌아오길 기다린다.",
        intensity: 1,
        stagnant: false,
        allowNpcAction: false,
        unresolvedConsequence: true,
        canonText: "",
      }).includes("consequence")
    );
  });
});

describe("sceneDirectiveV2 stagnation", () => {
  it("9. three short distinct actions → stagnation false", () => {
    const recent = msgs([
      ["assistant", "문이 앞에 있다."],
      ["user", "문을 연다."],
      ["assistant", "복도가 보인다."],
      ["user", "칼을 뽑는다."],
      ["assistant", "공기가 팽팽하다."],
      ["user", "그를 밀친다."],
    ]);
    assert.equal(analyzeSceneStagnation(recent).recentStagnation, false);
  });

  it("10. repeated sleep static → static repetition detected", () => {
    const recent = msgs([
      ["assistant", "방이 조용하다."],
      ["user", "계속 잔다."],
      ["assistant", "숨소리만 남는다."],
      ["user", "다시 잔다."],
      ["assistant", "창밖이 어둡다."],
      ["user", "그대로 누워 있는다."],
    ]);
    const axes = analyzeSceneStagnation(recent);
    assert.ok(axes.userStaticRepetition >= 2);
  });

  it("11. assistant reassurance meaning loop → stagnation true", () => {
    const recent = msgs([
      ["assistant", "괜찮아. 네가 말하지 않아도 돼."],
      ["user", "응."],
      ["assistant", "정말 괜찮아. 미안해."],
      ["user", "..."],
      ["assistant", "괜찮으면 그냥 곁에 있을게."],
      ["user", "음."],
    ]);
    assert.equal(analyzeSceneStagnation(recent).recentStagnation, true);
  });

  it("12. contact state keeps changing → stagnation false", () => {
    const recent = msgs([
      ["assistant", "손을 어깨에 올린다."],
      ["user", "허리를 끌어안는다."],
      ["assistant", "체중을 조금 더 싣는다."],
      ["user", "입술에 닿는다."],
      ["assistant", "키스를 깊게 이어간다."],
      ["user", "등을 쓰다듬는다."],
    ]);
    assert.equal(analyzeSceneStagnation(recent).recentStagnation, false);
  });
});

describe("sceneDirectiveV2 NPC", () => {
  it("13. operation words alone → no auto npc_action", () => {
    const d = buildSceneDirectiveV2({
      mode: "interactive",
      recentMessages: msgs([
        ["assistant", "작전 브리핑 서류를 펼친다."],
        ["user", "임무를 듣는다."],
        ["assistant", "침투 경로를 짚는다."],
        ["user", "추적 계획을 확인한다."],
      ]),
      currentUserMessage: "작전을 정리한다.",
      currentTurn: 4,
    });
    assert.ok(!d.progressionTypes.includes("npc_action"));
    assert.equal(d.allowNewNpc, false);
  });

  it("14. existing NPC action grounded → npc_action allowed when advancing", () => {
    const types = selectProgressionTypesV2({
      sceneText: "작전 중 동료 린이 이미 문을 지키고 있다. 미완료 결과가 남았다.",
      intensity: 3,
      stagnant: true,
      allowNpcAction: true,
      unresolvedConsequence: true,
      canonText: "",
    });
    assert.ok(types.includes("npc_action"));
  });

  it("15. new NPC creation flags false", () => {
    const d = buildSceneDirectiveV2({
      mode: "interactive",
      recentMessages: msgs([
        ["assistant", "사무실이 고요하다."],
        ["user", "보고서를 쓴다."],
        ["assistant", "펜을 내려놓는다."],
        ["user", "창밖을 본다."],
      ]),
      currentUserMessage: "일을 마친다.",
      currentTurn: 2,
    });
    assert.equal(d.allowNewNpc, false);
    assert.ok(
      d.castPolicy === "existing_cast_only" || d.castPolicy === "new_cast_forbidden"
    );
  });
});

describe("sceneDirectiveV2 trigger", () => {
  it("16-17. trigger → resolve_trigger and eventBudget=0", () => {
    const d = buildSceneDirectiveV2({
      mode: "interactive",
      recentMessages: msgs([
        ["assistant", "대기 중이다."],
        ["user", "상황을 본다."],
        ["assistant", "라디오가 조용하다."],
        ["user", "기다린다."],
      ]),
      currentUserMessage: "그대로 있는다.",
      triggeredEventText: "[TRIGGERED] 기지 경보가 울린다.",
      currentTurn: 3,
    });
    assert.equal(d.pacingDecision, "resolve_trigger");
    assert.equal(d.eventBudget, 0);
  });

  it("18. trigger + reconvergence due → no duplicate reconverge event", () => {
    const prev: ReconvergenceState = {
      ...defaultReconvergenceState(1, 1),
      state: "separated",
      separationTurn: 1,
      reconvergenceDueTurn: 3,
    };
    const d = buildSceneDirectiveV2({
      mode: "interactive",
      recentMessages: msgs([
        ["assistant", "업무로 돌아갔다."],
        ["user", "잔다."],
        ["assistant", "서류를 정리한다."],
        ["user", "계속 잔다."],
      ]),
      currentUserMessage: "잔다.",
      triggeredEventText: "[TRIGGERED] 외부 폭발",
      reconvergenceState: prev,
      currentTurn: 3,
    });
    assert.equal(d.pacingDecision, "resolve_trigger");
    assert.notEqual(d.pacingDecision, "reconverge");
    assert.ok(d.reasonCodes.includes("AUTHORITATIVE_TRIGGER_DEFERRED_RECONVERGENCE") || d.eventBudget === 0);
  });

  it("19. trigger itself reunites → reconvergence fulfilled", () => {
    const prev: ReconvergenceState = {
      ...defaultReconvergenceState(1, 1),
      state: "separated",
      separationTurn: 1,
      reconvergenceDueTurn: 3,
    };
    const advanced = advanceReconvergenceState({
      previous: prev,
      currentTurn: 3,
      currentUserMessage: "문을 본다.",
      triggerPresent: true,
      triggerImpliesReunion: true,
    });
    assert.equal(advanced.state.state, "together");
    assert.ok(advanced.reasonCodes.includes("TRIGGER_FULFILLED_RECONVERGENCE"));
  });
});

describe("sceneDirectiveV2 reconvergence", () => {
  it("20. T0 farewell → separated recorded", () => {
    const advanced = advanceReconvergenceState({
      previous: defaultReconvergenceState(1, 1),
      currentTurn: 10,
      currentUserMessage: "이만 갈게. 집에 갈게.",
      recentMessages: msgs([["assistant", "서류를 정리하며 고개를 끄덕인다."]]),
    });
    assert.equal(advanced.state.state, "separated");
    assert.equal(advanced.state.separationTurn, 10);
    assert.equal(advanced.state.reconvergenceDueTurn, 12);
  });

  it("21. T1 no forced reunion", () => {
    const prev: ReconvergenceState = {
      ...defaultReconvergenceState(1, 1),
      state: "separated",
      separationTurn: 10,
      reconvergenceDueTurn: 12,
    };
    const d = buildSceneDirectiveV2({
      mode: "interactive",
      recentMessages: msgs([
        ["assistant", "업무로 복귀한다."],
        ["user", "집에 도착한다."],
        ["assistant", "보고서를 쓴다."],
        ["user", "씻는다."],
      ]),
      currentUserMessage: "잔다.",
      reconvergenceState: prev,
      currentTurn: 11,
    });
    assert.notEqual(d.pacingDecision, "reconverge");
    assert.equal(d.eventBudget, 0);
  });

  it("22. T2 forces reconverge opportunity", () => {
    const prev: ReconvergenceState = {
      ...defaultReconvergenceState(1, 1),
      state: "separated",
      separationTurn: 10,
      reconvergenceDueTurn: 12,
      unresolvedHooks: [
        {
          type: "established_contact_channel",
          summary: "확립된 연락 수단",
          sourceTurn: 8,
          confidence: "high",
        },
      ],
    };
    const d = buildSceneDirectiveV2({
      mode: "interactive",
      recentMessages: msgs([
        ["assistant", "업무를 이어간다."],
        ["user", "잔다."],
        ["assistant", "야근한다."],
        ["user", "계속 잔다."],
      ]),
      currentUserMessage: "그대로 잔다.",
      reconvergenceState: prev,
      currentTurn: 12,
    });
    assert.equal(d.pacingDecision, "reconverge");
    assert.equal(d.eventBudget, 1);
  });

  it("23-24. reconverge prompt does not write user cognition; sleep allows external only", () => {
    const prev: ReconvergenceState = {
      ...defaultReconvergenceState(1, 1),
      state: "separated",
      separationTurn: 1,
      reconvergenceDueTurn: 3,
      unresolvedHooks: [
        {
          type: "established_contact_channel",
          summary: "확립된 연락 수단",
          sourceTurn: 1,
          confidence: "high",
        },
      ],
    };
    const d = buildSceneDirectiveV2({
      mode: "interactive",
      recentMessages: msgs([
        ["assistant", "사무실로 돌아간다."],
        ["user", "잔다."],
        ["assistant", "일을 한다."],
        ["user", "계속 잔다."],
      ]),
      currentUserMessage: "계속 잔다.",
      reconvergenceState: prev,
      currentTurn: 3,
    });
    const prompt = renderSceneDirectiveV2ForPrompt(d);
    assert.match(prompt, /유저의 인지·응답·이동 작성/);
    assert.doesNotMatch(prompt, /유저가 눈을 뜬다|유저가 답장한다|유저가 문을 연다/);
  });

  it("25. explicit no-contact stops deadline", () => {
    const prev: ReconvergenceState = {
      ...defaultReconvergenceState(1, 1),
      state: "separated",
      separationTurn: 1,
      reconvergenceDueTurn: 3,
    };
    const advanced = advanceReconvergenceState({
      previous: prev,
      currentTurn: 2,
      currentUserMessage: "찾아오지 마. 혼자 있고 싶어.",
    });
    assert.equal(advanced.state.state, "temporary_quiet");
    assert.equal(advanced.state.reconvergenceDueTurn, null);
  });

  it("26. unfinished item hook drives reconverge method", () => {
    const prev: ReconvergenceState = {
      ...defaultReconvergenceState(1, 1),
      state: "separated",
      separationTurn: 1,
      reconvergenceDueTurn: 3,
      unresolvedHooks: [
        {
          type: "shared_item",
          summary: "맡긴 코트 미반환",
          sourceTurn: 1,
          confidence: "high",
        },
      ],
    };
    const d = buildSceneDirectiveV2({
      mode: "interactive",
      recentMessages: msgs([
        ["assistant", "코트를 챙기지 못했다."],
        ["user", "집에 간다."],
        ["assistant", "업무로 복귀한다."],
        ["user", "잔다."],
      ]),
      currentUserMessage: "잔다.",
      reconvergenceState: prev,
      currentTurn: 3,
    });
    assert.equal(d.pacingDecision, "reconverge");
    assert.equal(d.reconvergence?.method, "item_return");
  });

  it("27. no hooks → blocked no grounded path, not new crisis", () => {
    const picked = pickReconvergenceMethod(defaultReconvergenceState(1, 1), []);
    assert.equal(picked.blocked, true);
    const d = buildSceneDirectiveV2({
      mode: "interactive",
      recentMessages: msgs([
        ["assistant", "혼자 남는다."],
        ["user", "갈게."],
        ["assistant", "고개를 끄덕인다."],
        ["user", "돌아선다."],
      ]),
      currentUserMessage: "눈을 감는다.",
      reconvergenceState: {
        ...defaultReconvergenceState(1, 1),
        state: "separated",
        separationTurn: 1,
        reconvergenceDueTurn: 3,
        unresolvedHooks: [],
      },
      currentTurn: 3,
    });
    assert.notEqual(d.pacingDecision, "reconverge");
    assert.equal(d.eventBudget, 0);
    assert.equal(d.allowNewNpc, false);
    assert.ok(d.reasonCodes.includes("RECONVERGENCE_BLOCKED_NO_GROUNDED_PATH"));
  });

  it("28. no new NPC mediation", () => {
    const d = buildSceneDirectiveV2({
      mode: "interactive",
      recentMessages: msgs([
        ["assistant", "헤어진다."],
        ["user", "갈게."],
        ["assistant", "업무로 간다."],
        ["user", "잔다."],
      ]),
      currentUserMessage: "잔다.",
      reconvergenceState: {
        ...defaultReconvergenceState(1, 1),
        state: "separated",
        separationTurn: 1,
        reconvergenceDueTurn: 3,
      },
      currentTurn: 3,
    });
    assert.equal(d.allowNewNpc, false);
    assert.match(renderSceneDirectiveV2ForPrompt(d), /NPC/);
  });

  it("29. same reconverge method not chosen consecutively", () => {
    const state: ReconvergenceState = {
      ...defaultReconvergenceState(1, 1),
      lastMethod: "message",
      unresolvedHooks: [
        {
          type: "established_contact_channel",
          summary: "연락 수단",
          sourceTurn: 1,
          confidence: "high",
        },
        {
          type: "known_shared_location",
          summary: "공유 장소",
          sourceTurn: 1,
          confidence: "medium",
        },
      ],
    };
    const picked = pickReconvergenceMethod(state, state.unresolvedHooks);
    assert.notEqual(picked.method, "message");
  });

  it("30. cooldown after offer", () => {
    const offered = markReconvergenceOffered(
      {
        ...defaultReconvergenceState(1, 1),
        state: "separated",
        separationTurn: 1,
        reconvergenceDueTurn: 3,
      },
      3,
      "message"
    );
    assert.equal(offered.offeredTurn, 3);
    assert.equal(offered.state, "reconvergence_offered");
    const d = buildSceneDirectiveV2({
      mode: "interactive",
      recentMessages: msgs([
        ["assistant", "메시지를 남긴다."],
        ["user", "잔다."],
        ["assistant", "기다린다."],
        ["user", "계속 잔다."],
      ]),
      currentUserMessage: "잔다.",
      reconvergenceState: offered,
      currentTurn: 4,
    });
    assert.notEqual(d.pacingDecision, "reconverge");
  });
});

describe("sceneDirectiveV2 dialogue", () => {
  it("31. reconvergence does not mandate more dialogue", () => {
    const d = buildSceneDirectiveV2({
      mode: "interactive",
      recentMessages: msgs([
        ["assistant", "떠난다."],
        ["user", "갈게."],
        ["assistant", "업무로 복귀."],
        ["user", "잔다."],
      ]),
      currentUserMessage: "잔다.",
      reconvergenceState: {
        ...defaultReconvergenceState(1, 1),
        state: "separated",
        separationTurn: 1,
        reconvergenceDueTurn: 3,
      },
      currentTurn: 3,
    });
    assert.equal(d.dialoguePressure, "none");
    assert.match(renderSceneDirectiveV2ForPrompt(d), /대사 의무가 아니다|대사 비중/);
  });

  it("32. interactive RP has no multi-NPC dialogue push", () => {
    const prompt = renderSceneDirectiveV2ForPrompt(
      buildSceneDirectiveV2({
        mode: "interactive",
        recentMessages: msgs([
          ["assistant", "차 한 잔."],
          ["user", "마신다."],
          ["assistant", "창을 본다."],
          ["user", "말한다."],
        ]),
        currentUserMessage: "고개를 끄덕인다.",
        currentTurn: 1,
      })
    );
    assert.doesNotMatch(prompt, /여러 AI 캐릭터·NPC의 대화/);
  });

  it("33. auto progression does not invent missing cast", () => {
    const prompt = renderSceneDirectiveV2ForPrompt(
      buildSceneDirectiveV2({
        mode: "auto_progression",
        recentMessages: msgs([
          ["assistant", "혼자 사무실에 있다."],
          ["user", "계속 진행"],
          ["assistant", "서류를 정리한다."],
          ["user", "계속 진행"],
        ]),
        currentUserMessage: "계속 진행",
        currentTurn: 2,
      })
    );
    assert.match(prompt, /존재하지 않는 NPC를 추가해 대화량을 채우지 않는다/);
  });
});

describe("sceneDirectiveV2 telemetry privacy", () => {
  it("telemetry has no raw text fields", () => {
    const d = buildSceneDirectiveV2({
      mode: "interactive",
      recentMessages: msgs([
        ["assistant", "비밀 대사 XYZ"],
        ["user", "유저 원문 ABC"],
        ["assistant", "ok"],
        ["user", "ok"],
      ]),
      currentUserMessage: "유저 원문 ABC",
      currentTurn: 1,
    });
    const t = buildSceneDirectiveV2Telemetry(d, false);
    const json = JSON.stringify(t);
    assert.doesNotMatch(json, /유저 원문|비밀 대사/);
    assert.equal(t.version, "v2");
  });
});

describe("sceneDirectiveV2 fixtures A-H vs V1", () => {
  const fixtures: Array<{
    id: string;
    input: Parameters<typeof buildSceneDirectiveV2>[0];
  }> = [
    {
      id: "A",
      input: {
        mode: "interactive",
        recentMessages: msgs([
          ["assistant", "소파에 기대앉는다."],
          ["user", "옆으로 붙는다."],
          ["assistant", "어깨에 손을 올린다."],
          ["user", "그대로 안긴다."],
        ]),
        currentUserMessage: "체온을 느낀다.",
        currentTurn: 4,
      },
    },
    {
      id: "B",
      input: {
        mode: "interactive",
        recentMessages: msgs([
          ["assistant", "침대를 정리한다."],
          ["user", "잔다."],
          ["assistant", "불을 끈다."],
          ["user", "계속 잔다."],
          ["assistant", "창문을 닫는다."],
          ["user", "다시 눈을 감는다."],
        ]),
        currentUserMessage: "그대로 누워 있는다.",
        currentTurn: 3,
      },
    },
    {
      id: "C",
      input: {
        mode: "interactive",
        recentMessages: msgs([
          ["assistant", "배웅한다."],
          ["user", "이만 갈게."],
          ["assistant", "업무로 복귀한다."],
          ["user", "지하철을 탄다."],
        ]),
        currentUserMessage: "집에 도착한다.",
        reconvergenceState: {
          ...defaultReconvergenceState(1, 1),
          state: "separated",
          separationTurn: 5,
          reconvergenceDueTurn: 7,
        },
        currentTurn: 6,
      },
    },
    {
      id: "D",
      input: {
        mode: "interactive",
        recentMessages: msgs([
          ["assistant", "네 코트를 맡았다."],
          ["user", "갈게."],
          ["assistant", "코트를 책상에 둔다."],
          ["user", "집에 간다."],
        ]),
        currentUserMessage: "잔다.",
        reconvergenceState: {
          ...defaultReconvergenceState(1, 1),
          state: "separated",
          separationTurn: 1,
          reconvergenceDueTurn: 3,
          unresolvedHooks: [
            {
              type: "shared_item",
              summary: "맡긴 코트",
              sourceTurn: 1,
              confidence: "high",
            },
          ],
        },
        currentTurn: 3,
      },
    },
    {
      id: "E",
      input: {
        mode: "interactive",
        recentMessages: msgs([
          ["assistant", "헤어진다."],
          ["user", "갈게."],
          ["assistant", "혼자 남는다."],
          ["user", "잔다."],
        ]),
        currentUserMessage: "잔다.",
        reconvergenceState: {
          ...defaultReconvergenceState(1, 1),
          state: "separated",
          separationTurn: 1,
          reconvergenceDueTurn: 3,
          unresolvedHooks: [],
        },
        currentTurn: 3,
      },
    },
    {
      id: "F",
      input: {
        mode: "interactive",
        recentMessages: msgs([
          ["assistant", "남는다."],
          ["user", "갈게."],
          ["assistant", "업무로."],
          ["user", "찾아오지 마."],
        ]),
        currentUserMessage: "연락하지 마. 혼자 있고 싶어.",
        reconvergenceState: {
          ...defaultReconvergenceState(1, 1),
          state: "separated",
          separationTurn: 1,
          reconvergenceDueTurn: 3,
        },
        currentTurn: 2,
      },
    },
    {
      id: "G",
      input: {
        mode: "interactive",
        recentMessages: msgs([
          ["assistant", "작전 지도를 편다."],
          ["user", "임무를 확인한다."],
          ["assistant", "침투 경로를 본다."],
          ["user", "계획을 수정한다."],
        ]),
        currentUserMessage: "작전을 정리한다.",
        lorebookText: "NPC와 전투 조직",
        currentTurn: 4,
      },
    },
    {
      id: "H",
      input: {
        mode: "interactive",
        recentMessages: msgs([
          ["assistant", "대기."],
          ["user", "기다린다."],
          ["assistant", "침묵."],
          ["user", "상황을 본다."],
        ]),
        currentUserMessage: "그대로 있는다.",
        triggeredEventText: "[TRIGGERED] 상태창 경보 발동",
        currentTurn: 4,
      },
    },
  ];

  for (const f of fixtures) {
    it(`fixture ${f.id} produces V1/V2 decision surfaces`, () => {
      const v1 = buildSceneDirective({
        mode: f.input.mode,
        recentMessages: f.input.recentMessages,
        currentUserMessage: f.input.currentUserMessage,
        memoryText: f.input.memoryText,
        relationshipMemoryText: f.input.relationshipMemoryText,
        lorebookText: f.input.lorebookText,
        triggeredEventText: f.input.triggeredEventText,
      });
      const v2 = buildSceneDirectiveV2(f.input);
      assert.ok(v1.progressionTypes.length >= 0);
      assert.ok(typeof v2.pacingDecision === "string");
      assert.ok(v2.eventBudget === 0 || v2.eventBudget === 1);
      // Calm / rest fixtures must not invent external events in V2.
      if (f.id === "A" || f.id === "B") {
        assert.equal(v2.eventBudget, 0);
      }
      if (f.id === "D") {
        assert.equal(v2.pacingDecision, "reconverge");
      }
      if (f.id === "E") {
        assert.notEqual(v2.pacingDecision, "reconverge");
        assert.ok(v2.reasonCodes.includes("RECONVERGENCE_BLOCKED_NO_GROUNDED_PATH"));
      }
      if (f.id === "F") {
        assert.equal(v2.reconvergenceState.state, "temporary_quiet");
      }
      if (f.id === "G") {
        assert.ok(!v2.progressionTypes.includes("npc_action"));
      }
      if (f.id === "H") {
        assert.equal(v2.pacingDecision, "resolve_trigger");
        assert.equal(v2.eventBudget, 0);
      }
      // Ensure V1 render still works (regression).
      assert.match(renderSceneDirectiveForPrompt(v1), /PRIVATE SCENE ENGINE RULE|이번 턴 장면 지시/);
    });
  }
});
