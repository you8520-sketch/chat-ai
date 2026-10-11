# DeepSeek Q1 quiet scene on current main — evidence (unscored, no code change)

Label: `CONTROLLED_FIXTURE_NOT_LIVE_PRODUCTION`

- main/production at call time: `32e2b83d7e68a0340b706b50211a4274562442a2` (includes #1558)
- Not the historical Q1 wire. Live public 라이크 (id 18) and admin persona 렌 are not reachable from this environment (no production DB access), so the card and persona are the public-safe fixture from #1550 (`docs/reviews/phase2-q5-micro-focus-after/fixture.json`: public card fields, 렌 = name/gender only, same two-message history). Only the current user message differs: `여기 앉아 있을게. 오늘은 조용해서 좋다.`
- Historical Q1: `docs/reviews/phase2-prose-quality-evidence.md` at `ac755c74b8ec7f9fb6b62e86d707763bc9d5f6f4` (DeepSeek `"네"`, 3 chars; unretained 722-char reproduction; Claude 4,010 chars). No byte-parity is claimed.
- Cursor does not score prose. GPT reviews the raw.

## BEFORE

DeepSeek Q1 once saved as the 3-character `"네"` (finish `stop`). Later same-scene calls returned 722 chars.

## ROOT CAUSE / findings (current main execution path)

1. SceneDirective / ScenePacing for Q1: `MICRO_MOTION`, identical `[SCENE PACING]` to Q5 on main (after #1558, no `허용된 변화`):
   ```
   [SCENE PACING]
   현재 상호작용 안에서 작은 관계·감각·환경 변화 하나를 조용히 이어간다. 새 인물·별도 사건은 만들지 않는다.
   전개 필요: MICRO
   기존 NPC 행동: 없음
   새 인물 도입: 없음
   ```
2. Final assembly (audited before the call, `audit.json`): roles `system,user,assistant,user`; `[COMMON PROSE]` x1, `[SCENE PACING]` x1, length sentence (`3,200자 이상`, soft target, no cap) x1 in the current-user tail, no creator note, `허용된 변화` 0, `전개 초점` 0, current user anchor x1.
3. DeepSeek adapter / options: `deepseek-v4.1-flash`, `stream:false`, temperature 0.92, `top_p` 0.92, `thinking` disabled, `reasoning_effort` none, no `max_tokens`. DeepSeek-only line `Qwen/DeepSeek 보강` x1 (Claude 0). Unchanged.
4. Short / early stop handling: `resolveGenerationFailureReason` returns `under_length` when visible chars are below `CATASTROPHIC_MIN_RESPONSE_CHARS` (80) or below 6% of the tier minimum; `isCatastrophicallyShortResponse("네")` is true. `finish_reason=stop` does not bypass it.
5. Save / refund / display: in `src/app/api/chat/route.ts` a `generationFailure` marks the assistant message failed (restoring alternates on regen), sends `error` with `generationFailureUserMessage("under_length")` ("저장하지 않았습니다. 포인트는 차감되지 않습니다.") and returns before the billing block. Existing tests pass: `responseLength.recovery`, `finishReasonErrorDelivery`, `reportRefundUnderLengthPolicy` (22/22).
6. Q1 Claude vs DeepSeek wire on main: same scene directive, same pacing, same length owner, same user tail. Differences are the model adapter (system tokens 5,857 Claude vs 5,989 DeepSeek, the 56-token DeepSeek line plus adapter text), temperature (0.82 vs 0.92) and `top_p`/`output_config`/`reasoning_effort`. No Q1-specific prompt branch exists.
7. Result of the one paid call below: the 3-character early stop did not reproduce on current main.

Conclusion: no deterministic code defect is confirmed. The only live defect candidate (a 3-char `stop`) is already rejected by the `under_length` gate (not saved, not charged). No prompt/code was changed; no speculative patch.

## Paid call (one POST, no retry)

- Request: `wire/deepseek-v4.1-flash.request.json`, compact JSON sha256 `fc237326fabcbb94a55eb6d8004dc5e3949dfa3f39db3df0c8554ee148d6b756`
- Route: Cheaper Inference benchmark key, `POST /v1/chat/completions` (non-stream); request id `1607e7f3-e057-440a-ae15-1a70240d989a`
- HTTP 200, finish reason `stop`, error none
- Tokens: 4,416 prompt (3,968 cached) / 1,892 completion; actual cost $0.000607
- Raw: 2,425 chars (1,782 visible), sha256 `4812561ae81c74732eb63dca349816217acf09353da7acf660f6dfad1df7e77c`
- Full verbatim output: `deepseek-v4.1-flash-Q1-main-32e2b83d.txt`; metadata `call.json`

## AFTER / REMOVED / PRESERVED / TOKEN DELTA

No change. Nothing added or removed. System 5,989 tokens and total input 7,153 tokens (DeepSeek), 5,857 / 7,016 (Claude), `estimateTokens`; net 0.

## REGRESSION RISKS

None from this PR (docs only). Single sample; one 2,425-char stop does not prove the 3-char event cannot recur on the provider side, but production would reject it.

## Not done

No further calls, no Claude call, no new runner or Journal in the repo, no DB writes.
