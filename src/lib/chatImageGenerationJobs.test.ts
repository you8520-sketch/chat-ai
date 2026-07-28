import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import {
  CHAT_IMAGE_JOB_STALE_MS,
  ensureChatImageGenerationJobSchema,
  finishChatImageGenerationJob,
  findLatestChatImageGenerationJob,
  hasRunningChatImageGenerationJob,
  startChatImageGenerationJob,
} from "@/lib/chatImageGenerationJobs";
import { getDb } from "@/lib/db";

/** Test-only user id range so rows never collide with dev data. */
const USER_ID_BASE = 990_100_000;
let nextUserId = USER_ID_BASE;
const uniqueUserId = () => ++nextUserId;

const scope = (userId: number) => ({
  userId,
  chatId: 41,
  characterId: 7,
  personaId: 3,
});

describe("chat image generation jobs", () => {
  before(() => {
    ensureChatImageGenerationJobSchema(getDb());
  });

  after(() => {
    getDb()
      .prepare(`DELETE FROM chat_image_generation_jobs WHERE user_id > ?`)
      .run(USER_ID_BASE);
  });

  it("exposes a running job so a refreshed panel can restore 생성중", () => {
    const userId = uniqueUserId();
    const jobId = startChatImageGenerationJob({
      ...scope(userId),
      templateId: "couple_stamp",
      mode: "couple_stamp",
    });
    assert.ok(jobId);

    assert.equal(hasRunningChatImageGenerationJob(userId), true);
    const active = findLatestChatImageGenerationJob({
      userId,
      characterId: 7,
      chatId: 41,
    });
    assert.equal(active?.id, jobId);
    assert.equal(active?.status, "running");
    assert.equal(active?.mode, "couple_stamp");
    assert.equal(active?.resultUrl, null);
  });

  it("hands the result to a client that was away when the job finished", () => {
    const userId = uniqueUserId();
    const jobId = startChatImageGenerationJob({
      ...scope(userId),
      templateId: "sd",
      mode: "sd",
    });
    finishChatImageGenerationJob({
      jobId,
      status: "completed",
      resultUrl: "/uploads/ai-sd-done.webp",
    });

    assert.equal(hasRunningChatImageGenerationJob(userId), false);
    const active = findLatestChatImageGenerationJob({
      userId,
      characterId: 7,
      chatId: 41,
    });
    assert.equal(active?.id, jobId);
    assert.equal(active?.status, "completed");
    assert.equal(active?.resultUrl, "/uploads/ai-sd-done.webp");
  });

  it("reports a failure reason instead of leaving the panel spinning", () => {
    const userId = uniqueUserId();
    const jobId = startChatImageGenerationJob({
      ...scope(userId),
      templateId: "comic",
      mode: "comic",
    });
    finishChatImageGenerationJob({
      jobId,
      status: "failed",
      errorMessage: "포인트가 부족합니다.",
    });

    const active = findLatestChatImageGenerationJob({
      userId,
      characterId: 7,
      chatId: 41,
    });
    assert.equal(active?.status, "failed");
    assert.equal(active?.errorMessage, "포인트가 부족합니다.");
    assert.equal(hasRunningChatImageGenerationJob(userId), false);
  });

  it("never terminalizes a job twice", () => {
    const userId = uniqueUserId();
    const jobId = startChatImageGenerationJob({
      ...scope(userId),
      templateId: "sd",
      mode: "sd",
    });
    finishChatImageGenerationJob({ jobId, status: "completed", resultUrl: "/uploads/a.webp" });
    finishChatImageGenerationJob({ jobId, status: "failed", errorMessage: "무시되어야 함" });

    const active = findLatestChatImageGenerationJob({
      userId,
      characterId: 7,
      chatId: 41,
    });
    assert.equal(active?.status, "completed");
    assert.equal(active?.resultUrl, "/uploads/a.webp");
  });

  it("recovers a job whose process died mid-generation", () => {
    const userId = uniqueUserId();
    const jobId = startChatImageGenerationJob({
      ...scope(userId),
      templateId: "sd",
      mode: "sd",
    });
    const staleSeconds = Math.round(CHAT_IMAGE_JOB_STALE_MS / 1000) + 60;
    getDb()
      .prepare(
        `UPDATE chat_image_generation_jobs
            SET created_at=datetime('now', ?), updated_at=datetime('now', ?)
          WHERE id=?`
      )
      .run(`-${staleSeconds} seconds`, `-${staleSeconds} seconds`, jobId);

    assert.equal(hasRunningChatImageGenerationJob(userId), false);
    const row = getDb()
      .prepare(`SELECT status, error_message FROM chat_image_generation_jobs WHERE id=?`)
      .get(jobId) as { status: string; error_message: string | null };
    assert.equal(row.status, "failed");
    assert.match(row.error_message ?? "", /중단/);
  });

  it("keeps a stale finished job out of the panel's pickup window", () => {
    const userId = uniqueUserId();
    const jobId = startChatImageGenerationJob({
      ...scope(userId),
      templateId: "sd",
      mode: "sd",
    });
    finishChatImageGenerationJob({ jobId, status: "completed", resultUrl: "/uploads/old.webp" });
    getDb()
      .prepare(`UPDATE chat_image_generation_jobs SET updated_at=datetime('now', '-2 hours') WHERE id=?`)
      .run(jobId);

    assert.equal(
      findLatestChatImageGenerationJob({ userId, characterId: 7, chatId: 41 }),
      null
    );
  });

  it("scopes lookups to the requesting user and character", () => {
    const userId = uniqueUserId();
    const otherUserId = uniqueUserId();
    startChatImageGenerationJob({
      ...scope(otherUserId),
      templateId: "sd",
      mode: "sd",
    });

    assert.equal(hasRunningChatImageGenerationJob(userId), false);
    assert.equal(
      findLatestChatImageGenerationJob({ userId, characterId: 7, chatId: 41 }),
      null
    );
    assert.equal(
      findLatestChatImageGenerationJob({ userId: otherUserId, characterId: 8, chatId: 41 }),
      null
    );
  });
});
