from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    text = file_path.read_text(encoding="utf-8")
    if new in text:
        return
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected exactly one source block, found {count}")
    file_path.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    "src/lib/points.ts",
    '''/** Muse — 과금 면제 턴 최소 차감 */
export const MUSE_WAIVER_SUCCESS_MIN_COST = 50;

/** Gemini 3.6 Flash — 목표 매출총이익률 (45%) */''',
    '''/** Muse — 과금 면제 턴 최소 차감 */
export const MUSE_WAIVER_SUCCESS_MIN_COST = 50;

/**
 * Muse Spark 1.1 — OpenRouter list $1.25/M input, $4.25/M output.
 * ₩1,530/USD 기준 60% 매출총이익률을 보수적으로 올림한 고정 포인트 단가.
 *
 * input:  1.25 × 1,530 / 1,000,000 / (1 - 0.60) = 0.00478125 → 0.0048P/tok
 * output: 4.25 × 1,530 / 1,000,000 / (1 - 0.60) = 0.01625625 → 0.0163P/tok
 */
export const OPENROUTER_MUSE_INPUT_POINTS_PER_TOKEN = 0.0048;
export const OPENROUTER_MUSE_OUTPUT_POINTS_PER_TOKEN = 0.0163;

/** Gemini 3.6 Flash — 목표 매출총이익률 (45%) */''',
)
replace_once(
    "src/lib/points.ts",
    "  [OPENROUTER_MUSE_SPARK_11_MODEL]: 0.0042,",
    "  [OPENROUTER_MUSE_SPARK_11_MODEL]: OPENROUTER_MUSE_INPUT_POINTS_PER_TOKEN,",
)
replace_once(
    "src/lib/points.ts",
    "  [OPENROUTER_MUSE_SPARK_11_MODEL]: 0.0062,",
    "  [OPENROUTER_MUSE_SPARK_11_MODEL]: OPENROUTER_MUSE_OUTPUT_POINTS_PER_TOKEN,",
)

