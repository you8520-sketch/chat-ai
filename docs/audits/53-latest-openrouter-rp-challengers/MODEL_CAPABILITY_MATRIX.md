# Model capability matrix — Audit 53

OpenRouter discovery before live RP screen. No silent substitution.

| Model | Exists | Context | Input $/M | Output $/M | Cache-read $/M | Endpoints | Reasoning | Policy | Verdict |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |
| `aion-labs/aion-3.0` | yes | 131072 | 3.0 | 6.0 | 0.75 | 1 | mandatory=True; none=False | `{"effort": "minimal", "exclude": true}` | `AION_30_DISCOVERY_PASS` |
| `minimax/minimax-m3` | yes | 1048576 | 0.3 | 1.2 | 0.06 | 9 | mandatory=False; none=True | `{"effort": "none", "exclude": true}` | `MINIMAX_M3_DISCOVERY_PASS` |
| `z-ai/glm-5.2` | yes | 1048576 | 0.546 | 1.716 | 0.10139999999999999 | 32 | mandatory=False; none=True | `{"effort": "none", "exclude": true}` | `GLM_52_DISCOVERY_PASS` |

## Notes

- Aion 3.0 rejects `reasoning.effort=none` (mandatory). Use `minimal` + `exclude:true`.
- MiniMax M3 and GLM 5.2 accept `effort=none` + `exclude:true`.
- `exclude:true` hides reasoning text; Aion still bills reasoning tokens.
- Provider endpoint fallback for the same model id is allowed; cross-model fallback is not.

