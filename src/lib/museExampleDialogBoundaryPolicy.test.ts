import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  isMuseExampleDialogBoundaryEnabledForUser,
  MUSE_EXAMPLE_DIALOG_BOUNDARY_ENV,
  MUSE_SPARK_MODEL_ID,
} from "@/lib/museExampleDialogBoundaryPolicy";

const MUSE = MUSE_SPARK_MODEL_ID;
const DEEPSEEK = "deepseek/deepseek-v4-pro";
const GEMINI = "google/gemini-2.5-pro";

const ENV_KEYS = [
  MUSE_EXAMPLE_DIALOG_BOUNDARY_ENV.ENABLED,
  MUSE_EXAMPLE_DIALOG_BOUNDARY_ENV.USER_IDS,
  MUSE_EXAMPLE_DIALOG_BOUNDARY_ENV.MODEL_IDS,
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

describe("isMuseExampleDialogBoundaryEnabledForUser — fail-closed admin gate", () => {
  let envSnapshot: Record<string, string | undefined>;

  beforeEach(() => {
    envSnapshot = saveEnv();
    for (const key of ENV_KEYS) delete process.env[key];
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
  });

  it("all unset → OFF", () => {
    assert.equal(isMuseExampleDialogBoundaryEnabledForUser(1, MUSE), false);
  });

  it("ENABLED=1 without USER_IDS → fail closed", () => {
    process.env.MUSE_EXAMPLE_DIALOG_BOUNDARY_ENABLED = "1";
    assert.equal(isMuseExampleDialogBoundaryEnabledForUser(1, MUSE), false);
  });

  it("explicit admin + Muse model + exact MODEL_IDS → ON", () => {
    process.env.MUSE_EXAMPLE_DIALOG_BOUNDARY_ENABLED = "1";
    process.env.MUSE_EXAMPLE_DIALOG_BOUNDARY_USER_IDS = "1";
    process.env.MUSE_EXAMPLE_DIALOG_BOUNDARY_MODEL_IDS = MUSE;
    assert.equal(isMuseExampleDialogBoundaryEnabledForUser(1, MUSE), true);
  });

  it("non-admin user → OFF", () => {
    process.env.MUSE_EXAMPLE_DIALOG_BOUNDARY_ENABLED = "1";
    process.env.MUSE_EXAMPLE_DIALOG_BOUNDARY_USER_IDS = "1";
    process.env.MUSE_EXAMPLE_DIALOG_BOUNDARY_MODEL_IDS = MUSE;
    assert.equal(isMuseExampleDialogBoundaryEnabledForUser(2, MUSE), false);
  });

  it("admin + non-Muse model → OFF", () => {
    process.env.MUSE_EXAMPLE_DIALOG_BOUNDARY_ENABLED = "1";
    process.env.MUSE_EXAMPLE_DIALOG_BOUNDARY_USER_IDS = "1";
    process.env.MUSE_EXAMPLE_DIALOG_BOUNDARY_MODEL_IDS = MUSE;
    assert.equal(isMuseExampleDialogBoundaryEnabledForUser(1, DEEPSEEK), false);
    assert.equal(isMuseExampleDialogBoundaryEnabledForUser(1, GEMINI), false);
  });

  it("partial model ID in allowlist must not match", () => {
    process.env.MUSE_EXAMPLE_DIALOG_BOUNDARY_ENABLED = "1";
    process.env.MUSE_EXAMPLE_DIALOG_BOUNDARY_USER_IDS = "1";
    process.env.MUSE_EXAMPLE_DIALOG_BOUNDARY_MODEL_IDS = MUSE;
    assert.equal(isMuseExampleDialogBoundaryEnabledForUser(1, `foo-${MUSE}-bar`), false);
  });

  it("MODEL_IDS mismatch even with Muse substring → OFF", () => {
    process.env.MUSE_EXAMPLE_DIALOG_BOUNDARY_ENABLED = "1";
    process.env.MUSE_EXAMPLE_DIALOG_BOUNDARY_USER_IDS = "1";
    process.env.MUSE_EXAMPLE_DIALOG_BOUNDARY_MODEL_IDS = "other/model";
    assert.equal(isMuseExampleDialogBoundaryEnabledForUser(1, MUSE), false);
  });

  it("empty MODEL_IDS after parse → fail closed", () => {
    process.env.MUSE_EXAMPLE_DIALOG_BOUNDARY_ENABLED = "1";
    process.env.MUSE_EXAMPLE_DIALOG_BOUNDARY_USER_IDS = "1";
    process.env.MUSE_EXAMPLE_DIALOG_BOUNDARY_MODEL_IDS = " , ";
    assert.equal(isMuseExampleDialogBoundaryEnabledForUser(1, MUSE), false);
  });
});
