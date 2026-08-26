# Background model A/B bench report

Generated: 2026-08-26T13:45:28.842Z

| Model | Calls | Success | Empty/Timeout | Summary pass | HTML pass | Status pass | P50 ms | P95 ms | Reasoning tokens |
|-------|------:|--------:|--------------:|-------------:|----------:|------------:|-------:|-------:|-----------------:|
| deepseek-v4-flash-0731 | 14 | 57% | 6 | 1/5 | 0/5 | 2/4 | 120000 | 156658 | 1774 |
| gpt-5.6-luna | 14 | 100% | 0 | 5/5 | 5/5 | 4/4 | 3984 | 12453 | 0 |

## Recommendation

- **Reliability winner:** luna
- **Quality winner:** luna
- **Speed winner:** luna
- **Recommended background PRIMARY (bench only, not applied):** gpt-5.6-luna

### Rationale (5 lines max)

1. Luna completed 14/14 calls with zero empty/timeout; DeepSeek hit the 120s production deadline on 6/14 calls (mostly rolling summary + HTML).
2. Luna passed 5/5 summary quality (production `validateSummaryNarrative` + grounding) vs DeepSeek 1/5 (four summary timeouts, one partial success).
3. Luna passed 5/5 HTML/OOC structured outputs; DeepSeek HTML calls timed out under the same production HTML deadline owner.
4. Luna passed 4/4 status-widget combined extracts vs DeepSeek 2/4 (JSON/field completeness under dual POV scenarios).
5. Outbound body flags verified: `DEEPSEEK_THINKING_OFF=true`, `LUNA_REASONING_NONE=true`; Luna P50 3984ms vs DeepSeek P50 120000ms.

Raw artifacts: `output/background-model-ab/` (gitignored). This file contains aggregate results only; no secrets.

## Sample excerpts (sanitized)

### Summary — deepseek run 1
```
The operation was aborted due to timeout
```

### Summary — luna run 1
```
연회장 복도에서 레온을 따라 정원 테라스로 이동한 뒤, 유저가 분위기의 이상함을 언급하고 그의 손을 잡으며 할 말을 꺼냄. 레온은 굳은 표정으로 듣던 중 청혼에 가까운 고백을 함. 유저의 마음을 전해 들은 레온은 이를 받아들이는 태도를 보임. 유저가 약속의 증표로 은색 커프링크스 상자를 건네자 레온은 이를 받아 “네가 원하는 대로 하자”고 말함. 유저는 다음 날 아침까지 답을 주겠다고 약속하고 물러났으며, 두 사람의 관계는 아직 미정이나 레온이 커프링크스를 소유하고 답변을 기다리는 상태임.
```
