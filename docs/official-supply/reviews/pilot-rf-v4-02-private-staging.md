# Wolfgang `pilot-rf-v4-02` — private staging evidence

GPT review packet. Official publish, official badge, follower notify, other-character staging, image regen, and design edits were **not** executed.

## Identity

| Fact | Value |
|---|---|
| Production SHA | `de266eb88f63ae9b6c4a3ef6d7e93a897250eb5f` |
| Public health | `gitCommit=de266eb` `gitBranch=main` |
| Railway environment | `production` |
| Draft key | `pilot-rf-v4-02` |
| Character ID | `51` |
| Private page path | `/character/51` |
| Owner | `users.id=108` (`로맨스 공식 스튜디오`, `site_managed=1`) |
| Display creator name | `로맨스 공식계정` |
| Supply stage | `staged_private` |
| `official` | `0` |
| `visibility` | `private` |
| `nsfw` | `1` |
| `participant_min_age` | `34` |
| `world_id` | `null` |
| Text Lock | `6ff02833cfd45a542866aa1afa749486d94362eff5358e10f995b8f77fabd5fd` |
| Appearance Lock | `1c3ccd134203a6dea6ae869c27cc443c42ff5498d1d0130c6f9765407c24dcc3` |

## BEFORE

- Draft `qa_passed`, `staged_character_id=null`, `staging_claim=null`
- No `characters` row named 볼프강 / Wolfgang
- 14 approved images, SHA and lock match
- Shared lorebooks 2–9 already mapped to studio 108
- `buildOfficialCharacterFormBody` + `parseCharacterFormBody` dry-run passed (`visibility=private`, `world_id=null`, 14 assets, rank-1 representative)
- Derived-cache catalog bound: expected **3 KRW**, worst **80 KRW** (`gpt-6-luna` + `gemini-3.1-flash-lite` fallback, 5 translation batches + 1 appearance compile). Below the 1,000 KRW STOP.

## AFTER

- `stageOfficialCharacterPrivately()` once → `{ status: "staged", characterId: 51 }`
- Supply row: `stage=staged_private`, `staged_character_id=51`
- `updateOfficialDisplayCreatorNameAsAdmin()` → `creator_name=로맨스 공식계정`, owner 108 unchanged
- Greeting / public description / Creator Comment match the locked draft
- 8 shared lorebooks attached: 에테르, 태양의 옥좌, 발켄하임 철혈 연맹, 메르카토르 골드 길드, 판도라 학술원, 혹한의 흑철 방벽, 에테르 고갈증, 태양의 눈
- Follower / `user_notifications` after save: **0**
- Home and `/tab/ranking` do not list id 51 or the name 볼프강
- Visitor `/character/51` → login
- Non-owner admin `/character/51` → `열람할 수 없습니다` (private)
- Owner 108 `/character/51` → `/verify` because `canAccessAdultContent` is admin-only

## PRESERVED

- Official publish not run
- Official badge not flipped
- No follower notify
- No other draft staged
- No image bytes rewritten (14/14 SHA match)
- Text Lock / Appearance Lock unchanged
- `world_id=null` (non-compact path)
- Owner 108 unchanged
- Global derived-cache worker settings unchanged
- Secret raw text is not in this packet

## S2 / RP input

Saved `creator_canon_plan_json` → `renderPrivateCharacterSecretBlock` + `buildContext` (provider-free):

| Check | Result |
|---|---|
| LOCKED_SECRET chunks | 15 |
| S2 included | 15 |
| S2 omitted | **0** |
| S2 body chars | 919 / 1200 |
| 8 approved secrets, 12-char prefix in S2 | **8/8** |
| Layered canon active | true |
| S2 injected into assembled RP input | true |
| Public description / tagline / greeting / Creator Comment leak | **0** |
| Shared lorebook leak | **0** |

Exact full-string match is 2/8 because the compiler splits longer secrets into multiple LOCKED_SECRET chunks. The live official-supply test owner uses the same 12-char prefix check.

## Images (14, unchanged)

Public host, no query. Same bytes as the approved production uploads.

| Slot | URL | SHA-256 | Bytes |
|---|---|---|---|
| rep rank 1 | https://hav.chat/uploads/official-pilot-rf-v4-02__rep-a1.webp | `a66c49d4d947209206b70a284c99f2e26ef868934ed5426818042c29ba3a45f1` | 270052 |
| sig1 | https://hav.chat/uploads/official-pilot-rf-v4-02__sig1-a1.webp | `8d9556c42a0e3fb8f92b865d06694490d74fe79a443e41bfedea46cfb834e4fa` | 279968 |
| sig2 | https://hav.chat/uploads/official-pilot-rf-v4-02__sig2-a1.webp | `1cf00ba26720171358e431d359c5dbfe5c1f7a26ad791968b876b38f47506ffb` | 250756 |
| sig3 | https://hav.chat/uploads/official-pilot-rf-v4-02__sig3-a1.webp | `b27ddb13e43fbf7571b29e451b2b613738d0fce81b95521148b9259214f3487b` | 282766 |
| sig4 | https://hav.chat/uploads/official-pilot-rf-v4-02__sig4-a1.webp | `f2906f2f4da8fc7bb59792683e45012840381542a5437e4d6abb72bc7074f28c` | 246374 |
| emo1 | https://hav.chat/uploads/official-pilot-rf-v4-02__emo1-a1.webp | `34d4f183167949d1a0cc1637c94eecbf9f7d09cc5e3e442929aa05a155e43961` | 238268 |
| emo2 | https://hav.chat/uploads/official-pilot-rf-v4-02__emo2-a1.webp | `5ada0963b5dd90cc05e0c496617281758360e1dcb646d0741b25d54f09918d97` | 214956 |
| emo3 | https://hav.chat/uploads/official-pilot-rf-v4-02__emo3-a1.webp | `7c8dfb4cdc65376fc4f11377a6b8606dd092f92c969b979ab8c70044606e31c7` | 298756 |
| emo4 | https://hav.chat/uploads/official-pilot-rf-v4-02__emo4-a1.webp | `4a06d5b8aeee83aa0133b29751d145be50d30f61bd348346b30b312a788a975f` | 270598 |
| emo5 | https://hav.chat/uploads/official-pilot-rf-v4-02__emo5-a1.webp | `b5d6c59bc816c6c1ccfd6404931f578eecadd06cb0514f0f8b578e00c1bc71b6` | 243056 |
| emo6 | https://hav.chat/uploads/official-pilot-rf-v4-02__emo6-a1.webp | `62088dd09ad9a3598419e6e6213c06c0764c57b90001731839ec4d79df478abc` | 338572 |
| scene1 | https://hav.chat/uploads/official-pilot-rf-v4-02__scene1-a1.webp | `1a1c7387a89fc229a196052e3d7eae78642b1083ee9cae5b904d2816a6211b72` | 293178 |
| scene2 | https://hav.chat/uploads/official-pilot-rf-v4-02__scene2-a1.webp | `4e845fda4cf544c8647a0226436acc77ccc6fadfd338d508cef0e08885ebff03` | 333724 |
| scene3 | https://hav.chat/uploads/official-pilot-rf-v4-02__scene3-a1.webp | `45488eb3bf0ba7f66df05c0d20e96acbf9d2b17d33d08210b97cd940fb89f533` | 465684 |

