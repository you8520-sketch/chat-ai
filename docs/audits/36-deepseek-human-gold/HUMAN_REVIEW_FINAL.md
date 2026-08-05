# Human review final — DeepSeek dense-internal stack

## Verdict

```text
RAW_HUMAN_REVIEW_HARD_FAIL
AUTOMATED_EVALUATOR_FALSE_PASS_CONFIRMED
CURRENT_STACK_NOT_A_PRODUCTION_CANDIDATE
```

```text
common stack frozen: NO
DeepSeek adapter frozen: NO
cross-model ready: NO
production candidate: NO
```

## Scope

- Blind A–J full read
- Targeted: C243-01 (1610), C243-06 (1347 trunc), C243-08 (99 trunc)

## Hard failures

1. NPC_CLASSIFIER_FALSE_NEGATIVE_CONFIRMED
2. TEMPORAL_REWIND / PREVIOUS_TURN_REPLAY / USER_INPUT_REAUTHORING (C243-04)
3. UNSUPPORTED_USER_STATE_INVENTION
4. SEMANTIC_PSYCHOLOGY_REPETITION
5. CROSS_OUTPUT_SEMANTIC_TEMPLATE_ECHO
6. MULTIPLE_UNANSWERED_QUESTIONS / ASSISTANT_MONOLOGUE_DOMINANCE

## Work stop

No new prompt/style/length/resume canary, cross-model live call, confirmation, or rollout.

Transport track stays separate (`PROVIDER_TRANSPORT_FAILOVER_OR_PINNING_CANARY`) and must not own quality failures.

## Evaluator premises

See user brief §4 — NPC intrusion rules, temporal hard gates, unsupported user facts, proposition-level repetition, false reaction rules.

## Gold fixtures

`GOLD_FIXTURE_CASES.json` + `src/lib/rpHumanGoldFixtures.ts` / `.test.ts`

Required recall before evaluator reuse: 100% on hard-fail / rewind / takeover / unsupported user fact cases in this gold set.

## Baseline A/B

Offline packet: `data/human-review/36-baseline-vs-candidate/`  
If candidate is not clearly better than production baseline → `CURRENT_STRUCTURED_STACK_REJECTED`.

## Safety

```text
production DB apply: NO
general rollout: NO
auto merge: NO
auto deploy: NO
new model calls: NO
prompt changes: NO
```
