import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  isMuseCompactSceneStateEnabledForUser,
  isMuseStructuralLengthAnchorEnabledForUser,
  MUSE_SCENE_BOOTSTRAP_ENV,
  MUSE_SPARK_MODEL_ID,
} from "@/lib/museSceneBootstrapPolicy";

const MUSE = MUSE_SPARK_MODEL_ID;
const DEEPSEEK = "deepseek/deepseek-v4-pro";
const GEMINI = "google/gemini-2.5-pro";

const ENV_KEYS = [
  MUSE_SCENE_BOOTSTRAP_ENV.SEMANTIC_ENABLED,
  MUSE_SCENE_BOOTSTRAP_ENV.ANCHOR_ENABLED,
  MUSE_SCENE_BOOTSTRAP_ENV.USER_IDS,
  MUSE_SCENE_BOOTSTRAP_ENV.MODEL_IDS,
] as const;

function saveEnv(): Record<string, string | undefined> {
  return Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
}

function restoreEnv(snapshot: Record<string, string | undefined>): void {
  for (const key of ENV_KEYS) {
    const value = snapshot[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function clearEnv(): void {
  for (const key of ENV_KEYS) delete process.env[key];
}

describe("museSceneBootstrapPolicy — fail-closed independent 2×2 gates", () => {
  let envSnapshot: Record<string, string | undefined>;

  beforeEach(() => {
    envSnapshot = saveEnv();
    clearEnv();
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
  });

  it("all env unset → both OFF", () => {
    assert.equal(isMuseCompactSceneStateEnabledForUser(1, MUSE), false);
    assert.equal(isMuseStructuralLengthAnchorEnabledForUser(1, MUSE), false);
  });

  it("semantic only → semantic ON, anchor OFF", () => {
    process.env.MUSE_COMPACT_SCENE_STATE_ENABLED = "1";
    process.env.MUSE_SCENE_BOOTSTRAP_USER_IDS = "1";
    assert.equal(isMuseCompactSceneStateEnabledForUser(1, MUSE), true);
    assert.equal(isMuseStructuralLengthAnchorEnabledForUser(1, MUSE), false);
  });

  it("anchor only → semantic OFF, anchor ON", () => {
    process.env.MUSE_STRUCTURAL_LENGTH_ANCHOR_ENABLED = "1";
    process.env.MUSE_SCENE_BOOTSTRAP_USER_IDS = "1";
    assert.equal(isMuseCompactSceneStateEnabledForUser(1, MUSE), false);
    assert.equal(isMuseStructuralLengthAnchorEnabledForUser(1, MUSE), true);
  });

  it("both ON → both true", () => {
    process.env.MUSE_COMPACT_SCENE_STATE_ENABLED = "1";
    process.env.MUSE_STRUCTURAL_LENGTH_ANCHOR_ENABLED = "1";
    process.env.MUSE_SCENE_BOOTSTRAP_USER_IDS = "1";
    assert.equal(isMuseCompactSceneStateEnabledForUser(1, MUSE), true);
    assert.equal(isMuseStructuralLengthAnchorEnabledForUser(1, MUSE), true);
  });

  it("wrong user → both OFF even when ENABLED", () => {
    process.env.MUSE_COMPACT_SCENE_STATE_ENABLED = "1";
    process.env.MUSE_STRUCTURAL_LENGTH_ANCHOR_ENABLED = "1";
    process.env.MUSE_SCENE_BOOTSTRAP_USER_IDS = "1";
    assert.equal(isMuseCompactSceneStateEnabledForUser(2, MUSE), false);
    assert.equal(isMuseStructuralLengthAnchorEnabledForUser(2, MUSE), false);
  });

  it("non-Muse → both OFF", () => {
    process.env.MUSE_COMPACT_SCENE_STATE_ENABLED = "1";
    process.env.MUSE_STRUCTURAL_LENGTH_ANCHOR_ENABLED = "1";
    process.env.MUSE_SCENE_BOOTSTRAP_USER_IDS = "1";
    assert.equal(isMuseCompactSceneStateEnabledForUser(1, DEEPSEEK), false);
    assert.equal(isMuseStructuralLengthAnchorEnabledForUser(1, GEMINI), false);
  });

  it("malformed allowlist → both OFF", () => {
    process.env.MUSE_COMPACT_SCENE_STATE_ENABLED = "1";
    process.env.MUSE_STRUCTURAL_LENGTH_ANCHOR_ENABLED = "1";
    process.env.MUSE_SCENE_BOOTSTRAP_USER_IDS = "0,-1,1.5,abc,";
    assert.equal(isMuseCompactSceneStateEnabledForUser(1, MUSE), false);
    assert.equal(isMuseStructuralLengthAnchorEnabledForUser(1, MUSE), false);
  });

  it("empty model list → both OFF", () => {
    process.env.MUSE_COMPACT_SCENE_STATE_ENABLED = "1";
    process.env.MUSE_STRUCTURAL_LENGTH_ANCHOR_ENABLED = "1";
    process.env.MUSE_SCENE_BOOTSTRAP_USER_IDS = "1";
    process.env.MUSE_SCENE_BOOTSTRAP_MODEL_IDS = " , ";
    assert.equal(isMuseCompactSceneStateEnabledForUser(1, MUSE), false);
    assert.equal(isMuseStructuralLengthAnchorEnabledForUser(1, MUSE), false);
  });

  it("exact canonical model only", () => {
    process.env.MUSE_COMPACT_SCENE_STATE_ENABLED = "1";
    process.env.MUSE_STRUCTURAL_LENGTH_ANCHOR_ENABLED = "1";
    process.env.MUSE_SCENE_BOOTSTRAP_USER_IDS = "1";
    process.env.MUSE_SCENE_BOOTSTRAP_MODEL_IDS = MUSE;
    assert.equal(isMuseCompactSceneStateEnabledForUser(1, MUSE), true);
    assert.equal(isMuseStructuralLengthAnchorEnabledForUser(1, MUSE), true);
    assert.equal(
      isMuseCompactSceneStateEnabledForUser(1, `foo-${MUSE}-bar`),
      false
    );
    assert.equal(
      isMuseStructuralLengthAnchorEnabledForUser(1, "muse-spark-1.1"),
      false
    );
  });

  it("MODEL_IDS unset + exact Muse → ON when ENABLED", () => {
    process.env.MUSE_COMPACT_SCENE_STATE_ENABLED = "true";
    process.env.MUSE_SCENE_BOOTSTRAP_USER_IDS = "1";
    assert.equal(isMuseCompactSceneStateEnabledForUser(1, MUSE), true);
  });

  it("USER_IDS missing → OFF even when ENABLED", () => {
    process.env.MUSE_COMPACT_SCENE_STATE_ENABLED = "1";
    process.env.MUSE_STRUCTURAL_LENGTH_ANCHOR_ENABLED = "1";
    assert.equal(isMuseCompactSceneStateEnabledForUser(1, MUSE), false);
    assert.equal(isMuseStructuralLengthAnchorEnabledForUser(1, MUSE), false);
  });
});
