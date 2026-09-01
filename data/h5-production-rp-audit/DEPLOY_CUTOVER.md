# Mid-run production deploy cutover

Recorded as an objective runtime fact. Not a retry.

At sampler start:

- ORIGIN_MAIN_SHA / DEPLOYED_SHA = `f14033e8882af68a1593ad7687cc9317829f78c8`
- DEPLOY_STATUS = SUCCESS
- deploy id `8cdfa5c4-172c-4741-837f-9a3946eb4bfe`

During the three scheduled turns, Railway replaced that deploy with:

- SHA `3a87d14d2ac9c5771ebffaf9564b0700c75b091b`
- merge of #550 (TRPG canonical stats)
- deploy id `9e310f31-6a3d-4860-9bc8-c85249caf1ec`
- DEPLOY_STATUS = SUCCESS

`f14033e8` is an ancestor of `3a87d14d`, so #548 / #549 / #546 remain in the new main.

Observed turn outcomes:

- A 플러드: HTTP 200, `turn_persisted`, chat 739 created, assistant row left `generation_status=generating` with empty content. No billing row. No retry.
- B 에녹: HTTP 502 `Application failed to respond`. No chat row. No retry.
- C 라이크: HTTP 200 completed on the new deploy. Chat 740. One assistant. One billing deduction.

No fourth sample was run.
