# Adult OFF — permission, SAFE wire, output path

**Scope:** Adult mode OFF must block adult-RP entry and keep the existing 15+ romance contract (light kiss, hug, hand-holding, flutter). This note does not claim full bypass-proofing, and it does not change adult-ON or CNC policy.

**No code change. No paid POST in this step.** Conservative pre-estimate for 8 live samples exceeded the 1,000 KRW ceiling (prior ~62 KRW included), so model originals were not generated.

## Pins

| Item | Value |
| --- | --- |
| GitHub `main` | `460adb6dde355220f659b0f9c85aeb33cc49d4c2` |
| Production `/api/health` `gitCommit` | `460adb6` |
| Health `skipAdultVerification` | `true` (diagnostic only; does not grant adult chat) |

## 1. Server permission (isolated DB + live handlers)

Temp DB under `/tmp/habby-test-db-*`. Provider `fetch` stubbed (HTTP 599). Production DB writes: 0.

Accounts: plain (`is_adult=0`, `is_admin=0`), legacy stored adult (`is_adult=1`, `is_admin=0`), admin (`is_admin=1`).

| Call | Result |
| --- | --- |
| Plain or legacy: `adultHandoffEnabled: true` on send, regenerate, or continue | **403** `성인모드는 성인인증 후 이용할 수 있습니다.` Provider calls **0** |
| Settings PATCH `adultHandoffEnabled: true` for plain or legacy | **403** |
| Plain or legacy: DB `adult_handoff_enabled=1` and `mode=nsfw`, plus OOC/user-note adult claim and client `isAdultMode`/`nsfw` | Handler **continues**. Outgoing OpenRouter body for `google/gemini-4-argon`: **SAFE present, `[ADULT CONTENT POLICY]` absent, `[19+ INTIMACY]` absent** |
| Admin + requested adult ON | Same model body: **adult policy and `[19+ INTIMACY]` present, SAFE absent** |

Send, regenerate, and continue share `POST /api/chat`. Settings uses the same `canAccessAdultContent` gate. `isAdultVerificationSkipped()` is not consulted by that gate. Stored `is_adult=1` does not verify chat access.

The unverified room row can remain `adult_handoff_enabled=1` / `mode=nsfw` in SQLite. Prompt authority is `resolveEffectiveAdultRp` after `resolveRoomAdultModeEnabled`, which forces room adult **off** when `userAdultVerified` is false.

## 2. Adult OFF final wire (production snapshot, no prompt text published)

Read-only snapshot: character **18**, persona **1**, greeting SHA `29e3149289586f303c3ffc120a299184163b162a78e46e4f264e87231f6d1d58`. In-memory user note claimed adult RP. `nsfw` / `adultModeEnabled` false. All four Main RP models, two scenes (agreed short kiss; non-sexual limit of an escalation ask).

Every sealed body: SAFE **yes**, adult policy **no**, intimacy block **no**.

Fingerprints: `FINGERPRINTS.json`.

Creator text stays inside the character blocks; it does not replace the SAFE contract. Private character, persona, and system text are not in this folder.

## 3. Delivery path if the model ignores SAFE

There is **no** independent sexual-content classifier on the way to the user.

- SSE deltas are the provider stream (partial saver can write that text while the turn is open).
- Final save runs length, leakage, emotion-tag, and degeneration checks. None of those are a 15+ sexual gate.
- HTTP 200 + `stop` + length is **not** a safety pass.
- Message API returns stored `content` via `resolveActiveVariantContent` (no sexual strip).
- Reconnect reads that stored row.

Provider refusal and site judgment are different. This experiment did not treat a prompt contract as bypass prevention.

Synthetic handler proof used a stubbed 599, so no violating prose was stored (`partialSaveCount` 0, `finalized` false on that failure). That does not show a safety filter.

## 4. 15+ quality samples

Not run. Conservative estimate (4,000 completion tokens, fx ~1,366 KRW/USD):

| Batch | Estimate |
| --- | --- |
| 4 models × romance | ~635 KRW |
| 4 models × limit scene | ~636 KRW |
| Prior Argon CNC | ~62 KRW |
| **Combined** | **~1,333 KRW** |

Ceiling is 1,000 KRW, so **paid calls are held**. Existing SAFE text already allows light kiss, hug, hand-holding, flirting, and emotional tension. No new ban sentence was added.

## 5. What this does not prove

- Eight successful samples would not prove the model cannot be jailbroken.
- No output filter means a compliant prompt can still be followed by non-compliant prose that the site will store and show.
