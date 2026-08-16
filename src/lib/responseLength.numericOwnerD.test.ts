import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import {
  GEMINI37_FLASH_NUMERIC_OWNER_MODEL_ID,
  USER_TAIL_LENGTH_OWNER_SENTENCE,
  appendCompactTerminalLengthToUserTurn,
  formatUserTailLengthOwnerAimChars,
  resolveUserTailLengthOwnerAimChars,
  resolveUserTailLengthOwnerSentence,
} from "@/lib/responseLength";

const VANILLA =
  "이번 응답은 한국어 3,200자 이상을 기본 목표로 하나의 충분히 전개된 장면으로 작성한다. 장면에 필요한 내용이 있으면 더 길게 이어간다. 현재 상호작용을 요약하거나 성급히 닫지 말고, 관찰·행동·대사·감각·심리가 서로 다음 변화를 일으키도록 충분히 전개한다.";

function countOccurrences(hay: string, needle: string): number {
  let c = 0;
  let i = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) {
    c++;
    i += needle.length;
  }
  return c;
}

function assertNumericOwnerOnlyDiff(a: string, b: string) {
  assert.equal(b, a.replaceAll("3,200", "4,000"));
  assert.equal(a.replaceAll("3,200", ""), b.replaceAll("4,000", ""));
  assert.match(a, /3,200/);
  assert.match(b, /4,000/);
  assert.doesNotMatch(a, /4,000/);
  assert.doesNotMatch(b, /3,200/);
}

async function withServerOnlyMock<T>(fn: () => Promise<T>): Promise<T> {
  const require = createRequire(import.meta.url);
  require.cache[require.resolve("server-only")] = {
    exports: {},
    loaded: true,
    id: "server-only",
    filename: "server-only",
  } as NodeModule;
  return fn();
}

