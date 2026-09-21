# DeepSeek V4 Pro competitive pricing v4 audit

**Date:** 2026-09-21  
**Source of truth before this PR:** main `e2af534c340e0ac9bb109e0f0c2b502fe3662764`  
**Historical production v3 deployment:** Railway `34b32698-e34f-4272-98dd-487867d7d564` SUCCESS

## Product decision

DeepSeek V4 Pro remains token-proportional. There is no fixed 100P price.

Stable reference cost remains official PEAK:

- input miss: 1.32 USD/M
- output: 3.96 USD/M
- cache read: 0.044 USD/M

The representative golden turn:

- prompt: 33,247 tokens
- output: 3,461 tokens
- cache read: 0

is calibrated to **100P** using the existing published charge engine with:

- targetMargin: 0.10
- minimumMarginFloor: 0.00
- pricingVersion: 4
- publishedAt: 2026-09-21T12:57:00.000Z

## Version history

### v2 historical
- OFF-PEAK reference: 0.66 / 1.98 / 0.022
- target margin: 50%
- floor: 40%
- golden: 90P

### v3 historical production
- PEAK reference: 1.32 / 3.96 / 0.044
- target margin: 50%
- floor: 40%
- golden: 180P
- merged as PR #997
- production deployment succeeded

### v4 candidate
- PEAK reference unchanged
- target margin: 10%
- floor: 0%
- golden: 100P

v4 is a new semantic version because v3 reached production and must remain immutable historical evidence.

## Competitive calibration matrix

Locked deterministic FX from the existing billing fixture:

| Fixture | v2 | v3 peak50 | v4 competitive |
| --- | ---: | ---: | ---: |
| A 10k / 500 | 24P | 48P | 27P |
| B 30k / 3k | 81P | 161P | 90P |
| C 35k / 4k | 97P | 194P | 108P |
| D cache-heavy | 9P | 18P | 10P |
| E golden | 90P | 180P | **100P** |
| F 8k / 1.5k | 26P | 52P | 29P |

Competitor benchmark for the representative turn: approximately 105P.  
v4 golden target: 100P, about 4.76% lower.

## Canonical owners

- Published pricing: `publishedModelPricing.ts`
- Charge engine: `publishedUserCharge.ts`
- Billing dispatch: `chatBillingContractDispatch.ts`
- Pricing tracker classifier: `modelPriceChangeClassifier.ts`
- Settlement: existing exactly-once settlement owner

No fixed-price branch, multiplier, or V4-Pro-specific charge engine was added.

## Tracker correction

CI `procurement_reference` changes are classified from previous CI reference to current CI reference only.

Numeric equality with the published product baseline no longer suppresses a real CI reference transition.

Preserved:

- CI reference change -> `CI_REFERENCE_CHANGED_UNVERIFIED / HOLD`
- procurement vs published product baseline -> no false `SOURCE_CONFLICT`
- tracker remains OBSERVE_ONLY

## Historical receipt invariants

Regression coverage preserves both historical versions after live catalog moves to v4:

- stored v2 admin receipt remains pricingVersion=2 / 90P
- stored v3 admin receipt remains pricingVersion=3 / 180P

Current catalog v4 does not rewrite historical stored receipt semantics.

## Preserved behavior

- V4.1 pricing unchanged
- Phase2 fail-closed anomaly path unchanged at 0P
- Phase2 OFF / legacy behavior unchanged
- promotions unchanged
- no provider calls added
