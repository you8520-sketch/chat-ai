import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { IMMERSIVE_PROSE_BLOCK, PROSE_STYLE_SECTION } from "@/lib/advancedProseNsfwGuidelines";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
  OPENROUTER_GEMINI_36_FLASH_MODEL,
  OPENROUTER_MUSE_SPARK_11_MODEL,
} from "@/lib/chatModels";
import { MUSE_PROSE_M1_STYLE_SECTION } from "@/lib/proseMuseM1";
import { PROSE_MUSE_M1_ENV } from "@/lib/proseMuseM1Policy";
import { resolveProseStyleSection } from "@/lib/proseStyleResolver";
import { PROSE_VNEXT_STYLE_SECTION } from "@/lib/proseVNext";
import { PROSE_VNEXT_ENV } from "@/lib/proseVNextPolicy";
import {
  buildCompactTerminalLengthAbsoluteTail,
  buildLengthInstruction,
} from "@/lib/responseLength";
import { SHARED_NOVEL_PROSE_CORE } from "@/lib/sharedNovelProseCore";
import { SHARED_NOVEL_PROSE_V2_ENV } from "@/lib/sharedNovelProseV2Policy";
import {
  MUSE_PROSE_M1_STYLE_SECTION_V2,
  PROSE_STYLE_SECTION_V2,
  PROSE_VNEXT_STYLE_SECTION_V2,
} from "@/lib/sharedNovelProseV2Styles";
import { SCENE_CONTINUATION_PRIORITY_BLOCK } from "@/lib/turnHandoffAndPacing";

const KEYS = [
  SHARED_NOVEL_PROSE_V2_ENV.ENABLED,
  SHARED_NOVEL_PROSE_V2_ENV.USER_IDS,
  PROSE_MUSE_M1_ENV.ENABLED,
  PROSE_MUSE_M1_ENV.USER_IDS,
  PROSE_MUSE_M1_ENV.MODEL_IDS,
  PROSE_MUSE_M1_ENV.ROLLOUT_ENABLED,
  PROSE_MUSE_M1_ENV.ROLLOUT_MODEL_IDS,
  PROSE_VNEXT_ENV.ENABLED,
  PROSE_VNEXT_ENV.USER_IDS,
  PROSE_VNEXT_ENV.MODEL_IDS,
  PROSE_VNEXT_ENV.ROLLOUT_ENABLED,
  PROSE_VNEXT_ENV.ROLLOUT_MODEL_IDS,
] as const;

function saveEnv(): Record<string, string | undefined> {
  return Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
}

