# 00_BASELINE_HASHES

main_tip_at_freeze = 7cb23ec3e6837c9290ecca2fab2f51f17bb42ee2

| Owner | SHA-256 | est tokens | chars |
|---|---|---:|---:|
| `buildOpenRouterKoreanProseTopBlock()` | `b8021d1c57ff009a508100e54ed90fd940514532339e0c4884a514250c3d0ec4` | 738 | 819 |
| `buildAdvancedProseNsfwGuidelines({nsfwEnabled:false})` | `90ab305b53eaa45cf08e6b7397c0396d5762bf0380da42bb17a81c28a36faa90` | 1572 | 1746 |
| `buildAdvancedProseNsfwGuidelines({nsfwEnabled:true})` | `e6bbf83064e5f72ed6fc3d7682102b55ce3776b5d13ad532dae257d58971ca71` | 1709 | 1898 |
| `buildWebnovelOutputLayoutRecencyBlock()` | `bfd0acd498fb01003eaeffea09e462fcd182aaaa780cabcf3d773454e1215621` | 670 | 744 |
| `buildCompactTerminalLayoutRecencyLine()` | `08e94fce1b4e423e7113675b8a43f8ac439dd4af880708480f030fe08e60faab` | 49 | 54 |
| `buildRuntimePromptContaminationGuardBlock(Opus)` | `bf828dd61d01090fd363e4938bac1840c97c7035d0997d9bd534dc4b3478d79e` | 799 | 887 |
| `buildRuntimePromptContaminationGuardBlock(Gemini)` | `bf828dd61d01090fd363e4938bac1840c97c7035d0997d9bd534dc4b3478d79e` | 799 | 887 |
| `buildRuntimePromptContaminationGuardBlock(DeepSeek)` | `386ee5ac06fee97e61578d29febae34f9e011c753cf9b6946ce3e24b6cdda670` | 856 | 951 |
| `buildRuntimePromptContaminationGuardBlock(Terra)` | `bf828dd61d01090fd363e4938bac1840c97c7035d0997d9bd534dc4b3478d79e` | 799 | 887 |
| `buildNoGodmoddingBlock(... standard interactive)` | `b8325c8bca9adabac1152928e95f853e5d6157c71fc95ab4f7bfd5ec8bfa77d1` | 409 | 454 |
| `OPUS_ARM_E_TERMINAL` | `05225756dc2b19abebcf7ae2d5bc01717a6a98fed4494b25108901cca90e28ca` | 1134 | 1260 |
| `DEEPSEEK_COMPACT_FUTURE_INSTRUCTION_BOUNDARY` | `19fe862eba239fee85a93ea650c616402bd97986f0875ef8419044d26b2323a5` | 163 | 181 |
| `TERRA_TERMINAL_LENGTH_OWNER_CONTRACT` | `6e5b711ffd3b9bee507cc1e1479d940726de43c0b4e4019b3d7d47c12a60350e` | 152 | 168 |
| `OUTPUT_LAYOUT_SEMANTIC_COMPACT_CANDIDATE` | `34a57c0fc5bb50a5f271c03bd5bb74fef5a41610befa1806894ad9fc0b138503` | 281 | 312 |

## Protected (C1 must remain byte-identical in assembled prompts)

- OPUS_ARM_E_TERMINAL
- buildNoGodmoddingBlock standard
- DEEPSEEK_COMPACT_FUTURE_INSTRUCTION_BOUNDARY
- TERRA_TERMINAL_LENGTH_OWNER_CONTRACT
- buildOpenRouterKoreanProseTopBlock (CANON/SCOPE/KNOWLEDGE + OUTPUT LANG)
- buildAdvancedProseNsfwGuidelines
- buildRuntimePromptContaminationGuardBlock(*)
- buildCompactTerminalLayoutRecencyLine (user-tail echo kept)

## Unique C1 variable

```text
OUTPUT LAYOUT SYSTEM BLOCK
A = buildWebnovelOutputLayoutRecencyBlock()
B = OUTPUT_LAYOUT_SEMANTIC_COMPACT_CANDIDATE
```
