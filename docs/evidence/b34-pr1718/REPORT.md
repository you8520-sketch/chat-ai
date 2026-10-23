# B34 PR #1718 — Luna live quality evidence (렌/볼프강 SAFE)
Code HEAD: `f65c42e09fde958bc22985e322a417220052d8ba`. Machine-readable runs: [`live-runs-detailed.jsonl`](./live-runs-detailed.jsonl) (includes full `providerText` per call).
## Execution conditions
- **model**: `gpt-6-luna`
- **fixture**: `src/lib/test/renWolfgangSafeFixture.ts (B32 렌/볼프강 SAFE wire)`
- **userMessageChars**: `118`
- **assistantMessageChars**: `3694`
- **database**: `installIsolatedTestDatabase() temp SQLite (not production)`
- **credential**: `CHEAPER_INFERENCE_BENCHMARK_API_KEY (distinct from production key)`
- **memoryFeature**: `MEMORY_FEATURE_ENABLED=1`
- **runsPerPath**: `5`
- **codeHead**: `f65c42e09fde958bc22985e322a417220052d8ba`

This capture re-ran **5× OLD Shared (status ON, episodic in schema)** + **5× NEW independent episodic** because the earlier PR run (`/opt/cursor/artifacts/b34/live-runs.jsonl`) kept summaries only, not provider JSON.
**Total API spend this capture:** $0.001581 (≈ ₩2.47 at 1560.60/USD).
## OLD — Shared status ON (widget + suggestions + relationship + episodic)
### Run 1
- Tokens: in=5276 out=303 · cost=$0.000132 · transportOk=True
- Counts: raw=0 · parse-valid=0 · persist-insertable=0 · skipped=[]
- Provider JSON: see `live-runs-detailed.jsonl` entry path=OLD_shared_status_on run=1 (`providerText` field).
| source_quote | fact_text | parse_valid | persist_stage | persist_detail | stored | target_events |
|---|---|:---:|:---|:---|:---:|:---|
### Run 2
- Tokens: in=5276 out=762 · cost=$0.000282 · transportOk=True
- Counts: raw=3 · parse-valid=0 · persist-insertable=0 · skipped=['schema_rejected:3']
- Provider JSON: see `live-runs-detailed.jsonl` entry path=OLD_shared_status_on run=2 (`providerText` field).
| source_quote | fact_text | parse_valid | persist_stage | persist_detail | stored | target_events |
|---|---|:---:|:---|:---|:---:|:---|
| 나는 내 진술을 황실 감찰관에게 전달하는 데 동의하지 않았어. 먼저 기록을 내가 직접 확인하겠어. 누구에게 전달할지는 그다음에 정하겠다. | 렌은 자신의 진술을 황실 감찰관에게 전달하는 데 동의하지 않았고, 기록을 직접 확인한 뒤 전달 대상을 정하겠다고 말했다. | False | parse_sanitizer_rejected | — | False | user_refusal, user_review_first |
| 열람은 허락한다. 단, 이 천막 안에서만이다. 필사는 안 된다. | 볼프강은 렌에게 천막 안에서 기록철을 열람하도록 허락했으며 필사는 금지했다. | False | parse_sanitizer_rejected | — | False | — |
| 이 진술은 감찰관에게 전달하지 마라. 감찰관이 도착해서 요구하더라도 마찬가지다. 본인이 허락하기 전까지는 이 천막 밖으로 한 장도 나가지 않는다. | 볼프강은 렌이 허락하기 전까지 진술을 감찰관에게 전달하지 말라고 명령했고, 감찰관이 직접 요구하면 자신을 부르라고 했다. | False | parse_sanitizer_rejected | — | False | wolfgang_forward_ban |
### Run 3
- Tokens: in=5276 out=612 · cost=$0.000233 · transportOk=True
- Counts: raw=3 · parse-valid=1 · persist-insertable=1 · skipped=['schema_rejected:2']
- Provider JSON: see `live-runs-detailed.jsonl` entry path=OLD_shared_status_on run=3 (`providerText` field).
| source_quote | fact_text | parse_valid | persist_stage | persist_detail | stored | target_events |
|---|---|:---:|:---|:---|:---:|:---|
| 볼프강: 국경 야영지를 지휘하는 중년의 대장. | 볼프강은 국경 야영지를 지휘하는 중년의 대장이다. | False | parse_sanitizer_rejected | — | False | — |
| 과묵하고 규정에 충실하다. | 볼프강은 과묵하고 규정에 충실하다. | False | parse_sanitizer_rejected | — | False | — |
| 둘만 남은 천막 안에서 볼프강은 책상 위의 기록철을 천천히 렌 쪽으로 밀었다. | 렌은 국경 야영지의 지휘 천막 안에서 기록철을 열람했다. | True | insertable | — | False | — |
### Run 4
- Tokens: in=5276 out=691 · cost=$0.000259 · transportOk=True
- Counts: raw=3 · parse-valid=0 · persist-insertable=0 · skipped=['schema_rejected:3']
- Provider JSON: see `live-runs-detailed.jsonl` entry path=OLD_shared_status_on run=4 (`providerText` field).
| source_quote | fact_text | parse_valid | persist_stage | persist_detail | stored | target_events |
|---|---|:---:|:---|:---|:---:|:---|
| 볼프강이 낮게 숨을 내쉬었다. | 볼프강은 국경 야영지를 지휘하는 대장이다. | False | parse_sanitizer_rejected | — | False | — |
| 열람은 허락한다. 단, 이 천막 안에서만이다. 필사는 안 된다. | 볼프강은 렌에게 기록철의 천막 안 열람을 허락했으며 필사는 금지되고 새벽 보초 교대 전 반납해야 한다고 밝혔다. | False | parse_sanitizer_rejected | — | False | — |
| 나는 내 진술을 황실 감찰관에게 전달하는 데 동의하지 않았어. 먼저 기록을 내가 직접 확인하겠어. 누구에게 전달할지는 그다음에 정하겠다. | 렌은 황실 감찰관에게 진술을 전달하는 데 동의하지 않았고 기록 열람 후 전달 대상을 정하기로 했다. | False | parse_sanitizer_rejected | — | False | user_refusal, user_review_first |
### Run 5
- Tokens: in=5276 out=294 · cost=$0.000130 · transportOk=True
- Counts: raw=0 · parse-valid=0 · persist-insertable=0 · skipped=[]
- Provider JSON: see `live-runs-detailed.jsonl` entry path=OLD_shared_status_on run=5 (`providerText` field).
| source_quote | fact_text | parse_valid | persist_stage | persist_detail | stored | target_events |
|---|---|:---:|:---|:---|:---:|:---|
## NEW — Independent episodic-only (post-#1718 path)
### Run 1
- Tokens: in=4590 out=238 · cost=$0.000107 · transportOk=n/a
- Counts: raw=2 · parse-valid=2 · persist-insertable=1 · skipped=['unverified_canonicalization:1']
- Stored rows after real owners: **1**
- Provider JSON: see `live-runs-detailed.jsonl` entry path=NEW_independent_episodic run=1 (`providerText` field).
| source_quote | fact_text | parse_valid | persist_stage | persist_detail | stored | target_events |
|---|---|:---:|:---|:---|:---:|:---|
| 나는 내 진술을 황실 감찰관에게 전달하는 데 동의하지 않았어. | 렌은 자신의 진술을 황실 감찰관에게 전달하는 데 동의하지 않았고, 기록을 직접 확인한 뒤 전달 대상을 정하겠다고 밝혔다. | True | insertable | — | True | user_refusal |
| 본인이 허락하기 전까지는 이 천막 밖으로 한 장도 나가지 않는다. | 볼프강은 렌이 허락하기 전까지 진술을 천막 밖으로 내보내지 말라고 병사에게 지시했다. | True | unverified_canonicalization | unattributed_character_claim | False | — |
### Run 2
- Tokens: in=4590 out=306 · cost=$0.000129 · transportOk=n/a
- Counts: raw=3 · parse-valid=3 · persist-insertable=3 · skipped=[]
- Stored rows after real owners: **3**
- Provider JSON: see `live-runs-detailed.jsonl` entry path=NEW_independent_episodic run=2 (`providerText` field).
| source_quote | fact_text | parse_valid | persist_stage | persist_detail | stored | target_events |
|---|---|:---:|:---|:---|:---:|:---|
| 나는 내 진술을 황실 감찰관에게 전달하는 데 동의하지 않았어. | 렌은 자신의 진술을 황실 감찰관에게 전달하는 데 동의하지 않는다고 밝혔다. | True | insertable | — | True | user_refusal |
| 먼저 기록을 내가 직접 확인하겠어. 누구에게 전달할지는 그다음에 정하겠다. | 렌은 기록을 직접 확인한 뒤 진술을 전달할 대상을 정하겠다고 밝혔다. | True | insertable | — | True | user_review_first |
| 열람은 허락한다. 단, 이 천막 안에서만이다. | 볼프강은 렌이 천막 안에서 기록철을 열람하도록 허락했다. | True | insertable | — | True | — |
### Run 3
- Tokens: in=4590 out=233 · cost=$0.000105 · transportOk=n/a
- Counts: raw=2 · parse-valid=2 · persist-insertable=1 · skipped=['unverified_canonicalization:1']
- Stored rows after real owners: **1**
- Provider JSON: see `live-runs-detailed.jsonl` entry path=NEW_independent_episodic run=3 (`providerText` field).
| source_quote | fact_text | parse_valid | persist_stage | persist_detail | stored | target_events |
|---|---|:---:|:---|:---|:---:|:---|
| 감찰관은 규정대로라면 오늘 밤 안에 기록의 사본을 요구할 권리가 있다. | 볼프강은 규정상 감찰관이 그날 밤 기록의 사본을 요구할 권리가 있다고 렌에게 알렸다. | True | insertable | — | True | — |
| 열람은 허락한다. 단, 이 천막 안에서만이다. 필사는 안 된다. | 볼프강은 렌이 기록철을 천막 안에서만 열람하고 필사하지 않도록 허락했다. | True | unverified_canonicalization | unattributed_character_claim | False | — |
### Run 4
- Tokens: in=4590 out=225 · cost=$0.000103 · transportOk=n/a
- Counts: raw=2 · parse-valid=2 · persist-insertable=2 · skipped=[]
- Stored rows after real owners: **2**
- Provider JSON: see `live-runs-detailed.jsonl` entry path=NEW_independent_episodic run=4 (`providerText` field).
| source_quote | fact_text | parse_valid | persist_stage | persist_detail | stored | target_events |
|---|---|:---:|:---|:---|:---:|:---|
| 나는 내 진술을 황실 감찰관에게 전달하는 데 동의하지 않았어. | 렌은 자신의 진술을 황실 감찰관에게 전달하는 데 동의하지 않았으며, 기록을 직접 확인한 뒤 전달 대상을 정하겠다고 밝혔다. | True | insertable | — | True | user_refusal |
| 이 진술은 감찰관에게 전달하지 마라. | 볼프강은 렌의 허락 전까지 진술을 감찰관에게 전달하지 말라고 병사에게 명령했다. | True | insertable | — | True | wolfgang_forward_ban |
### Run 5
- Tokens: in=4590 out=219 · cost=$0.000101 · transportOk=n/a
- Counts: raw=2 · parse-valid=2 · persist-insertable=2 · skipped=[]
- Stored rows after real owners: **2**
- Provider JSON: see `live-runs-detailed.jsonl` entry path=NEW_independent_episodic run=5 (`providerText` field).
| source_quote | fact_text | parse_valid | persist_stage | persist_detail | stored | target_events |
|---|---|:---:|:---|:---|:---:|:---|
| 나는 내 진술을 황실 감찰관에게 전달하는 데 동의하지 않았어. | 렌은 자신의 진술을 황실 감찰관에게 전달하는 데 동의하지 않았다고 밝혔다. | True | insertable | — | True | user_refusal |
| 먼저 기록을 내가 직접 확인하겠어. 누구에게 전달할지는 그다음에 정하겠다. | 렌은 기록을 먼저 직접 확인한 뒤 진술의 전달 대상을 정하겠다고 밝혔다. | True | insertable | — | True | user_review_first |
## `relationship_ledger_owned` drops (NEW path only)
Filter owner: `detectRelationshipLedgerOwnedFact` in `src/lib/episodicMemoryFacts.ts`. It blocks facts whose **attribute** matches relationship-ledger promise/item patterns, or whose **category** is `relationship`/`item` and text matches item-transfer lexicon.

**Evidence read (no code change):** Both drops use attributes ending in `_transfer` (`consent_to_statement_transfer`, `refused_statement_transfer`), which match `RELATIONSHIP_LEDGER_ITEM_ATTRIBUTE` (`…|transfer|transferred|…`). The blocked content is the USER **refusal to forward the statement**, not a possession/ledger item transfer. The same USER quote was stored in other runs when the model used attributes without `transfer` (e.g. `statement_consent`, `record_review_decision`). This is consistent with **keyword-based owner separation**, but **can misclassify important USER consent/refusal facts** when the model names the attribute with `_transfer`.
## Target event coverage (parse-valid facts with verbatim quote match)
- **OLD** (5 runs): user_refusal=0/5, user_review_first=0/5, wolfgang_forward_ban=0/5
- **NEW** (5 runs): user_refusal=4/5, user_review_first=2/5, wolfgang_forward_ban=1/5
