# PR #1529 pre-merge correctness verification

Reviewed head before this change: `c5f5f4fb`. main compared against: `34608ea5` (built in a separate worktree, `next build` + `next start` on :3001; PR build on :3000; same seeded local DB, Playwright 390x844 / 1440x900, RSC requests delayed by 2200 ms via `page.route`).

Message identity is checked from the rendered DOM: the seeded sessions carry unique text tags in their assistant message (`[세션A]` = chat 871370, `[세션B]` = chat 871371, `[세션L]` = chat 871372, character 50), and each sample records `location.pathname+search`, `data-chat-room-id` / `data-chat-room-character` (ChatClient root marker) and which tag is rendered.

## 1. Rapid A -> B clicks, chat rooms

Reported symptom: URL points at one room, marker/messages belong to the other.

Matrix (each cell is click order, which room's RSC is delayed, prefetch warm-up = picker opened / `router.prefetch` / none). Same-character rooms (`/chat/13?chat=871370` vs `?chat=871371`), cross-character rooms (`/chat/13?chat=871370` vs `/chat/50?chat=871372`), 390px and 1440px.

| Build | Runs completing a true rapid double click | URL = last click | Marker = last click | Rendered messages = last click |
| --- | --- | --- | --- | --- |
| main (`router.push`) | 17 | 17/17 | 17/17 | 17/17 |
| PR (native `Link`) | 19 | 19/19 | 19/19 | 19/19 |

(Runs where the first navigation finished before the second click could be issued are not a rapid sequence and are excluded.)

Why chat cannot reproduce it: every chat navigation (prefetched or not) issues its own `rsc-nav` request because `/chat/:id` is a dynamic page; Next discards the earlier pending navigation when the later one is issued. Example (PR, cross-character, warm=picker, order B>A, slow=B):

```
requests: prefetch 871371 @1161 | prefetch 871372 (delayed) @2119 | rsc-nav 871370 @2363 | rsc-nav 871372 (delayed) @4328
clicks:   +64ms B(871372, RSC delayed) | +274ms A(871370)
t+276   url=/chats                       veil=cover
t+481   url=/chat/13?chat=871370 marker=871370/13 msgs=[세션A] veil=cover
t+1299  url=/chat/13?chat=871370 marker=871370/13 msgs=[세션A] veil=null
FINAL consistent (the late B response never overwrites A)
```

Same scenario on main: `t+405 url=/chat/13?chat=871370 marker=871370/13 msgs=[세션A]`, consistent.

## 1b. Where the reported mismatch does reproduce: TRPG rooms, on main as well

`/trpg/:id` links in viewport are prefetched on load and the prefetched room resolves from the client router cache without any `rsc-nav` request. If the slower, not-yet-cached room is clicked first and the cached room second, Next applies the slow room's content after the URL already points at the last click. The rendered room (marker and campaign title) is self-consistent; only the URL is wrong. main and PR are identical:

```
PR   order B>A slow=B: prefetch 98,97,96 | rsc-nav 97 @1307 | click B(97) +75ms, A(98) +279ms
     t+2448  url=/trpg/98 marker=97 title=참가자 대기(97) veil=null          -> MISMATCH (URL 98, room 97)
MAIN order B>A slow=B: prefetch 98,97,96 | rsc-nav 97 @1353 | click B(97) +82ms, A(98) +276ms
     t+2449  url=/trpg/98 marker=97 title=참가자 대기(97)                    -> MISMATCH (same)
PR   order A>B slow=A: ...  t+2437 url=/trpg/97 marker=98 title=북부 전선(98) veil=null -> MISMATCH
MAIN order A>B slow=A: ...  t+2397 url=/trpg/97 marker=98 title=북부 전선(98)           -> MISMATCH (same)
```

The same result was also obtained on the PR build with the cinematic markers stripped from the cards, so it is a Next router behavior and not caused by `MenuTransitionHost`. In the PR the host sees a room marker that is not the destination, drops the veil (no stuck veil) and the user lands in exactly the room main shows. This is recorded as a separate BUG follow-up; it is not fixed here (out of scope: no change to navigation owner, TRPG participant/campaign owner).

## 2. Representative image load failure

Image URL exists but returns HTTP 404 (or the request is aborted).

| | BEFORE (c5f5f4fb) | AFTER |
| --- | --- | --- |
| Picker avatar | broken-image icon over the fill colour, `textContent` empty | fill colour + `✨` |
| D-2 start frame | blank purple frame, no glyph | purple frame + `✨` (existing fill/glyph fallback) |
| Navigation | works | works (exact room, no stuck veil) |
| Image loads normally | image shown | unchanged, image shown and used as D-2 source |

Fix is inside `BranchAvatar` only: `onError` (and an effect for an image that already finished loading with `naturalWidth === 0`) records the failed src and renders the emoji instead of the `<img>`. The adult blur class, the private-image rule in the host (`/media/private/` never used as the D-2 source) and the `/verify` redirect are unchanged.

Images: `multi-BEFORE-404-picker-img404.png`, `multi-AFTER-404-picker-img404.png`, `single-BEFORE-404-picker-img404.png`, `single-AFTER-404-picker-img404.png`, `multi-BEFORE-404-d2-click-plus-220-img404.png`, `multi-AFTER-404-d2-click-plus-220-img404.png`.

## Regression after the fix (PR build rebuilt from the new head)

- Production gate 156/156, negative 24/24, rapid 3/3; DB table row counts identical before and after.
- `git diff --check`, `npm run lint`, `npm run typecheck:app` clean; related tests 124/124 (123 previous + 1 new for the avatar fallback).
