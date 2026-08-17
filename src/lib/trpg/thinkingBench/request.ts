import { TRPG_GM_MAX_TOKENS, TRPG_GM_MODEL } from "../types";
import type { ThinkingBenchArm, ThinkingMode } from "./types";

export const TRPG_TRUE_OFF_THINKING = { type: "disabled" } as const;
export const TRPG_TRUE_OFF_REASONING_EFFORT = "none" as const;

export const THINKING_BENCH_COMPLEX_CASE_IDS = [
  "case2_authored_opening",
  "case5_two_bots",
  "case6_complex_scenario",
] as const;

export const THINKING_BENCH_TIMEOUT_MS = 180_000;
export const THINKING_BENCH_TEMPERATURE = 0.7;

/** Isolated bench body. Does not call adaptTrpgGmChatBody (production GM stays ON). */
export function buildThinkingBenchChatBody(opts: {
  system: string;
  user: string;
  arm: ThinkingBenchArm;
  stream: boolean;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: TRPG_GM_MODEL,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    stream: opts.stream,
    temperature: THINKING_BENCH_TEMPERATURE,
    max_tokens: TRPG_GM_MAX_TOKENS,
  };
  if (opts.stream) {
    body.stream_options = { include_usage: true };
  }
  switch (opts.arm) {
    case "on":
      body.thinking = { type: "enabled" };
      return body;
    case "true_off":
      body.thinking = { ...TRPG_TRUE_OFF_THINKING };
      body.reasoning_effort = TRPG_TRUE_OFF_REASONING_EFFORT;
      return body;
    case "misconfigured_disabled":
      body.thinking = { type: "disabled" };
      return body;
    default: {
      const _never: never = opts.arm;
      throw new Error(`unhandled thinking bench arm: ${String(_never)}`);
    }
  }
}

export function thinkingModeForArm(arm: ThinkingBenchArm): ThinkingMode {
  switch (arm) {
    case "on":
      return "enabled";
    case "true_off":
    case "misconfigured_disabled":
      return "disabled";
    default: {
      const _never: never = arm;
      throw new Error(`unhandled thinking bench arm: ${String(_never)}`);
    }
  }
}
