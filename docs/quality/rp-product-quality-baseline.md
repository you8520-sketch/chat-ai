# Main RP product quality baseline

Canonical owners live in code:

- refund threshold: `src/lib/reportRefundPolicy.ts`
- length classification: `src/lib/rpQualityBaseline.ts`
- evaluation packet / rubric: `src/lib/rpQualityEvaluationPacket.ts`
- authoring capabilities: `src/lib/userAuthoringPolicy.ts`

Cursor does not score prose. GPT/human fill the packet.

## Product contract

`LENGTH SERVES QUALITY. QUALITY DOES NOT SERVE LENGTH.`

Generation steering remains a 3,200+ soft aim. Exact 3,200 is not the acceptance gate.

| Visible Korean chars | Class | Product meaning |
| --- | --- | --- |
| <= 1000 | `refund_evidence` | Under_length / 출력량 부족 신고 시 기존 자동환불 pipeline의 deterministic evidence |
| 1001–1500 | `short_risk` | Diagnostic only. Not hard fail. No automatic provider retry |
| 1501–2699 | `short_acceptable` | Short but allowed when the scene completes with high prose quality |
| 2700–3500 | `center_band` | Usual desired band. About 3000 is a normal result |
| > 3500 | `long_ok` | Not an upper-cap violation when the extra length is scene-needed and not padding |

## Refund owner

Do not create a second refund system. `processReportRefund` still owns:

- existing report/refund route and category validation
- exact deduction-slice reversal
- already-refunded protection
- integrity fail => pending/manual
- 24h UI report window
- daily auto-refund limit 3

`under_length` evidence is inclusive `visible chars <= 1000`. Other categories do not become auto-refundable from length alone.

## Authoring matrix

Ordinary-input and auto-progression authoring settings stay independent persistent preferences.

ALLOW is not a higher quality level. It only widens available [B] material.

## 19+ overlay

Explicitness volume is not a quality score. Use the adult overlay items in the evaluation packet. No new NSFW prompt is added here.

## Future prose benchmark (record only)

Priority models: GPT-6.1 Sol, Claude Opus 5.5, DeepSeek V4.1 Flash, Gemini 3.8 Flash.

Excluded from this new prose benchmark budget: Gemini 3.1 Pro Preview, Gemini 3.7 Flash.

Gemini 3.7 Flash is not recorded as shutting down. 3.8 Flash is the latest GA Flash and the new HAV prose baseline target.

## Separate follow-up — not in this PR

TRPG Gemini 3.7 Flash -> Gemini 3.8 Flash canonical migration. Current main still uses Gemini 3.7 Flash for TRPG GM/Bot on CheaperInference. `isCheaperInferenceModel()` does not register Gemini 3.8 Flash. This is not a constant swap.
