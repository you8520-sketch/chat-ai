# Official character editorial standard (2026-10-13)

Single standard for official Ethernos characters. Tracking issue: #1593. This replaces the earlier GPT-only-authorship standard; there is no second standard document and no second compiler.

## Responsibility and approval
- **Authorship.** Cloud Agents may author bible and manuscript candidates. GPT and the user review the actual source text, the saved public page and the final RP wire. Cursor does not give literary or market-fit scores; "tests pass" is not a quality verdict.
- **Engineering owner (Cursor).** Dataflow audit, compiling approved text at the existing canonical owners, deterministic regression, preservation of validated content, and sanitized evidence in a Draft PR.
- **Gates.** User canon decisions, applying anything to production (#50/#51, shared DB, Text Lock replacement), paid model calls, public release and follower notification are separate approval gates. A new Text Lock is created only after the new manuscript is approved. Merge only after GPT re-review.
- **Scope.** Ownership, asset storage, lorebook editing and CP/economy (#1589) are not part of manuscript PRs.

## Canonical owners (one responsibility = one owner)
| Responsibility | Owner |
| --- | --- |
| Shared world canon (era, geography, factions, history, society, magic, culture, conflicts) | `pilot/world-bible.json` -> `projectOfficialSharedWorld` (`officialSharedWorld.ts`) |
| World Library row (`worlds`, `characters.world_id`) | `ensureOfficialSharedWorldLibraryRow` / `findOfficialSharedWorldLibraryRow` |
| Per-character incident and user entry | `sections.currentSituation` via `composeOfficialCurrentSituation` |
| Character body, relationships, secrets, speech | `bible.ts` `compileOfficialDraftFromBible` |
| How the user's relationship starts (FREE / ROLE_BOUND / RELATIONSHIP_BOUND), author wording, compiled lines, deterministic QA | `userRelationStart.ts` (compiled and validated through `bible.ts`) |
| Character self-drive (goal, own move, cost) and the no-common-directive rule | `bible.ts` `rpEngine.selfDrive`, `evaluateRelationBibleContract` |
| Public intro and creator comment | `publicProfileText.ts` (authored `publicProfile.detailedDescription` / `creatorComment`, gated by `evaluateOfficialPublicDescription` / `evaluateOfficialCreatorComment`) |
| Save-length and RP-setting limits | `characterText.ts` (`evaluateOfficialStagedSaveLength`, `officialRpSettingOverflowChars`) over `CHARACTER_SETTING_SOURCE_LIMIT` |
| Text Lock | `computeTextLockHash` (covers the creator comment) |

## Must pass
1. **One shared world.** Lucian and Wolfgang compile the identical world body from the single bible (`worldKey` `pilot-rf-erendel`), roughly 2,000-3,000 Korean characters, attached to one World Library row. A character never edits the common canon. Source, projection, compiled draft, saved snapshot, World Library row and RP wire must be byte-equal for the world body.
2. **Responsibility split.** The world holds era, factions, rules, history only. Personal incidents, the current scene and user-entry guidance live in `currentSituation`. The world body never addresses the user (`당신|유저|플레이어`). The world is injected exactly once.
3. **Canon consistency.** A cross-check across bible, characters, intro and comment is required before review. Adopted Valkenheim canon:
   - Alexei von Valkenheim is the bedridden former duke (전대공); his epithet is '전장의 늑대'.
   - Wolfgang is the current head of the house and commander of the northern wall; '전장의 도살자' is what his enemies call him.
   - Hostility toward the Empire is the house's political stance; careful execution of orders is Wolfgang's personal judgment.
   - The north owns the mines but depends on central refining and suffers ration shortage.
   Do not invent people or events; a conflict that cannot be resolved from existing canon stops for a user decision.
4. **Public intro.** `draft.description` (at most 3,000 characters) shows the world mood, the live conflict, why the character attracts, and realistic entry points for the user's persona. It is not the 2,000-3,000 character world dump and not the 200-500 character discovery pitch. No user play guide inside the shared world. Two characters must not share the same stock recommended-role sentence.
5. **Creator comment.** Supported HTML only (no renderer/security change). It shows the current situation and a recommended play direction. It does not repeat the intro, does not list possible relationships or endings, carries no internal production wording (prompt, runtime, candidate, Text Lock), and is not a copy of the detailed intro.
6. **Character body.** Behavior-driven personality, causal backstory, motives, habits, ability limits and costs, real speech. The shared chat runtime already owns persona priority and player agency, so the character sheet does not restate them. No forced time-based romance; zero secrets and zero NPCs are valid; do not auto-fill the cast.
7. **Speech.** Source -> saved form -> derived `speech_profile` -> final prompt must agree (for example Wolfgang's formal interrogation register and short informal lines to subordinates must survive derivation).
8. **Adult personality.** Per-character adult relationship tendencies are expressed as dynamics, preferences and situational reactions, not repeated adjectives or copied between characters. The existing adult mode, verification and safety owners are untouched.
9. **Assets.** One representative plus the remaining slots match the stored tag, expression, action and background one to one; the chat `[태그: ...]` must hit the stored tag exactly. Assets are never regenerated by manuscript work. New non-representative assets default to `viewerBlur=true`.
10. **RP setting integrity.** Nothing the author wrote may be cut from the final RP wire. `buildCombinedCharacterSettingSource` caps at `CHARACTER_SETTING_SOURCE_LIMIT` (the canonical 12,000-character learning limit plus speech fields plus wrapper reserve), so any text that can be saved is delivered whole. A new official manuscript whose RP setting would be cut fails QA (`rp_setting_truncated`); it is never "fixed" by dropping daily life/hobbies/relationship-change sections or by swapping which section is truncated. Approved locked snapshots keep the reconcile path.
11. **Honesty and versioning.** Proposals not in existing canon (for example a numeric weight) are marked NEW EDITORIAL PROPOSAL until approved. Keep the old text for diff; no silent retroactive canon rewrite.

12. **Design checklist and start types (bible V2).** The author reviews 19 common design items (world excluded; the world stays in the shared World Library) before writing. The list is a design aid in `OFFICIAL_DESIGN_CHECKLIST_LINES`, not 19 output fields; every item already has an owner field, and only the true gaps were added.
    - Owner map: basic spec/appearance -> `identity`/`appearance`; current status/situation/living -> `situation`, `dailyLife`; personality and judgment -> `personality`; desire/goal/lack -> `values.desires`, `selfDrive.goal`; values/taboo -> `values`; formative past -> `backstory`; contradiction/mask -> `contradiction`; weakness/fear/defense/breaking condition -> `values.fears`; speech/address -> `speech`; habits and non-verbal tics -> `habits`; abilities/limits -> `abilities`; hobbies/daily -> `habits`, `dailyLife`; secrets, supporting characters, romance/adult -> existing conditional sections; self-driven action -> `rpEngine.selfDrive`. `userRelationship.initialView` / `progression` and `rpEngine.mediumConflict` / `longTermChange` are optional author notes. They are not required, and they are not copied into the RP wire.
    - Start types: FREE (default), ROLE_BOUND (only the role or background the incident needs), RELATIONSHIP_BOUND (only the relationship or shared past the incident needs). The wire emits that concrete fact once, as `사건 전제` or `고정된 관계`, and nothing else about the user. User gender, feelings, choices and endings stay out of the sheet. Legacy bibles with no `type` compile the same way: no user-relation essay.
    - Self-drive: `goal`, `ownMove`, `setback` are character-driven and must stand without the user. A clause already present in the character core or the current situation is not repeated. Do not fill length with warming/retreating formulas or lists of possible endings.
    - Common RP directives (output length, memory, auto-progression, per-turn monologue) belong to the shared prompt; `bible_common_directive` rejects them inside the character setting.

## Public surfaces (existing limits, unchanged)
- **Tagline:** at most 50 characters, a character-specific question or conflict, no guaranteed future love, no immutable user identity.
- **Greeting:** a natural single opening scene, roughly 1,350-1,650 characters, inside the 2,000-character storage ceiling. A quality target, not a new runtime limit.
- **Player agency:** any gender or persona can inhabit the opening; the player's identity, actions, feelings and prior bonds are never fabricated.

## Evidence required in a PR
Before/after original text, owner map, canon table, actual saved page and creator-comment render (before/after screenshots with openable original URLs), final RP prompt comparison and zero-truncation measurement, token/cost impact, regression results, and the remaining STOP/FOLLOW-UP list. Protected until approval: production #50/#51, the 14 images, Appearance Lock, the 8 shared lorebooks and approved Text Locks.
