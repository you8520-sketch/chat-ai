# G11-C3A — Owner forensic map + semantic pressure

## Owner parity (text/hash, not labels)

| Owner | Historical #255 | Current C1 Arm A | Text/hash | Position |
|---|---|---|---|---|
| CANON / scope / knowledge | present (char 18 heavy; ~52% input tokens) | present (B/D/F fixtures; smaller) | fixture content DIFFERENT | system |
| COLLABORATIVE_INTERACTIVE | 1 | 1 | **BYTE_IDENTICAL** sha256 `b8325c8b…` | system |
| CURRENT_USER wrapper (legacy) | module BYTE_IDENTICAL; lock gate default OFF | LEGACY wrapper in assembled B/D/F | **BYTE_IDENTICAL** module | user head |
| INTERACTIVE_OWNERSHIP_LOCK | same module; gate OFF unless user canary | absent in Arm A assemblies (userId=4) | N/A (off both typical) | — |
| IMMERSIVE PROSE | 1 | 1 | **BYTE_IDENTICAL** sha256 `79e9a385…` | system |
| SCENE FLOW | 1 (same constant @ 3af5ec5) | 1 | **BYTE_IDENTICAL** sha256 `3f5dcce4…` | system |
| SCENE PACING (experimental) | module absent | module present; **Arm A injects 0** | N/A | — |
| D3 dialogue budget terminal | 0 | 0 on Arm A | N/A | — |
| L1 combined `[이번 응답]` | 0 | 0 | N/A | — |
| P1 LONGFORM prose | 0 | 0 | N/A | — |
| USER_TAIL_LENGTH_OWNER | 1 | 1 | **BYTE_IDENTICAL** sha256 `122fece4…` | **absolute terminal** user |
| EXAMPLE DIALOG STYLE ONLY | present on std path | present | SAME class | system |
| NO FALSE SHARED MEMORY | UNKNOWN in hist dump | absent in B/D/F assemblies | UNKNOWN | — |
| Full assembled prompt | UNKNOWN (not persisted) | B≈7694 / D≈7720 / F≈7813 chars | UNKNOWN vs hist | — |

## Collaborative owner (no edit)

Current body matches historical constant. No added response-point / future-decision / handoff sentences beyond the frozen collaborative block. Co-narration remains the same conservative collaborative text.

## Current user wrapper

Legacy interactive wording (assembled):

> Do not continue writing the user's future actions, dialogue, thoughts, or decisions.

This **preserves agency** and also creates **handoff semantics** (do not continue user; leave space). It does **not** literally say “stop once the AI has answered,” but can bias early return. Module is BYTE_IDENTICAL vs #255 — **not a new current-only injection**.

## Length owner parity

- `USER_TAIL_LENGTH_OWNER_SENTENCE`: **BYTE_IDENTICAL**
- Placement current Arm A: absolute terminal after layout
- D3 dialogue budget: **absent** on Arm A

## Semantic pressure (CURRENT assembled; evaluator-only)

Same counts on B/D/F:

| Family | Raw clause hits | Weight |
|---|---|---|
| USER_HANDOFF_PRESSURE | 2 | MODERATE |
| SCENE_CLOSURE_PRESSURE | 3 | HIGH |
| COMPRESSION_PRESSURE | 4 | MODERATE |
| EXPANSION_SPACE | 5 | HIGH |

Compression hits include IMMERSIVE PROSE (“평범한 이동·생활 동작은 압축한다”, “모든 움직임을 순서대로 기록하지 않는다”) — present historically with same text. Therefore pressure explains a **shared early-stop mechanism**, not a **new delta** vs #255.
