# 12_PROMPT_OWNER_REGISTRY

Governance target: every prompt rule eventually carries OWNER / PURPOSE / CACHE CLASS / RECENCY NEED / MODELS / FAILURE / TEST.

## Architecture order (target)

1. CANON / KNOWLEDGE  
2. USER AGENCY  
3. OUTPUT LANGUAGE  
4. OUTPUT SYNTAX  
5. PROSE QUALITY FLOOR  
6. SEMANTIC LAYOUT  
7. PRIVATE OUTPUT HYGIENE  
8. RUNTIME CONTENT  
9. CURRENT USER INPUT  
10. fragile recency tail  
11. model-specific terminal  

Principle: **ONE SEMANTIC RULE → ONE PRIMARY OWNER**.  
Exception: mechanical rules with proven recency sensitivity may keep a one-line terminal echo.

## Registry (STEP C snapshot)

| OWNER | PURPOSE | CACHE | RECENCY | MODELS | FAILURE IT PREVENTS | TEST / EVIDENCE | C1 STATUS |
|---|---|---|---|---|---|---|---|
| `openrouter-korean-prose-top` (CANON/SCOPE/KNOWLEDGE + OUTPUT LANG) | scope + language | cacheRules | no | all OR | out-of-canon / wrong language | compression audit reclass | PROTECTED |
| `no-godmodding` / collaborative interactive | user agency | cacheRules | no | all | user takeover / godmodding | agency audits | PROTECTED |
| `prose-style-xml-bundle` | literary quality floor | cacheCharacter | no | all | translationese / AI prose | C2 design only | PROTECTED |
| `rule-output-layout-recency` | semantic paragraphs + dialogue/narration separation | **dynamic** | system primary | all | glued dialogue; sentence-per-paragraph | C1 A/B | **VARIABLE** |
| `buildCompactTerminalLayoutRecencyLine` | mechanical blank-line echo | user-tail | **YES — 1 line** | all | glued dialogue at end of turn | layout audits | PROTECTED echo |
| `runtime-prompt-contamination-guard` | private hygiene / leak | cacheRules (model variants) | no | all (+DS variant) | meta/JSON/section leak | C3 design | PROTECTED |
| `OPUS_ARM_E_TERMINAL` | Opus length+agency terminal | user-tail | yes | Opus | short/agency collapse | PR #269 REJECT compact | FROZEN |
| `DEEPSEEK_COMPACT_FUTURE_INSTRUCTION_BOUNDARY` | DS future-instruction boundary | DS adapter | yes | DeepSeek | instruction overreach | DS audits | PROTECTED |
| DeepSeek production style reminder / XML | DS style structure | DS path | yes | DeepSeek | style/structure drift | DS audits | PROTECTED |
| `TERRA_TERMINAL_LENGTH_OWNER_CONTRACT` | Terra length terminal | user-tail | yes | Terra | length owner loss | Terra audits | PROTECTED |
| `CURRENT USER INPUT` wrapper | interactive ownership | user-tail | yes | all | writing beyond user turn | STEP A / agency | PROTECTED |
| length owner / regen / memory / lorebook / persona / triggers | content & length | mixed | mixed | all | content loss | existing suites | PROTECTED |

## Prompt rule budget (add-a-rule checklist)

Before adding any new rule, answer:

1. What failure does this prevent?  
2. Is that failure reproduced?  
3. Does another owner already cover it?  
4. Can an existing owner be edited instead?  
5. Does it need recency?  
6. Does it need all models?  
7. What test permits its removal later?

## Token budget is per owner

Do **not** govern with a single `system_total <= X`. Prefer:

| class | policy |
|---|---|
| CANON / CONTENT | variable — do not force-compress |
| AGENCY | protected / evidence-backed |
| LAYOUT | compact primary + one-line echo |
| PROSE | quality floor only |
| HYGIENE | compact leak-prevention |
| MODEL TERMINAL | evidence-backed adapters only |

## Realistic STEP-C savings ambition (quality-preserving)

| step | est reduction |
|---|---:|
| C1 layout | ~250–400 |
| C2 prose merge | ~300–600 |
| C3 hygiene | ~200–350 |
| **total** | **~750–1350** |

Arm E and canon/language remain protected; do not chase a blunt 1100–1800 total cut.
