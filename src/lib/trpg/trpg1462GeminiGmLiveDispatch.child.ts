import {
  createTrpg1462MockOperatorApproval,
  dispatchTrpg1462LiveOneShot,
} from "./trpg1462GeminiGmLiveDispatch";
import { createTrpg1462MockFetch } from "./trpg1462GeminiGmOneShotMock";
import { TRPG_1462_MOCK_OPERATOR_EXECUTION_SHA, TRPG_1462_TEST_API_KEY } from "./trpg1462GeminiGmOneShot";

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
  const result = await dispatchTrpg1462LiveOneShot({
    mode: "mock-verify",
    requestId: process.env.TRPG_1462_ONESHOT_ID ?? "",
    root: process.env.TRPG_1462_ONESHOT_ROOT ?? "",
    fetchImpl,
    executionSha: TRPG_1462_MOCK_OPERATOR_EXECUTION_SHA,
    approval: createTrpg1462MockOperatorApproval(),
    apiKey: TRPG_1462_TEST_API_KEY,
  });
  process.stdout.write(`${JSON.stringify({ ...result, mockPosts: log.count })}\n`);
}

void main();
