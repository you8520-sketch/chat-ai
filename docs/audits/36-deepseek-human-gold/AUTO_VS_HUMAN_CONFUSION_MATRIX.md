# Auto vs human confusion matrix

## Final

```text
RAW_HUMAN_REVIEW_HARD_FAIL
AUTOMATED_EVALUATOR_FALSE_PASS_CONFIRMED
NPC_CLASSIFIER_FALSE_NEGATIVE_CONFIRMED
CURRENT_STACK_NOT_A_PRODUCTION_CANDIDATE
```

Human raw review overrules automated pass labels from PR #242 / #243.

## Withdrawn automated claims

- `DEEPSEEK_FUNCTIONAL_STACK_SCREEN_PASS`
- NPC suppression confirmed
- prose quality near pass
- reaction quality confirmed

## NPC / external speaker (confirmation valid n=6)

| signal | automated (PR#243) | human gold |
|--|--|--|
| EXTERNAL_SUBPLOT / intrusive | 0/6 | **2/6** (INTRUSIVE or TAKEOVER) |
| ADMINISTRATIVE_SUBPLOT | 0 | **2/6** (+ trunc C243-06) |
| INCIDENTAL_EXTERNAL_VOICE | 3 | used as dump bucket for intrusive cases → false negative |

### False-negative examples

| id | blind | automated | human |
|--|--|--|--|
| C243-02 | A | not intrusive | INTRUSIVE + TAKEOVER + ADMIN |
| C243-01 | G | premature only | TAKEOVER + PREMATURE_CLOSURE |
| C243-06 | — | runtime excluded | named NPC admin subplot |

## Temporal / agency

| signal | automated | human |
|--|--|--|
| TEMPORAL_REWIND | not gated | C243-04 HARD |
| USER_INPUT_REAUTHORING | not gated | C243-04, S242-06 |
| USER_STATE_INVENTION | not gated | **5/6** confirm valid |

## Reaction

| signal | automated | human |
|--|--|--|
| reaction | 5/6 | many FALSE_REACTION_POINT |
| premature_closure | 1/6 | C243-01 confirmed; others miscounted as OK reaction |

Human false-reaction-or-closure among confirm valid: **5/6**

## Redesign implication

Block-count NPC heuristics and terminal-question ⇒ reaction PASS are invalid.
Gold fixture recall must be 100% before any live prompt comparison.
