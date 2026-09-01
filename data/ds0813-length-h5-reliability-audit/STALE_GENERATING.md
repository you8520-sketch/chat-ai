# 11. Stale generating audit — chat 739 / assistant 3796

No provider calls. No source change.

## Helper

`RECOVERY_HELPER_EXISTS=true`

`recoverStaleInFlightAssistantMessages()` in `src/lib/streamingPersistence.ts`:

- walks assistant rows with in-flight `generation_status`
- tries `restoreAssistantFromAlternatesOnFailedRegen`
- else `markAssistantInterrupted` (empty content → `failed_partial`)

## Production load callers

`STALE_GENERATING_PRODUCTION_CALLERS`:

- `src/app/chat/[id]/page.tsx` — SSR initial chat load only

Does **not** call the helper:

- `src/app/api/chat/messages/route.ts` (pagination / ChatClient “load more”)
- `src/app/api/chat/message/route.ts` (single assistant GET)
- `src/app/chat/[id]/ChatClient.tsx` refresh via `/api/chat/messages`

## Chat 739

`CHAT_739_SHOULD_HAVE_BEEN_RECOVERED=true` **if** `/chat/739` had been opened through the Next.js SSR page after the Railway instance replacement.

`WHY_NOT_RECOVERED`:

- H5 A created chat 739 + assistant 3796 via `POST /api/chat`, then Railway replaced the instance.
- The H5 audit never opened `/chat/739` through SSR after cutover.
- Recovery only runs on SSR page load, so the placeholder stayed `generation_status=generating` + empty content + billing 0.
- Confirmed still stale on 2026-08-22 via read-only `GET /api/chat/message?messageId=3796` (this path does not recover). Frozen at `h5-c/message-3796-stale-generating.json`.

This audit did **not** open `/chat/739` SSR, because that would mutate production state.

Desired eventual contract (design only, not implemented):

- server/interruption + empty generating placeholder + no billing
- subsequent chat load marks retryable failed/interrupted
- never auto-call provider
- never double-bill
