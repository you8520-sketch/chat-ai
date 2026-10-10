import { createTrpg1462MockFetch } from "./trpg1462GeminiGmOneShotMock";
import {
  createTrpg1462MockLiveApproval,
  createTrpg1462TestApproval,
  executeTrpg1462OneShot,
  TRPG_1462_TEST_API_KEY,
} from "./trpg1462GeminiGmOneShot";

function modeFromEnv(): "success" | "http" | "unknown" | "hang" {
  const raw = process.env.TRPG_1462_ONESHOT_FETCH ?? "success";
  switch (raw) {
    case "success":
    case "http":
    case "unknown":
    case "hang":
      return raw;
    default: {
      throw new Error(`unsupported mock mode ${raw}`);
    }
  }
}

async function main(): Promise<void> {
  const { fetchImpl, log } = createTrpg1462MockFetch({
    mode: modeFromEnv(),
    status: Number(process.env.TRPG_1462_ONESHOT_HTTP_STATUS ?? 500),
  });
  try {
    const result = await executeTrpg1462OneShot({
      requestId: process.env.TRPG_1462_ONESHOT_ID ?? "",
      root: process.env.TRPG_1462_ONESHOT_ROOT ?? "",
      fetchImpl,
      timeoutMs: Number(process.env.TRPG_1462_ONESHOT_TIMEOUT_MS ?? 180_000),
      crashAfterReserve: process.env.TRPG_1462_ONESHOT_CRASH_AFTER_RESERVE === "1",
      approval:
        process.env.TRPG_1462_ONESHOT_APPROVAL === "live"
          ? createTrpg1462MockLiveApproval()
          : createTrpg1462TestApproval(),
      apiKey: TRPG_1462_TEST_API_KEY,
    });
    process.stdout.write(`${JSON.stringify({ ...result, mockPosts: log.count })}\n`);
  } catch (error) {
    if (error instanceof Error && error.message === "CRASH_AFTER_RESERVE") {
      process.stdout.write(`${JSON.stringify({ crashed: true, posts: log.count })}\n`);
      process.exit(75);
    }
    throw error;
  }
}

void main();