function restoreEnv(snapshot: Record<string, string | undefined>): void {
  for (const key of KEYS) {
    const value = snapshot[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe("sharedNovelProseV2 styles + resolver", () => {
  let snap: Record<string, string | undefined>;

  beforeEach(() => {
    snap = saveEnv();
    for (const k of KEYS) delete process.env[k];
  });

  afterEach(() => restoreEnv(snap));

  it("gate OFF → Legacy/VNext/M1 unchanged", () => {
    assert.equal(resolveProseStyleSection(1, CHEAPER_INFERENCE_GPT_56_LUNA_MODEL), undefined);
    assert.equal(
      resolveProseStyleSection(1, CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL),
      undefined
    );

    process.env.PROSE_MUSE_M1_ENABLED = "1";
    process.env.PROSE_MUSE_M1_USER_IDS = "1";
    assert.equal(
      resolveProseStyleSection(1, OPENROUTER_MUSE_SPARK_11_MODEL),
      MUSE_PROSE_M1_STYLE_SECTION
    );

    process.env.PROSE_VNEXT_ROLLOUT_ENABLED = "1";
    process.env.PROSE_VNEXT_ROLLOUT_MODEL_IDS =
      CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL;
    assert.equal(
      resolveProseStyleSection(1, CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL),
      PROSE_VNEXT_STYLE_SECTION
    );
  });

  it("gate ON → Legacy becomes PROSE_STYLE_SECTION_V2 for Luna/Gemini/DeepSeek CI", () => {
    process.env.SHARED_NOVEL_PROSE_V2_ENABLED = "1";
    process.env.SHARED_NOVEL_PROSE_V2_USER_IDS = "1";
    assert.equal(
      resolveProseStyleSection(1, CHEAPER_INFERENCE_GPT_56_LUNA_MODEL),
      PROSE_STYLE_SECTION_V2
    );
    assert.equal(
      resolveProseStyleSection(1, OPENROUTER_GEMINI_36_FLASH_MODEL),
      PROSE_STYLE_SECTION_V2
    );
    assert.equal(
      resolveProseStyleSection(1, CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL),
      PROSE_STYLE_SECTION_V2
    );
  });

  it("gate ON does not apply V2 to Muse (excluded from allowlist)", () => {
    process.env.SHARED_NOVEL_PROSE_V2_ENABLED = "1";
    process.env.SHARED_NOVEL_PROSE_V2_USER_IDS = "1";
    process.env.PROSE_MUSE_M1_ENABLED = "1";
    process.env.PROSE_MUSE_M1_USER_IDS = "1";
    assert.equal(
      resolveProseStyleSection(1, OPENROUTER_MUSE_SPARK_11_MODEL),
      MUSE_PROSE_M1_STYLE_SECTION
    );
    assert.notEqual(
      resolveProseStyleSection(1, OPENROUTER_MUSE_SPARK_11_MODEL),
      MUSE_PROSE_M1_STYLE_SECTION_V2
    );
  });

  it("gate ON + VNext DeepSeek CI → VNEXT_V2", () => {
    process.env.SHARED_NOVEL_PROSE_V2_ENABLED = "1";
    process.env.SHARED_NOVEL_PROSE_V2_USER_IDS = "1";
    process.env.PROSE_VNEXT_ROLLOUT_ENABLED = "1";
    process.env.PROSE_VNEXT_ROLLOUT_MODEL_IDS =
      CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL;
    assert.equal(
      resolveProseStyleSection(1, CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL),
      PROSE_VNEXT_STYLE_SECTION_V2
    );
  });

  it("Legacy V2 contains Shared Core and not removed immersive filler line", () => {
    assert.ok(PROSE_STYLE_SECTION_V2.includes(SHARED_NOVEL_PROSE_CORE));
    assert.ok(PROSE_STYLE_SECTION_V2.includes("[NOVEL PROSE CORE — SHARED]"));
    assert.ok(
      !PROSE_STYLE_SECTION_V2.includes(
        "내면만으로 분량을 채우지 말고 선택적 환경·다른 인물·업무·주변 활동·결과로 장면을 움직인다."
      )
    );
    assert.ok(IMMERSIVE_PROSE_BLOCK.includes("[IMMERSIVE LONGFORM PROSE]"));
    assert.ok(IMMERSIVE_PROSE_BLOCK.includes("충분히 펼쳐진 소설 장면"));
    assert.ok(PROSE_STYLE_SECTION.includes(IMMERSIVE_PROSE_BLOCK));
  });

  it("V2 length/terminal use floor 2500 and new continuation", () => {
    const length = buildLengthInstruction(3200, { sharedNovelProseV2: true });
    assert.match(length, /MINIMUM_FLOOR: 2,?500\+/);
    assert.match(length, /\[SCENE CONTINUATION PRIORITY\]/);
    assert.ok(length.includes("MINIMUM_FLOOR 전 조기 종료를 피한다"));
    assert.ok(!length.includes("Never stop at the first satisfying ending"));
    assert.ok(
      !length.includes("분위기·세계 움직임으로 이어가되"),
      "legacy continuation body must not appear in V2 length"
    );

    const terminal = buildCompactTerminalLengthAbsoluteTail(3200, {
      sharedNovelProseV2: true,
    });
    assert.match(terminal, /MINIMUM_FLOOR 2,?500\+/);
    assert.ok(terminal.includes("현재 장면 안에서 충분히 전개하고 미달 조기 종료를 피한다."));
    assert.ok(!terminal.includes("단일 응답 최대 전개"));

    const prodLength = buildLengthInstruction(3200);
    assert.match(prodLength, /MINIMUM_FLOOR: 2,?700\+/);
    assert.ok(prodLength.includes("Never stop at the first satisfying ending"));
    assert.ok(prodLength.includes(SCENE_CONTINUATION_PRIORITY_BLOCK));
  });

  it("no hardcoded character/persona names in V2 prose files", () => {
    const hay = [
      PROSE_STYLE_SECTION_V2,
      PROSE_VNEXT_STYLE_SECTION_V2,
      MUSE_PROSE_M1_STYLE_SECTION_V2,
      SHARED_NOVEL_PROSE_CORE,
    ].join("\n");
    for (const name of ["라이크", "렌", "서강우", "플러드"]) {
      assert.ok(!hay.includes(name), `unexpected name ${name}`);
    }
  });
});
