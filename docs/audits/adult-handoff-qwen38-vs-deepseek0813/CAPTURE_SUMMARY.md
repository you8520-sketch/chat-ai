# CAPTURE SUMMARY — DeepSeek V4 Pro 0813 vs Qwen 3.8 Max

```text
branch = audit/adult-handoff-qwen38-vs-deepseek0813
commit = bca11fd91cdd81c7534b1246fe18da5a61e94d94
base main sha = 382b6cf29eb512a72258e655c7223985ca0d81c6
Base URL = https://api.cheaperinference.com/v1
requested model IDs = deepseek-v4-pro-0813, qwen-3-8-max
API calls = 6
retry = 0
continuation = 0
recovery = 0
fallback = 0
HUMAN_DIRECT_REVIEW_REQUIRED = true
FINAL_WINNER = NOT_YET_JUDGED
```

## Catalog (not a generation call)

- `deepseek-v4-pro` present: True
- `deepseek-v4-pro-0813` present: True
- `qwen-3-8-max` present: True

`deepseek-v4-pro` and `deepseek-v4-pro-0813` both appear as distinct catalog IDs. No extra generation call was made to see whether the production alias resolves to 0813 at request time.

## Generation parameter difference

DeepSeek cells used the current production DeepSeek adult-handoff assemble path (`deepseek-v4-pro` adapters) and then sent `model=deepseek-v4-pro-0813`.
Recorded DeepSeek request: temperature 0.92, top_p 0.92, thinking disabled.

Qwen cells used the common adult-handoff contract plus existing generic Qwen handling (`isQwenModel`). No Qwen 3.8-specific style prompt was added.
Recorded Qwen request: temperature 0.7, reasoning_effort none.

This is `EXPECTED_PROVIDER_DIFFERENCE` from existing production adapters, not a fairness retune.

## Cells