## Derived work / cost

`createCharacterFromForm` enqueued `derived_cache_jobs.id=52` (`character_derived_refresh`). The one-shot staging process also logged one `background-appearance-compile` (`deepseek-v4-flash-0731`).

At review time the job was still `processing` (no `last_error`). `api_cost_ledger` had no rows after `2026-10-11 13:41:00`. Appearance compiled text was still empty. This matches a one-shot SSH process exiting while the in-process worker was running; the production scheduler reclaims stale `processing` leases after 15 minutes. Global worker settings were not changed.

## Blocking problem for live character-page screenshots

No single principal can open `/character/51` under current owners:

1. Visitor → login
2. Owner 108 → `/verify` (`canAccessAdultContent` is existing-admin only; `SKIP_ADULT_VERIFICATION` does not grant view)
3. Admin (ADMIN_EMAILS user 1) → private non-official row is hidden (`canAccessCharacter` does not grant official-admin view)

Admin `/admin/official-characters` **does** show id 51: private, nsfw, display name `로맨스 공식계정`, draft `pilot-rf-v4-02`, stage `staged_private`. That is the live authenticated surface captured below.

The private detail gallery / public intro chrome was **not** opened. Image originals above are the same 14 production files.

Temporary review sessions were deleted after screenshots.

## Screenshots (GitHub originals)

Desktop / mobile pairs. No secret manuscript and no session tokens.

| Surface | Desktop | Mobile |
|---|---|---|
| Visitor `/character/51` → login | [visitor-character-51-desktop.png](./assets/wolfgang-private-staging/visitor-character-51-desktop.png) | [visitor-character-51-mobile.png](./assets/wolfgang-private-staging/visitor-character-51-mobile.png) |
| Owner 108 `/character/51` → adult verify | [owner-character-51-desktop.png](./assets/wolfgang-private-staging/owner-character-51-desktop.png) | [owner-character-51-mobile.png](./assets/wolfgang-private-staging/owner-character-51-mobile.png) |
| Admin `/character/51` → private block | [admin-character-51-desktop.png](./assets/wolfgang-private-staging/admin-character-51-desktop.png) | [admin-character-51-mobile.png](./assets/wolfgang-private-staging/admin-character-51-mobile.png) |
| Admin official list `#51` | [admin-official-characters-desktop.png](./assets/wolfgang-private-staging/admin-official-characters-desktop.png) | [admin-official-characters-mobile.png](./assets/wolfgang-private-staging/admin-official-characters-mobile.png) |

Raw originals (replace after push if the branch SHA moves):

- https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/wolfgang-private-staging-e643/docs/official-supply/reviews/assets/wolfgang-private-staging/visitor-character-51-desktop.png
- https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/wolfgang-private-staging-e643/docs/official-supply/reviews/assets/wolfgang-private-staging/visitor-character-51-mobile.png
- https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/wolfgang-private-staging-e643/docs/official-supply/reviews/assets/wolfgang-private-staging/owner-character-51-desktop.png
- https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/wolfgang-private-staging-e643/docs/official-supply/reviews/assets/wolfgang-private-staging/owner-character-51-mobile.png
- https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/wolfgang-private-staging-e643/docs/official-supply/reviews/assets/wolfgang-private-staging/admin-character-51-desktop.png
- https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/wolfgang-private-staging-e643/docs/official-supply/reviews/assets/wolfgang-private-staging/admin-character-51-mobile.png
- https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/wolfgang-private-staging-e643/docs/official-supply/reviews/assets/wolfgang-private-staging/admin-official-characters-desktop.png
- https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/wolfgang-private-staging-e643/docs/official-supply/reviews/assets/wolfgang-private-staging/admin-official-characters-mobile.png

## REGRESSION RISKS

- Production server must reclaim derived job 52; if it stays `processing` past the 15-minute stale lease, appearance compile / prompt translation will not finish
- `/character/51` cannot be QA'd in-browser until adult-view and private-admin-view owners are aligned (out of scope this step)
- Official publish / badge / notify remain unrun on purpose

## STOP

Private staging verified. Official publish not authorized. Waiting GPT final review.