replace_once(
    "src/lib/openRouterUsage.ts",
    '''export type OpenRouterUsageBreakdown = {
  promptTokens: number;
  completionTokens: number;''',
    '''export type OpenRouterUsageBreakdown = {
  promptTokens: number;
  /** Provider가 보고한 전체 과금 completion 토큰. visible content/reasoning 부분합보다 우선한다. */
  completionTokens: number;''',
)
replace_once(
    "src/lib/openRouterUsage.ts",
    '''function readSignedUsd(v: unknown): number | undefined {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return undefined;
  return n;
}

/** Extract numeric fields from prompt_tokens_details for diagnostics */''',
    '''function readSignedUsd(v: unknown): number | undefined {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return undefined;
  return n;
}

function readPositiveUsd(v: unknown): number | undefined {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

/** Extract numeric fields from prompt_tokens_details for diagnostics */''',
)
replace_once(
    "src/lib/openRouterUsage.ts",
    '''export function parseReasoningTokens(usage: unknown): number {
  if (!usage || typeof usage !== "object") return 0;
  const u = usage as Record<string, unknown>;
  const details =
    u.completion_tokens_details && typeof u.completion_tokens_details === "object"
      ? (u.completion_tokens_details as Record<string, unknown>)
      : null;
  if (details) {
    return pickUsageField(details, ["reasoning_tokens", "reasoning"]);
  }
  return pickUsageField(u, ["reasoning_tokens"]);
}

/** usage 객체·응답 헤더에서 cache read / creation 토큰 분리 파싱 */''',
    '''export function parseReasoningTokens(usage: unknown): number {
  if (!usage || typeof usage !== "object") return 0;
  const u = usage as Record<string, unknown>;
  const details =
    u.completion_tokens_details && typeof u.completion_tokens_details === "object"
      ? (u.completion_tokens_details as Record<string, unknown>)
      : null;
  if (details) {
    return pickUsageField(details, ["reasoning_tokens", "reasoning"]);
  }
  return pickUsageField(u, ["reasoning_tokens"]);
}

/**
 * OpenRouter가 실제 과금에 사용한 전체 completion 토큰을 고른다.
 * content + thinking 부분합보다 native/total completion 값을 우선한다.
 */
export function parseBillableCompletionTokens(usage: unknown, promptTokens = 0): number {
  if (!usage || typeof usage !== "object") return 0;
  const u = usage as Record<string, unknown>;
  const totalTokens = Math.max(readNum(u.total_tokens), readNum(u.totalTokens));
  const derivedFromTotal = totalTokens > promptTokens ? totalTokens - promptTokens : 0;
  return Math.max(
    readNum(u.completion_tokens),
    readNum(u.output_tokens),
    readNum(u.native_tokens_completion),
    readNum(u.tokens_completion),
    derivedFromTotal
  );
}

/** usage 객체·응답 헤더에서 cache read / creation 토큰 분리 파싱 */''',
)
replace_once(
    "src/lib/openRouterUsage.ts",
    "  const completionTokens = readNum(u.completion_tokens ?? u.output_tokens);",
    "  const completionTokens = parseBillableCompletionTokens(u, promptTokens);",
)
replace_once(
    "src/lib/openRouterUsage.ts",
    '''  let upstreamCostUsd = 0;
  let upstreamPromptCostUsd: number | undefined;
  let upstreamCompletionCostUsd: number | undefined;
  const costDetails =
    u.cost_details && typeof u.cost_details === "object"
      ? (u.cost_details as Record<string, unknown>)
      : null;
  if (costDetails) {
    upstreamCostUsd = readNum(costDetails.upstream_inference_cost);
    upstreamPromptCostUsd = readSignedUsd(costDetails.upstream_inference_prompt_cost);
    upstreamCompletionCostUsd = readSignedUsd(costDetails.upstream_inference_completions_cost);
  }
  if (!upstreamCostUsd) {
    upstreamCostUsd = readNum(u.cost);
  }''',
    '''  let upstreamCostUsd: number | undefined;
  let upstreamPromptCostUsd: number | undefined;
  let upstreamCompletionCostUsd: number | undefined;
  const costDetails =
    u.cost_details && typeof u.cost_details === "object"
      ? (u.cost_details as Record<string, unknown>)
      : null;
  if (costDetails) {
    upstreamCostUsd = readPositiveUsd(costDetails.upstream_inference_cost);
    upstreamPromptCostUsd = readSignedUsd(costDetails.upstream_inference_prompt_cost);
    upstreamCompletionCostUsd = readSignedUsd(costDetails.upstream_inference_completions_cost);
  }
  if (upstreamCostUsd == null) {
    upstreamCostUsd = readPositiveUsd(u.cost);
  }''',
)
replace_once(
    "src/lib/openRouterUsage.ts",
    "    ...(upstreamCostUsd > 0 ? { upstreamCostUsd } : {}),",
    "    ...(upstreamCostUsd != null ? { upstreamCostUsd } : {}),",
)

replace_once(
    "src/lib/openRouterUsage.test.ts",
    '''import {
  parseOpenRouterUsage,''',
    '''import {
  parseBillableCompletionTokens,
  parseOpenRouterUsage,''',
)
replace_once(
    "src/lib/openRouterUsage.test.ts",
    '''  it("reads Gemini implicit cache from prompt_tokens_details.cached_tokens", () => {''',
    '''  it("prefers the provider's full native billable completion total", () => {
    const rawUsage = {
      prompt_tokens: 10_000,
      completion_tokens: 1_366,
      native_tokens_completion: 2_070,
      total_tokens: 12_070,
      completion_tokens_details: {
        content_tokens: 1_159,
        reasoning_tokens: 207,
      },
    };
    assert.equal(parseBillableCompletionTokens(rawUsage, 10_000), 2_070);
    const b = parseOpenRouterUsage(rawUsage);
    assert.equal(b.completionTokens, 2_070);
    assert.equal(b.reasoningTokens, 207);
    const mapped = tokenUsageFromOpenRouterBreakdown(b);
    assert.equal(mapped.outputTokens, 2_070);
  });

  it("reads Gemini implicit cache from prompt_tokens_details.cached_tokens", () => {''',
)
replace_once(
    "src/lib/openRouterUsage.test.ts",
    '''    assert.equal(b.standardInputTokens, 251);
    assert.equal(b.upstreamPromptCostUsd, 0.00245875);''',
    '''    assert.equal(b.standardInputTokens, 251);
    assert.equal(b.upstreamCostUsd, 0.01324875);
    assert.equal(b.upstreamPromptCostUsd, 0.00245875);''',
)

