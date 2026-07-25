import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detectOwnershipShadowV2,
  OWNERSHIP_SHADOW_CATEGORY_LIST,
  OWNERSHIP_SHADOW_DETECTOR_VERSION,
} from "@/lib/ownershipShadowDetectorV2";
import {
  OWNERSHIP_SHADOW_ALL_FIXTURES,
  OWNERSHIP_SHADOW_KNOWN_HARD_VIOLATIONS,
  OWNERSHIP_SHADOW_KNOWN_SAFE_INTERACTIONS,
} from "@/lib/ownershipShadowDetectorV2.fixture";

function topFinding(text: string, opts: Parameters<typeof detectOwnershipShadowV2>[1]) {
  const result = detectOwnershipShadowV2(text, opts);
  return { result, finding: result.findings[0] ?? null };
}

describe("ownership shadow detector v2", () => {
  it("exports version and full category list", () => {
    assert.equal(OWNERSHIP_SHADOW_DETECTOR_VERSION, "v2.0.0");
    assert.equal(OWNERSHIP_SHADOW_CATEGORY_LIST.length, 16);
  });

  it("detects B dialogue, thought, decision with [B] token", () => {
    const dialogue = topFinding('[B]는 말했다. "그래."', { mode: "interactive" });
    assert.equal(dialogue.finding?.category, "CLEAR_B_DIALOGUE");
    assert.equal(dialogue.finding?.severity, "HARD");

    const thought = topFinding("[B]는 생각했다. 이건 내 선택이다.", { mode: "interactive" });
    assert.equal(thought.finding?.category, "CLEAR_B_THOUGHT");
    assert.equal(thought.finding?.severity, "HARD");

    const decision = topFinding("[B]는 결심했다.", { mode: "interactive" });
    assert.equal(decision.finding?.category, "CLEAR_B_DECISION");
    assert.equal(decision.finding?.severity, "HARD");
  });

  it("detects position, voluntary action, perception, medical, expression, preference", () => {
    const cases: Array<[string, string]> = [
      ["렌이 문 앞에 서서 등을 기대고 있었다.", "CLEAR_B_POSITION_POSTURE"],
      ["렌은 가만히 서서 듣고 있었다.", "CLEAR_B_VOLUNTARY_ACTION"],
      ["렌이 그 목소리를 들었다.", "CLEAR_B_PERCEPTION_SENSORY"],
      ["렌의 맥박은 안정적이었다.", "CLEAR_B_MEDICAL_PHYSICAL_STATE"],
      ["렌의 눈동자 속에서 작은 빛이 움직였다.", "CLEAR_B_EXPRESSION_REACTION"],
      ["렌은 한강을 싫어하지 않았다.", "CLEAR_B_UNSTATED_PREFERENCE"],
      ["렌은 겁먹지 않았다.", "CLEAR_B_EMOTION"],
    ];
    for (const [text, category] of cases) {
      const { finding } = topFinding(text, {
        mode: "interactive",
        userAliases: ["렌"],
        actorNames: ["에녹", "이준서"],
      });
      assert.equal(finding?.severity, "HARD", text);
      assert.equal(finding?.category, category, text);
    }
  });

  it("does not hard-flag safe A→B interactions or immediate physical consequences", () => {
    const safeTexts = [
      "에녹이 렌의 팔을 잡아당겼다.",
      "에녹이 렌을 자신의 뒤쪽으로 밀었다.",
      "카일이 렌의 얼굴을 바라보았다.",
      "렌의 몸이 그 힘에 밀려 반 걸음 뒤로 물러났다.",
    ];
    for (const text of safeTexts) {
      const { result } = topFinding(text, {
        mode: "interactive",
        userAliases: ["렌"],
        actorNames: ["에녹", "카일"],
      });
      assert.equal(result.hardCount, 0, text);
    }
  });

  it("detects sustained B position after push as HARD", () => {
    const text = "에녹이 렌을 뒤쪽으로 밀었다. 렌은 에녹의 뒤에 서 있었다.";
    const { result } = topFinding(text, {
      mode: "interactive",
      userAliases: ["렌"],
      actorNames: ["에녹"],
    });
    const hard = result.findings.filter((f) => f.severity === "HARD");
    assert.ok(hard.some((f) => f.category === "CLEAR_B_POSITION_POSTURE"));
  });

  it("supports aliases and Korean particles", () => {
    const aliasHit = topFinding("민수는 생각했다.", {
      mode: "interactive",
      userAliases: ["민수"],
      actorNames: ["캐릭터"],
    });
    assert.equal(aliasHit.finding?.severity, "HARD");
    assert.equal(aliasHit.finding?.personaAliasMatched, "민수");

    const ege = topFinding("캐릭터가 민수에게 다가갔다.", {
      mode: "interactive",
      userAliases: ["민수"],
      actorNames: ["캐릭터"],
    });
    assert.equal(ege.result.hardCount, 0);
  });

  it("grounds only current user input or user-authored history", () => {
    const current = topFinding("렌은 문 앞에 서 있었다.", {
      mode: "interactive",
      userAliases: ["렌"],
      actorNames: ["이준서"],
      currentUserInput: "나는 문 앞에 서 있어.",
    });
    assert.equal(current.result.hardCount, 0);
    assert.ok(current.finding?.contextGrounded);

    const history = topFinding("렌은 손목을 감싸 쥐고 있었다.", {
      mode: "interactive",
      userAliases: ["렌"],
      actorNames: ["이준서"],
      userAuthoredHistory: ["*손목을 감싸 쥔다.*"],
    });
    assert.equal(history.result.hardCount, 0);

    const assistantOnly = topFinding("렌은 여전히 문가에 서 있었다.", {
      mode: "interactive",
      userAliases: ["렌"],
      actorNames: ["이준서"],
    });
    assert.equal(assistantOnly.finding?.severity, "HARD");
  });

  it("handles sentence boundaries in multi-sentence output", () => {
    const text =
      "에녹이 렌의 가슴을 밀었다.\n렌은 여전히 문가에 서 있었다.\n렌은 아무 말도 하지 않았다.";
    const { result } = topFinding(text, {
      mode: "interactive",
      userAliases: ["렌"],
      actorNames: ["에녹"],
    });
    assert.ok(result.hardCount >= 2);
    assert.ok(result.findings.every((f) => f.spanEnd > f.spanStart));
  });

  it("skips interactive-only guard in auto_progression", () => {
    const result = detectOwnershipShadowV2("렌은 여전히 문가에 서 있었다.", {
      mode: "auto_progression",
      userAliases: ["렌"],
    });
    assert.equal(result.findings.length, 0);
  });

  it("passes curated fixture gate expectations", () => {
    for (const entry of OWNERSHIP_SHADOW_ALL_FIXTURES) {
      const result = detectOwnershipShadowV2(entry.text, {
        mode: "interactive",
        userAliases: [entry.userAlias ?? "렌", "[B]", "{{user}}"],
        actorNames: entry.actorNames ?? ["에녹", "이준서", "카일"],
        currentUserInput: entry.currentUserInput,
        userAuthoredHistory: entry.userAuthoredHistory,
      });
      const hard = result.findings.filter((f) => f.severity === "HARD");
      const soft = result.findings.filter((f) => f.severity === "SOFT");
      if (entry.expectedSeverity === "HARD") {
        assert.ok(hard.length >= 1, `${entry.id}: expected HARD`);
      } else if (entry.expectedSeverity === "NONE") {
        assert.equal(hard.length, 0, `${entry.id}: unexpected HARD`);
      } else if (entry.expectedSeverity === "SOFT") {
        assert.ok(soft.length >= 1, `${entry.id}: expected SOFT`);
        assert.equal(hard.length, 0, `${entry.id}: SOFT must not be HARD`);
      }
    }
  });

  it("smoke regression sentences remain covered", () => {
    const smoke = [
      "렌이 문 앞에 서서 등을 기대고 있었다.",
      "렌은 여전히 문가에 서 있었다.",
      "렌의 몸이 그 힘에 밀려 반 걸음 뒤로 물러났다.",
      "렌은 아무 말도 하지 않았다.",
      "렌의 머릿속에서 목소리가 울렸다.",
    ];
    for (const text of smoke) {
      const { result } = topFinding(text, {
        mode: "interactive",
        userAliases: ["렌"],
        actorNames: ["에녹", "이준서"],
      });
      if (text.includes("밀려")) {
        assert.equal(result.hardCount, 0, text);
      } else {
        assert.ok(result.hardCount >= 1, text);
      }
    }
  });
});

describe("ownership shadow detector v2 quality metrics", () => {
  it("reports zero hard false positives on safe interactions", () => {
    for (const entry of OWNERSHIP_SHADOW_KNOWN_SAFE_INTERACTIONS) {
      const result = detectOwnershipShadowV2(entry.text, {
        mode: "interactive",
        userAliases: [entry.userAlias ?? "렌"],
        actorNames: entry.actorNames,
      });
      assert.equal(result.hardCount, 0, entry.text);
    }
  });

  it("detects all curated known hard violations", () => {
    const missed: string[] = [];
    for (const entry of OWNERSHIP_SHADOW_KNOWN_HARD_VIOLATIONS) {
      const result = detectOwnershipShadowV2(entry.text, {
        mode: "interactive",
        userAliases: [entry.userAlias ?? "렌"],
        actorNames: entry.actorNames,
      });
      if (result.hardCount === 0) missed.push(entry.text);
    }
    assert.deepEqual(missed, []);
  });
});
