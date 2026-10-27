# Turn-by-turn comparison — chat 803 vs chat 804

## Conditions

| Field | Chat 803 (historical) | Chat 804 (e22 live) |
|---|---|---|
| Evidence source | DB `messages.content` | Browser UI text extraction |
| Text Lock | `59985461…` (pre-e22) | `e22ba966…` (post-apply) |
| Greeting at RP | 1398 chars (msg 4126) | 1411 chars (apply-time) |
| Model | `gpt-6.1-sol` | `gpt-6.1-sol` (UI label) |
| Persona | 렌 (id 1) | 렌 (id 1) |
| Adult / handoff | OFF | OFF |
| Wire capture | `w51-paid-rp-20261020` (pre-send main+luna) | Not captured (`RP_WIRE_CAPTURE_*` empty) |
| Billing ledger | $0.182803 verified (803) | Not verified in extraction pass |
| `[태그:…]` in stored/UI prose | 0 / 0 turns | 0 / 0 turns (UI) |
| Status widget block | Not in DB storage | Present after each assistant turn (UI) |

## User input differences

| Turn | 803 stored (DB) | 804 (UI) | Notes |
|---:|---|---|---|
| 1 | `…죄목이 무엇인지, 인이 있는 문서…` (80 chars) | `…죄목 무엇인지, 인이 있는 문서…` (76 chars) | UI missing spaces after periods |
| 2 | Matches script (79 chars) | Same text, tighter spacing (76 chars) | |
| 3 | Matches script (41 chars) | Same (40 chars) | UI spacing |
| 4 | `…봉인고의 인계 록을…` (52 chars) | `…봉인고의 인계 기록을…` (52 chars) | **803 「인계 록」 vs 804 「인계 기록」** |

## Assistant length (803 = DB; 804 = UI narrative prose only, widget excluded)

| Turn | 803 msg id | 803 chars | 804 prose chars (UI) |
|---:|---|---:|---:|
| 1 | 4128 | 3831 | 4046 |
| 2 | 4130 | 4047 | 4024 |
| 3 | 4132 | 3884 | 4346 |
| 4 | 4134 | 4319 | 4119 |

## Chat 803 assistant SHA-256 (DB = export artifact)

| Message id | SHA-256 |
|---:|---|
| 4128 | `b53cd02d5bc2b83fd26ce0c24bbb7c9bc778e49120f89777a5fbdba9b49fd315` |
| 4130 | `405e2a669bbad02c4bc5dc7205849ebd794f80fb52b68bcda2486003707a2835` |
| 4132 | `3fc840a2956d6665d927e388500e23995db56c1b9c17bcad046d1286ff126bf9` |
| 4134 | `c77689b03a53c91d3585980720578274ffc777fa64ad8a3d413ba59263eed434` |

## Verification limits (804)

- UI extraction may omit or merge whitespace vs future DB read.
- Status widget text is documented separately in `chat804-e22-full.md` per turn.
- Inline emotion/scene images: not observed in UI screenshots; no tag markers in prose.
- Re-verify 804 against DB when operational SSH/ledger access is available.