replace_once(
    "src/lib/points.muse.test.ts",
    '''  MUSE_WAIVER_SUCCESS_MIN_COST,
  OPENROUTER_SIMPLE_POINT_INPUT_PRICES,''',
    '''  MUSE_WAIVER_SUCCESS_MIN_COST,
  OPENROUTER_MUSE_INPUT_POINTS_PER_TOKEN,
  OPENROUTER_MUSE_OUTPUT_POINTS_PER_TOKEN,
  OPENROUTER_SIMPLE_POINT_INPUT_PRICES,''',
)
replace_once(
    "src/lib/points.muse.test.ts",
    '''  OPENROUTER_SIMPLE_POINT_OUTPUT_PRICES,
  computeOpenRouterTurnCost,''',
    '''  OPENROUTER_SIMPLE_POINT_OUTPUT_PRICES,
  billableOpenRouterOutputTokens,
  computeOpenRouterTurnCost,''',
)
replace_once(
    "src/lib/points.muse.test.ts",
    '''    assert.equal(inputPrice, 0.0042);
    assert.equal(outputPrice, 0.0062);''',
    '''    assert.equal(OPENROUTER_MUSE_INPUT_POINTS_PER_TOKEN, 0.0048);
    assert.equal(OPENROUTER_MUSE_OUTPUT_POINTS_PER_TOKEN, 0.0163);
    assert.equal(inputPrice, OPENROUTER_MUSE_INPUT_POINTS_PER_TOKEN);
    assert.equal(outputPrice, OPENROUTER_MUSE_OUTPUT_POINTS_PER_TOKEN);''',
)
replace_once(
    "src/lib/points.muse.test.ts",
    '''  it("lands near 65P on the recommended Muse receipt shape", () => {''',
    '''  it("lands near 90P on the recommended Muse receipt shape", () => {''',
)
replace_once(
    "src/lib/points.muse.test.ts",
    '''    assert.ok(total >= 64 && total <= 67, `expected ~65P, got ${total}`);''',
    '''    assert.ok(total >= 89 && total <= 91, `expected ~90P, got ${total}`);''',
)
replace_once(
    "src/lib/points.muse.test.ts",
    '''  it("waiver with meaningful text charges minimum 50P", () => {''',
    '''  it("charges the full 2,070 provider output tokens, not content + thinking only", () => {
    const inputTokens = 10_000;
    const providerBillableOutputTokens = 2_070;
    const visibleContentTokens = 1_159;
    const reasoningTokens = 207;
    assert.ok(providerBillableOutputTokens > visibleContentTokens + reasoningTokens);

    const formulaOutputTokens = billableOpenRouterOutputTokens(
      modelId,
      providerBillableOutputTokens,
      reasoningTokens
    );
    assert.equal(formulaOutputTokens + reasoningTokens, providerBillableOutputTokens);

    const charged = computeOpenRouterTurnCost(inputTokens, formulaOutputTokens, modelId, undefined, {
      reasoningTokens,
    });
    const fullProviderTotal = computeOpenRouterTurnCost(
      inputTokens,
      providerBillableOutputTokens,
      modelId
    );
    assert.equal(charged, fullProviderTotal);
  });

  it("waiver with meaningful text charges minimum 50P", () => {''',
)

print("Muse billing source replacements applied successfully")
