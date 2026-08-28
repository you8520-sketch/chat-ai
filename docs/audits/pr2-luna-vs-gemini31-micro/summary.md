# Luna vs Gemini 3.1 Flash-Lite Micro-Bench Summary

- harness_head: 9aeb795b8dad43d11d484d48249930adf088688b
- fixture_count: 5
- planned_provider_requests: 10
- actual_provider_requests: 10
- luna_model: gpt-5.6-luna
- gemini_model: gemini-3.1-flash-lite

## Reliability
- luna_success_count: 5/5
- luna_failure_count: 0
- gemini_success_count: 5/5
- gemini_failure_count: 0

## Latency (ms, n=5 per model — descriptive only)
- luna_latency_min_ms: 8395
- luna_latency_median_ms: 10725
- luna_latency_mean_ms: 12492
- luna_latency_max_ms: 17066
- gemini_latency_min_ms: 6606
- gemini_latency_median_ms: 13169
- gemini_latency_mean_ms: 14336.6
- gemini_latency_max_ms: 20497

## Tokens
- luna_total_input_tokens: 2968
- luna_total_output_tokens: 1085
- luna_total_reasoning_tokens: 0
- luna_provider_reported_cost_usd: n/a
- gemini_total_input_tokens: 2879
- gemini_total_output_tokens: 1069
- gemini_total_reasoning_tokens: 0
- gemini_provider_reported_cost_usd: 0.00232325

## Objective failures (by model)
- luna_segment_failures: 0
- gemini_segment_failures: 0
- luna_placeholder_failures: 0
- gemini_placeholder_failures: 0
- luna_exact_token_failures: 2
- gemini_exact_token_failures: 1