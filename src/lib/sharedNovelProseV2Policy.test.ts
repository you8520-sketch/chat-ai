import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
  OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  OPENROUTER_GEMINI_36_FLASH_MODEL,
  OPENROUTER_MUSE_SPARK_11_MODEL,
  OPENAI_GPT_56_TERRA_MODEL,
} from "@/lib/chatModels";
import {
  isSharedNovelProseV2EnabledForUser,
  isSharedNovelProseV2Model,
  SHARED_NOVEL_PROSE_V2_ENV,
} from "@/lib/sharedNovelProseV2Policy";

const KEYS = [
  SHARED_NOVEL_PROSE_V2_ENV.ENABLED,
  SHARED_NOVEL_PROSE_V2_ENV.USER_IDS,
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

describe("sharedNovelProseV2Policy", () => {
  let snap: Record<string, string | undefined>;

  beforeEach(() => {
    snap = saveEnv();
    for (const k of KEYS) delete process.env[k];
  });

  afterEach(() => restoreEnv(snap));

  it("fail-closed when unset", () => {
    assert.equal(
      isSharedNovelProseV2EnabledForUser(1, CHEAPER_INFERENCE_GPT_56_LUNA_MODEL),
      false
    );
  });

  it("requires enabled + user allowlist + exact model", () => {
    process.env.SHARED_NOVEL_PROSE_V2_ENABLED = "1";
    process.env.SHARED_NOVEL_PROSE_V2_USER_IDS = "1";
    assert.equal(
      isSharedNovelProseV2EnabledForUser(1, CHEAPER_INFERENCE_GPT_56_LUNA_MODEL),
      true
    );
    assert.equal(
      isSharedNovelProseV2EnabledForUser(
        1,
        CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL
      ),
      true
    );
    assert.equal(
      isSharedNovelProseV2EnabledForUser(1, OPENROUTER_GEMINI_36_FLASH_MODEL),
      true
    );
    assert.equal(
      isSharedNovelProseV2EnabledForUser(2, CHEAPER_INFERENCE_GPT_56_LUNA_MODEL),
      false
    );
    assert.equal(
      isSharedNovelProseV2EnabledForUser(1, OPENAI_GPT_56_TERRA_MODEL),
      false
    );
  });

  it("exact model allowlist — Muse and OpenRouter DeepSeek slug excluded", () => {
    assert.equal(isSharedNovelProseV2Model(CHEAPER_INFERENCE_GPT_56_LUNA_MODEL), true);
    assert.equal(
      isSharedNovelProseV2Model(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL),
      true
    );
    assert.equal(isSharedNovelProseV2Model(OPENROUTER_GEMINI_36_FLASH_MODEL), true);
    assert.equal(isSharedNovelProseV2Model(OPENROUTER_MUSE_SPARK_11_MODEL), false);
    assert.equal(isSharedNovelProseV2Model(OPENROUTER_DEEPSEEK_V4_PRO_MODEL), false);
    assert.equal(isSharedNovelProseV2Model(OPENAI_GPT_56_TERRA_MODEL), false);
    assert.equal(isSharedNovelProseV2Model("deepseek/deepseek-chat-v3-0324"), false);
  });
});