describe("Experiment D — vanilla owner numeric-only", () => {
  it("keeps one template; default and arm A stay 3,200", () => {
    assert.equal(USER_TAIL_LENGTH_OWNER_SENTENCE, VANILLA);
    assert.equal(resolveUserTailLengthOwnerSentence(), VANILLA);
    assert.equal(
      resolveUserTailLengthOwnerSentence({
        modelId: GEMINI37_FLASH_NUMERIC_OWNER_MODEL_ID,
        experimentArm: "A",
      }),
      VANILLA
    );
    assert.equal(
      resolveUserTailLengthOwnerSentence({
        modelId: GEMINI37_FLASH_NUMERIC_OWNER_MODEL_ID,
      }),
      VANILLA
    );
    assert.equal(
      resolveUserTailLengthOwnerAimChars({
        modelId: "deepseek-v4-pro",
        experimentArm: "B",
      }),
      3200
    );
  });

  it("arm B on Gemini 3.7 Flash changes only 3,200 -> 4,000", () => {
    const a = resolveUserTailLengthOwnerSentence({
      modelId: GEMINI37_FLASH_NUMERIC_OWNER_MODEL_ID,
      experimentArm: "A",
    });
    const b = resolveUserTailLengthOwnerSentence({
      modelId: GEMINI37_FLASH_NUMERIC_OWNER_MODEL_ID,
      experimentArm: "B",
    });
    assert.equal(a, VANILLA);
    assert.equal(b, VANILLA.replace("3,200", "4,000"));
    assertNumericOwnerOnlyDiff(a, b);
    assert.equal(formatUserTailLengthOwnerAimChars(4000), "4,000");
  });

  it("append keeps owner count 1 and placement last for both arms", () => {
    const user = "나는 렌이라고… 본 기억이 안 나는데… 나 알아?";
    const a = appendCompactTerminalLengthToUserTurn(user, 3200, {
      modelId: GEMINI37_FLASH_NUMERIC_OWNER_MODEL_ID,
      userTailLengthOwnerArm: "A",
    });
    const b = appendCompactTerminalLengthToUserTurn(user, 3200, {
      modelId: GEMINI37_FLASH_NUMERIC_OWNER_MODEL_ID,
      userTailLengthOwnerArm: "B",
    });
    const ownerA = resolveUserTailLengthOwnerSentence({
      modelId: GEMINI37_FLASH_NUMERIC_OWNER_MODEL_ID,
      experimentArm: "A",
    });
    const ownerB = resolveUserTailLengthOwnerSentence({
      modelId: GEMINI37_FLASH_NUMERIC_OWNER_MODEL_ID,
      experimentArm: "B",
    });
    assert.ok(a.startsWith(user));
    assert.ok(b.startsWith(user));
    assert.ok(a.trimEnd().endsWith(ownerA));
    assert.ok(b.trimEnd().endsWith(ownerB));
    assert.equal(countOccurrences(a, ownerA), 1);
    assert.equal(countOccurrences(b, ownerB), 1);
    assert.equal(countOccurrences(a, ownerB), 0);
    assert.equal(countOccurrences(b, ownerA), 0);
    assert.ok(a.indexOf("지문과") < a.indexOf(ownerA));
    assert.ok(b.indexOf("지문과") < b.indexOf(ownerB));
    assertNumericOwnerOnlyDiff(a, b);
  });

  it("assembled A/B diff is only the owner number", async () => {
    await withServerOnlyMock(async () => {
      const { buildContext } = await import("@/services/contextBuilder");
      const fixture = {
        charName: "조태형",
        contentKind: "character" as const,
        chunks: [
          {
            id: "c18-identity",
            characterId: "18",
            content: "너는 조태형이다. 에이지스 본부 S급 특수계 음압 센티넬.",
            category: "identity" as const,
            importance: "CRITICAL" as const,
            tokenCount: 40,
            keywords: ["조태형"],
          },
        ],
        userNickname: "렌",
        personaDisplayName: "렌",
        userPersona: "이름/호칭: 렌\n성별: 남성",
        userPersonaGender: "male" as const,
        shortTermHistory: [
          { role: "assistant" as const, content: "로비에서 태형이 손을 흔든다." },
        ],
        currentUserMessage: "나는 렌이라고… 본 기억이 안 나는데… 나 알아?",
        nsfw: false,
        gender: "male" as const,
        provider: "cheaperinference" as const,
        modelId: GEMINI37_FLASH_NUMERIC_OWNER_MODEL_ID,
        targetResponseChars: 3200,
        completedTurns: 0,
      };
      const builtA = buildContext({ ...fixture, userTailLengthOwnerArm: "A" });
      const builtB = buildContext({ ...fixture, userTailLengthOwnerArm: "B" });
      assert.equal(builtA.systemPrompt, builtB.systemPrompt);
      assert.doesNotMatch(builtA.systemPrompt ?? "", /3,200|4,000/);
      assert.equal(builtA.history.length, builtB.history.length);
      for (let i = 0; i < builtA.history.length - 1; i++) {
        assert.deepEqual(builtA.history[i], builtB.history[i]);
      }
      const lastA = builtA.history[builtA.history.length - 1];
      const lastB = builtB.history[builtB.history.length - 1];
      assert.equal(lastA?.role, "user");
      assert.equal(lastB?.role, "user");
      assert.match(lastA!.content, /나는 렌이라고/);
      assertNumericOwnerOnlyDiff(lastA!.content, lastB!.content);
      assert.equal(
        countOccurrences(lastA!.content, resolveUserTailLengthOwnerSentence({
          modelId: GEMINI37_FLASH_NUMERIC_OWNER_MODEL_ID,
          experimentArm: "A",
        })),
        1
      );
      assert.equal(
        countOccurrences(lastB!.content, resolveUserTailLengthOwnerSentence({
          modelId: GEMINI37_FLASH_NUMERIC_OWNER_MODEL_ID,
          experimentArm: "B",
        })),
        1
      );
    });
  });
});
