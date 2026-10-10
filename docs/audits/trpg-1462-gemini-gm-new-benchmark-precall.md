# TRPG #1462 Gemini GM new-benchmark PRECALL

Status: **PRECALL_READY**
Provider POSTs this turn: **0**
Production DB writes: **0**
#1465 / #1468 / #1480 / #1477 / #1483: prompts, persist logic, 12-call journals, and Golden v1 were not modified.

This is a **NEW BENCHMARK**. It is not an exact replay of #1468 F.

## Verdict

`#1480` GM-authority wording can be compared to `#1465` on identical frozen inputs after paid approval. Cursor does not score GM fiction.

## Current source

| Ref | HEAD |
| --- | --- |
| origin/main after #1483 | `4d83c100666878cca747408ae72a18f3360310ac` |
| #1465 persist Draft | `2a6fba33a803a5fd7100295881b5af0dc23121ac` |
| #1480 prompt Draft | `34f3bc7e0b24d1847a86cf39c9a19abc99313d8a` |
| #1468 evidence Draft | `d1424158004e1fb5701b8db9b47398ac363d8a65` |

Experiment old system = **#1465 `TRPG_GM_SYSTEM`**, not current main. Current main `gmPrompt.ts` still lacks the #1465 speech-format / ROUND CRAFT 2 / persona-header deltas.

`#1465 → #1480` runtime delta is one Rules sentence in `TRPG_GM_SYSTEM`. `buildTrpgGmUserBlock`, `buildTrpgGmProviderRequest`, `adaptTrpgGmChatBody`, and `gmCall.ts` are byte-identical.

- old: `Inventory, location, quests, NPCs, flags, and story progress remain yours`
- new: `Inventory, quests, NPCs, flags, story progress, and world/NPC location remain yours`

System SHA-256:

- #1465 / recorded #1468 system: `0887fbd2fb1c66870bfb1865411c96bba0790b52ad3a3a0fc638ed0f562ccfd5`
- #1480: `f35aa34f99a70f93394943ad042193243dcaa4b23938f32a32fb8446b0697515`

Model: production TRPG GM only — `gemini-3.8-flash`. temperature `0.7`, stream `true`, max_tokens `65535`, reasoning_effort `low`.

## Historical recovery

Checked once in this agent's persistent store (`/cursor/stores/bc-c006d2fc-d52c-48ef-b878-88f6de8e9d27`) plus leftover `/tmp` reconstructions.

Result: **RECOVERY_UNAVAILABLE**.

Hashes and public narrations for #1468 F exist. The exact final system+user bytes that hashed to `13fd812b8358a522e061fd6b1e805ee8cefcbc4dd1f5a5a4a1a0d99adf499ad8` do not. `/tmp/trpg1462-assembled.json` matches F `userChars=3366` and the #1465 system SHA, but its prompt SHA is `aad249b88e6ace80c883ccb5efde3009b9ddc9a4a27a2f0f79c603c264678d88`. Partial WORLD/sheet/persona fill is not claimed as historical F.

## New fixture

Public synthetic WORLD. No GM SECRET. Same F-type action, adjudication, dice, sheet, memory, and Gemini body owner for A/B.

| ID | System | User | Purpose |
| --- | --- | --- | --- |
| A | #1465 | F `달을 주머니에 넣는다.` no_check `no_meaningful_uncertainty` d20=10 unused | old prompt |
| B | #1480 | identical F user | new prompt |
| C | both | `열린 찻집 문으로 들어간다.` no_check `routine_traversal` | declared move |
| D | both | `그 자리에 서서 골목 소리를 듣는다.` no_check `no_meaningful_uncertainty` | PC still; NPC/world may act |

Pinned request SHA-256 (see `TRPG_1462_PINNED_REQUEST_HASHES`):

| ID | user | prompt | request body |
| --- | --- | --- | --- |
| A | `b68dfc858da0fdcc60fec260cdec5f770d22c25041ce0ee62130094fb5a232b3` | `e37c1d45cf734aeaa9d7f08b973eb9c606c1ea2bd8a78fccd263b87d1ebbd3cf` | `cf26e3598bbc360c7e247d7474e5e720a5f6c0b456bcf4395b264a17801b1bdb` |
| B | same as A | `add5dfa19870f2affe6739b6ded67f39cace965b27f66f05d4d49f11ac1b8ecd` | `cf6047cb0b59d8e87413663e129c7047546caf399fa619e37a2b17d9a9cfb71c` |
| C_1480 | `1bf7e4f7a674cbea933fc4dcd8a26e39763064b762bcb630805f6e87f306386d` | `bcd09ec5051b6907cb5e6ace15fe9264d6342f0d3b57017e1bd8d34b024de326` | `b706f8585ef120f70dd6b91c4dd603c18ab5d13f3e05497c2566aa39a249da76` |
| D_1480 | `971ce9aa140df5b210894ab84efea7216105d6ebf422139a3850dd3c3b2fe1d3` | `ca238304a7aa6f92451589cf3427268f2f02d97bb4254756deb7028559e124df` | `8b29adbf4789c34daddc98e77277f8e5a7e9be3effad4e1b83c4271a40d7b7ce` |

A serialized body becomes B when only the intended Rules sentence is replaced.

## One-shot transport

Production `callTrpgGm` → `postTrpgGmStream` still uses `GM_MAX_PROVIDER_ATTEMPTS=2` on HTTP 500/502/503/504. The experiment must not call that path.

Reuse `buildTrpgGmProviderRequest` / `adaptTrpgGmChatBody`. One POST per reserved journal row. Restart after `reserved` / `posted` / `unknown` / `timeout` / `http_error` does not POST again.

## Private store

Railway production at probe time:

- deploy SHA `4d83c100666878cca747408ae72a18f3360310ac` (matches origin/main)
- SSH user `root`
- `/data` writable
- `/data/private-golden-fixtures` and `/data/rp-quality-12call` exist and were not listed or modified

New directory: `/data/private-trpg-1462-gm-precall/attempt-journal.json` (hash-only journal). Cursor copy under this agent's store.

## Approval gate

Do not POST until an explicit paid-experiment approval.

- Minimum paid calls: **4** (`A`, `B`, `C_1480`, `D_1480`)
- Optional complete matrix: **6** (adds `C_1465`, `D_1465`)
- Published-rate estimate only, not an invoice: Gemini 3.8 Flash $0.375 / $1.875 per million tokens. #1468 F was about $0.0043. Expect about **$0.018** for 4 calls or **$0.027** for 6.
- Actual outputs are for GPT review after approval. No auto-merge of #1465 / #1468 / #1480.