### OPUS_DEEPSEEK
- HTTP status: 200
- requested model: deepseek-v4-pro-0813
- resolved model: deepseek-v4-pro-0813
- finish reason: stop
- visible chars: 2663
- latency: 138.71
- token usage: input=8931 output=9098 reasoning=None
- cost: 0.010068
- refusal: False
- actor/target inversion diagnostic: {'previousActionActorPreserved': False, 'previousActionTargetPreserved': False, 'contactDirectionPreserved': False, 'positionPreserved': True, 'note': 'POSSIBLE inversion: user wrapping character waist vs source (character wraps user)'}
- generation: {'temperature': 0.92, 'top_p': 0.92, 'max_tokens': None, 'thinking': {'type': 'disabled'}, 'reasoning': None, 'reasoning_effort': None, 'output_config': None}
- adapters: {'xml_wrapping': True, 'style_reminder': True, 'compact_boundary': False, 'muse_m1_marker': False, 'handoff_continuation_instruction': True, 'qwen38_style_prompt_added': False}
### OPUS_QWEN
- HTTP status: 200
- requested model: qwen-3-8-max
- resolved model: qwen-3-8-max
- finish reason: stop
- visible chars: 3843
- latency: 274.567
- token usage: input=7045 output=13747 reasoning=None
- cost: 0.072895
- refusal: False
- actor/target inversion diagnostic: {'previousActionActorPreserved': True, 'previousActionTargetPreserved': True, 'contactDirectionPreserved': True, 'positionPreserved': True, 'note': 'no clear inversion of waist-wrap direction'}
- generation: {'temperature': 0.7, 'top_p': None, 'max_tokens': None, 'thinking': None, 'reasoning': None, 'reasoning_effort': 'none', 'output_config': None}
- adapters: {'xml_wrapping': False, 'style_reminder': False, 'compact_boundary': False, 'muse_m1_marker': False, 'handoff_continuation_instruction': True, 'qwen38_style_prompt_added': False}
### TERRA_DEEPSEEK
- HTTP status: 200
- requested model: deepseek-v4-pro-0813
- resolved model: deepseek-v4-pro-0813
- finish reason: stop
- visible chars: 2571
- latency: 107.626
- token usage: input=8014 output=6300 reasoning=None
- cost: 0.007656
- refusal: False
- actor/target inversion diagnostic: {'previousActionActorPreserved': True, 'previousActionTargetPreserved': True, 'contactDirectionPreserved': True, 'positionPreserved': True, 'note': 'no clear inversion of waist-wrap direction'}
- generation: {'temperature': 0.92, 'top_p': 0.92, 'max_tokens': None, 'thinking': {'type': 'disabled'}, 'reasoning': None, 'reasoning_effort': None, 'output_config': None}
- adapters: {'xml_wrapping': True, 'style_reminder': True, 'compact_boundary': False, 'muse_m1_marker': False, 'handoff_continuation_instruction': True, 'qwen38_style_prompt_added': False}
### TERRA_QWEN
- HTTP status: 200
- requested model: qwen-3-8-max
- resolved model: qwen-3-8-max
- finish reason: stop
- visible chars: 5497
- latency: 273.315
- token usage: input=6251 output=11029 reasoning=None
- cost: 0.059742
- refusal: False
- actor/target inversion diagnostic: {'previousActionActorPreserved': True, 'previousActionTargetPreserved': True, 'contactDirectionPreserved': True, 'positionPreserved': True, 'note': 'no clear inversion of waist-wrap direction'}
- generation: {'temperature': 0.7, 'top_p': None, 'max_tokens': None, 'thinking': None, 'reasoning': None, 'reasoning_effort': 'none', 'output_config': None}
- adapters: {'xml_wrapping': False, 'style_reminder': False, 'compact_boundary': False, 'muse_m1_marker': False, 'handoff_continuation_instruction': True, 'qwen38_style_prompt_added': False}
### GEMINI_DEEPSEEK
- HTTP status: 200
- requested model: deepseek-v4-pro-0813
- resolved model: deepseek-v4-pro-0813
- finish reason: stop
- visible chars: 2354
- latency: 85.744
- token usage: input=11870 output=4987 reasoning=None
- cost: 0.007696
- refusal: False
- actor/target inversion diagnostic: {'previousActionActorPreserved': False, 'previousActionTargetPreserved': False, 'contactDirectionPreserved': False, 'positionPreserved': True, 'note': 'POSSIBLE inversion: user wrapping character waist vs source (character wraps user)'}
- generation: {'temperature': 0.92, 'top_p': 0.92, 'max_tokens': None, 'thinking': {'type': 'disabled'}, 'reasoning': None, 'reasoning_effort': None, 'output_config': None}
- adapters: {'xml_wrapping': True, 'style_reminder': True, 'compact_boundary': False, 'muse_m1_marker': False, 'handoff_continuation_instruction': True, 'qwen38_style_prompt_added': False}
### GEMINI_QWEN
- HTTP status: 200
- requested model: qwen-3-8-max
- resolved model: qwen-3-8-max
- finish reason: stop
- visible chars: 3111
- latency: 219.444
- token usage: input=9165 output=9874 reasoning=None
- cost: 0.061266
- refusal: False
- actor/target inversion diagnostic: {'previousActionActorPreserved': True, 'previousActionTargetPreserved': True, 'contactDirectionPreserved': True, 'positionPreserved': True, 'note': 'no clear inversion of waist-wrap direction'}
- generation: {'temperature': 0.7, 'top_p': None, 'max_tokens': None, 'thinking': None, 'reasoning': None, 'reasoning_effort': 'none', 'output_config': None}
- adapters: {'xml_wrapping': False, 'style_reminder': False, 'compact_boundary': False, 'muse_m1_marker': False, 'handoff_continuation_instruction': True, 'qwen38_style_prompt_added': False}


## Production safety

```text
production adult model = unchanged
Railway = unchanged
pricing = unchanged
general routing = unchanged
DB = unchanged
Qwen3.8 public adult route = NOT CONNECTED
```
