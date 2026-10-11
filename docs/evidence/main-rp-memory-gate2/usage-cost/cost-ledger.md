# Gate 2 usage and cost ledger (provider-returned usage; 18 real calls)

Assumptions: FX 1,700 KRW/USD. Rates $/M tokens (in/out): deepseek-v4.1-flash 0.075/0.30, gemini-3.8-flash 0.75/3.75, gpt-6.1-sol 1.30/6.50. "no-cache USD" = prompt*in + completion*out with NO cache discount (upper-ish estimate). `reported cost` is the provider-returned `usage.cost` and exists only for Gemini via OpenRouter; DeepSeek and Sol (CheaperInference route, Sol `is_byok:true`) returned no cost field. No `max_tokens` was sent; output was not capped. Opus 5.5 (6 planned calls, worst case ~1,201 KRW) was NOT run. Raw provider usage objects are in `unblinded-results/*.json` and `execute.log`.

| POST# | scene | arm | model | prompt tok | completion tok | cached tok | reasoning tok | reported cost USD | no-cache USD | output chars | finish | latency ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | A_direct_quote | old | deepseek-v4.1-flash | 6506 | 1015 | 0 | 0 | None | 0.00079 | 1339 | stop | 8244 |
| 2 | A_direct_quote | b1 | deepseek-v4.1-flash | 6512 | 1194 | 0 | 0 | None | 0.00085 | 1591 | stop | 6030 |
| 3 | A_direct_quote | cur | deepseek-v4.1-flash | 6543 | 1074 | 0 | 0 | None | 0.00081 | 1426 | stop | 8170 |
| 4 | B_npc_no_cue | old | deepseek-v4.1-flash | 6718 | 1333 | 0 | 0 | None | 0.0009 | 1810 | stop | 6439 |
| 5 | B_npc_no_cue | b1 | deepseek-v4.1-flash | 6787 | 1238 | 0 | 0 | None | 0.00088 | 1694 | stop | 6603 |
| 6 | B_npc_no_cue | cur | deepseek-v4.1-flash | 6785 | 1215 | 0 | 0 | None | 0.00087 | 1678 | stop | 7597 |
| 7 | A_direct_quote | old | gemini-3.8-flash | 5514 | 1376 | 5002 | 0 | 0.003063783333333333 | 0.0093 | 2152 | stop | 18463 |
| 8 | A_direct_quote | b1 | gemini-3.8-flash | 5519 | 3102 | 5007 | 0 | 0.006300325 | 0.01577 | 4846 | stop | 32192 |
| 9 | A_direct_quote | cur | gemini-3.8-flash | 5547 | 1376 | 5035 | 0 | 0.0030657083333333335 | 0.00932 | 2168 | stop | 17601 |
| 10 | B_npc_no_cue | old | gemini-3.8-flash | 5707 | 2822 | 5156 | 0 | 0.0057986416666666665 | 0.01486 | 4268 | stop | 32641 |
| 11 | B_npc_no_cue | b1 | gemini-3.8-flash | 5768 | 1401 | 5217 | 0 | 0.003137825 | 0.00958 | 2075 | stop | 15433 |
| 12 | B_npc_no_cue | cur | gemini-3.8-flash | 5765 | 4894 | 5214 | 1691 | 0.009687025 | 0.02268 | 4857 | stop | 55009 |
| 13 | A_direct_quote | old | gpt-6.1-sol | 5628 | 2583 | 0 | 26 | None | 0.02411 | 4114 | stop | 49661 |
| 14 | A_direct_quote | b1 | gpt-6.1-sol | 5633 | 2491 | 2518 | 60 | None | 0.02351 | 4009 | stop | 48353 |
| 15 | A_direct_quote | cur | gpt-6.1-sol | 5661 | 2363 | 2518 | 63 | None | 0.02272 | 3711 | stop | 44643 |
| 16 | B_npc_no_cue | old | gpt-6.1-sol | 5817 | 2814 | 2518 | 33 | None | 0.02585 | 4219 | stop | 52104 |
| 17 | B_npc_no_cue | b1 | gpt-6.1-sol | 5885 | 3034 | 2518 | 30 | None | 0.02737 | 4643 | stop | 57982 |
| 18 | B_npc_no_cue | cur | gpt-6.1-sol | 5882 | 2842 | 2518 | 33 | None | 0.02612 | 4325 | stop | 53518 |

## Totals by model

| model | prompt | completion | no-cache USD | no-cache KRW | reported USD |
|---|---|---|---|---|---|
| deepseek-v4.1-flash | 39851 | 7069 | 0.0051 | 9 | 0.00000 |
| gemini-3.8-flash | 33820 | 14971 | 0.0815 | 139 | 0.03105 |
| gpt-6.1-sol | 34506 | 16127 | 0.1497 | 254 | 0.00000 |
| **total** | | | 0.2363 | 402 | |
