# 07_SCORE_SEAL — C2-R Stage1 T (sealed before reveal)

Blind scores submitted before reading `09_REVEAL.md`.

Hard-gate policy: any of agency severe / incomplete / input echo / metadata leak /
language regression / scene density collapse → arm disqualified for that model.

## Auto hard gates

| Cell | Hard? | Reason |
|------|-------|--------|
| Gemini_T_A | YES | scene density collapse (visible_chars=380) |
| Gemini_T_M1 | no | — |
| Gemini_T_M2 | no | — |
| Gemini_T_AB | no | — |
| DeepSeek_T_A | no | — |
| DeepSeek_T_M1 | YES | scene density collapse (visible_chars=769) |
| DeepSeek_T_M2 | no | — |
| DeepSeek_T_AB | YES | incomplete (finish_reason=error, mid-sentence cut) |

## Blind scores (Gemini_T)

Display order sealed in `08_HIDDEN_MAP.json`.

| Label | /100 | OVER_EXPLANATION/10 | SCENE MOMENTUM/10 | MODEL-SPECIFIC VOICE/10 | Notes |
|-------|------|---------------------|-------------------|-------------------------|-------|
| W | 85 | 6 | 8 | 8 | dense survival craft; some over-explain |
| X | 83 | 8 | 7 | 8 | sharper dialogue; slightly less atmospheric close |
| Y | HARD | — | — | — | density collapse — disqualified |
| Z | 87 | 7 | 9 | 8 | strongest scene momentum / creature approach |

**Gemini preferred (among valid):** Z > W > X

## Blind scores (DeepSeek_T)

| Label | /100 | OVER_EXPLANATION/10 | SCENE MOMENTUM/10 | MODEL-SPECIFIC VOICE/10 | Notes |
|-------|------|---------------------|-------------------|-------------------------|-------|
| W | HARD | — | — | — | incomplete / finish error |
| X | 80 | 7 | 7 | 8 | tactical dialogue ok; thinner close than Y |
| Y | 85 | 8 | 8 | 9 | restrained command voice; strongest DeepSeek sample |
| Z | HARD | — | — | — | density collapse |

**DeepSeek preferred (among valid):** Y > X

Scoring authority: literary blind review after automated hard-fail gate.
