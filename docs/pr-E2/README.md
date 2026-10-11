# PR E-2 evidence — mobile `/chats` cinematic entry

Local production build (`next build` + `next start`), seeded local DB clone, Playwright 390x844 / 1440x900.
Raw base: `https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/mobile-chats-cinematic-entry-78cc/docs/pr-E2/`

Capture timing notes: stills are one fresh click per frame (`click+Nms` from the click, or `reveal+Nms` from the moment the veil enters `data-phase="reveal"`). Headless screenshot latency adds a few tens of ms to each frame.

## 390px — chat list / picker

| File | BEFORE/AFTER | Timing | Scene |
| --- | --- | --- | --- |
| `m390-01-list-BEFORE.png` / `m390-01-list-AFTER.png` | AUDIT ONLY (identical, same sha256) | load | `/chats` list, unchanged |
| `m390-multi-02-picker-multi-BEFORE.png` | BEFORE | picker open | Multi-room picker: text rows, no avatar |
| `m390-02-picker-multi-AFTER.png` | AFTER | picker open | Multi-room picker: each row is a link with the character avatar circle |
| `m390-single-02-picker-single-BEFORE.png` | BEFORE | picker open | Single-room picker: button "이어서 대화", no avatar |
| `m390-single-02-picker-single-AFTER.png` | AFTER | picker open | Single-room picker: "이어서 대화" is a link with the avatar circle |

## 390px — D-2 (chat) entrance from the picker

| File | Timing | Scene |
| --- | --- | --- |
| `m390-multi-03-click-BEFORE.png` | BEFORE, click+40ms | Plain list, no entrance (the old picker hard-pushed the router) |
| `m390-multi-03-click-AFTER.png` | AFTER, click+40ms | Ink starts at the picked room's avatar circle over the list |
| `m390-multi-04-name-forming-AFTER.png` | AFTER, click+240ms | Avatar circle expanding |
| `m390-multi-05-name-AFTER.png` | AFTER, reveal+60ms | Portrait and name (`강이현`, RESUME) fully formed, before the split |
| `m390-multi-06-split-AFTER.png` | AFTER, click+500ms | Asymmetric split opening; the real chat room is visible, list is not |
| `m390-multi-07-room-AFTER.png` / `m390-multi-07-room-BEFORE.png` | settled | The exact chat room (`/chat/13?chat=871370`) |
| `m390-single-05-name-AFTER.png` | AFTER, click+400ms | Single-room picker entrance |
| `m390-single-07-room-AFTER.png` / `m390-single-07-room-BEFORE.png` | settled | The exact single chat room |

## 390px — D-3 (TRPG) entrance from the D20 card

| File | Timing | Scene |
| --- | --- | --- |
| `m390-01-trpg-list-BEFORE.png` / `m390-01-trpg-list-AFTER.png` | load | TRPG D20 cards (now a single link each) |
| `m390-03-trpg-click-BEFORE.png` | BEFORE, click+40ms | Already the campaign room (hard cut, no entrance) |
| `m390-trpg-03-click-AFTER.png` | AFTER, click+40ms | Veil over the list, ink starting at the D20 glyph |
| `m390-trpg-04-crest-AFTER.png` | AFTER, click+240ms | Crest forming at the D20 glyph |
| `m390-trpg-05-title-AFTER.png` | AFTER, reveal+20ms | Crest and campaign title (`북부 전선`) before the split |
| `m390-trpg-06-split-AFTER.png` | AFTER, reveal+130ms | Asymmetric split opening onto the real campaign room |
| `m390-trpg-07-room-AFTER.png` / `m390-07-trpg-room-BEFORE.png` | settled | The exact campaign room (`/trpg/98`) |

## 1440px

| File | Scene |
| --- | --- |
| `pc1440-01-list-BEFORE.png` / `pc1440-01-list-AFTER.png` | AUDIT ONLY: existing list, identical (same sha256) |
| `pc1440-02-picker-AFTER.png` | Picker with avatar circles |
| `pc1440-05-name-AFTER.png`, `pc1440-07-room-AFTER.png` | Entrance then exact chat room |

## Regression gate (local production, 156 flow checks + 24 negative checks + 3 rapid checks)

- 360x800, 390x844, 1440x900; fast and +2500ms delayed RSC; chat multi / chat single / TRPG active / setup / waiting.
- Per flow: veil shown, arrives at exact room, 0 list frames after split, 0 no-room frames after split, no veil gap, only the chosen room mounted.
- Negative: photo click -> profile, rename, delete request, close, selection mode, adult hidden -> `/verify`, no-image fallback, Ctrl/Shift/middle click, keyboard Enter, back button, TRPG abort / 500 / 404 (veil never sticks), reduced-motion chat and TRPG.
- Rapid A -> B -> C (cold RSC +2200ms) lands only on C, 0 list frames after split, no veil gap.
- Fresh chat from the picker ("처음부터"): 0 veil frames.
- DB row counts of every table identical before and after the full gate run (no rooms, rounds, messages, ledger rows created by the animation).
