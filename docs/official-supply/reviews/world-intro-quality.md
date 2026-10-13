# Official shared world / public intro / creator comment — quality review

Scope: Lucian #50 (`pilot-rf-03`) and Wolfgang #51 (`pilot-rf-02`), shared worldKey `pilot-rf-erendel`.
Status: **candidates only.** Nothing here touches live #50/#51, the shared world DB, or any production data.
Separate from PR #1589 (admin ownership of #51, fast-save permission, read-only lorebook display, official management/publish path, CP isolation).

## 1. BEFORE / PROBLEM

| Item | Lucian (#50) | Wolfgang (#51) |
| --- | --- | --- |
| Final `characters.world` snapshot | 2,156 chars = shared projection | 1,193 chars = bible `worldContext` + `personalSituation` + `userEntry`, `world_id=null` |
| Shared canon actually delivered | projection only | none (legacy path) |
| Public intro | 894 | 1,299 |
| Creator comment | 221 | 291 |

Root causes (owner chain `world-bible.json` → `officialSharedWorld.projectOfficialSharedWorld` → `bible.compileOfficialDraftFromBible` → `characterText` → save → `characters.world` → `characterParser.buildCombinedCharacterSettingSource`):

1. The projection is a lossy summary. It never carries faction leaders, the 5y/3y/1y/6m event sequence, magic rank/limits/taboos in full, society rules, locations, or persona entry roles. Those exist only in the bible, so Lucian's "shared world" is thin.
2. Only `promptStandard: compact_rp_v1` (Lucian) separates `worldAndSituation` (shared) from `currentSituation` (character-local). Wolfgang is on the legacy path, so his "world" is a mix of world + his incident + user guidance. That is why it is short and why it cannot be shared.
3. `characters.world` is a snapshot. World Library `worlds` rows are not read at chat time, so the shared text must be right at save time.
4. The RP injection cap and the save limit disagree. `AI_LEARNING_LIMIT` is 12,000 (raised in 67c0b950) but `buildCombinedCharacterSettingSource` still hard-slices at 10,000. The cut removes the tail, which is the speech block (`[예시 대화]`). A bigger shared world pushes Wolfgang over the cap without any error.
5. Public intro is auto-composed (or authored `detailedDescription`) with little persona-building information. The creator comment is a fixed three-paragraph template, so every official character reads alike and repeats the intro.

## 2. AFTER (candidates in `docs/official-supply/candidates/world-intro-quality/`)

| Candidate file | Chars | Purpose |
| --- | --- | --- |
| `shared-world.txt` | 2,374 | single canonical world, 7 paragraphs: identity/regions, event sequence, four factions with leaders, magic/limits/taboos, society/culture, locations, persona entry roles. No character-local incident, no user forcing. |
| `wolfgang.current-situation.txt` | 681 | Wolfgang's incident + user guidance relocated verbatim from the old world text into `currentSituation` |
| `wolfgang.public-detail.txt` | 1,832 | public intro |
| `wolfgang.creator-comment.html` | 655 | creator comment (p/b/br only) |
| `lucian.public-detail.txt` | 1,583 | public intro |
| `lucian.creator-comment.html` | 607 | creator comment (p/b/br only) |

Verified by `officialSupply.worldIntroCandidate.test.ts` (all pass): world within 2,000–3,000 and `assertOfficialSharedWorldProjection`; no `마석|명령서|인장|금고|경보`, no user address; every faction leader, every dated event and every `allowedRoles` entry present; Lucian's `currentSituation` and secrets untouched; every candidate passes `evaluateOfficialPublicDescription`, `evaluateOfficialCreatorComment`, gender-neutrality gates. Wolfgang's volume is not padded: the extra world volume is shared canon, his incident stays in `currentSituation`.

### Shared-world owner map

| Responsibility | Canonical owner (unchanged) | Note |
| --- | --- | --- |
| Authoring source | `pilot/world-bible.json` | candidate text is meant to replace the projection output, not add a second source |
| Projection / ensure library row | `officialSharedWorld.ts` | band 1,500–2,300 must be widened to ~2,000–3,000 when the candidate is approved |
| Draft compile | `bible.ts` (`compact_rp_v1` splits world and situation) | Wolfgang needs `compact_rp_v1` to share the world |
| Save snapshot | `characterFormSave.ts` → `characters.world` | no change |
| Runtime injection | `characterParser.buildCombinedCharacterSettingSource` | cap is now exported and measurable |

No new helper, flag or parallel world path was added.

## 3. Canon conflict table (bible vs. Wolfgang) — not guessed

| # | Bible (shared world) | Wolfgang (character) | Candidates | Candidate text assumes |
| --- | --- | --- | --- | --- |
| D1 | North led by `알렉세이 폰 발켄하임 대공`, "전장의 늑대" | Wolfgang is `발켄하임 가주 대공`; his unnamed father (former head) lies in a sickbed after stopping a forbidden experiment | A. Alexei is the father; Wolfgang is the successor (father bedridden). B. Rename Alexei to Wolfgang in the bible (breaks the bible leader quote and any lore that cites Alexei). C. Alexei is a regent/uncle (new canon). | A. Shared text says Alexei fell ill and the successor duke leads. Recommend A: no existing text changes. |
| D2 | Epithet "전장의 늑대" for the northern leader | Wolfgang's own text uses "전장의 도살자" and the 늑대공 image tag | A. Wolf = father, butcher = Wolfgang's nickname among enemies. B. Unify both to wolf. | not named in the shared world |
| D3 | Balkenheim monopolizes northern command, stops imperial taxes, openly hostile to the crown | Wolfgang weighs imperial orders against house survival, obeys with documents | A. Hostility is the house's posture; Wolfgang is the cautious one inside it. B. Soften the bible. | shared text keeps "공공연히 적대적" at faction level only |
| D4 | North profits (mines, wealth) | North also loses rations after the Void Night; Wolfgang lost estate and honor | A. North has ore but depends on central refining, so it also suffers (matches Wolfgang). B. Keep "profits" and drop Wolfgang's rationing line. | A. ("정제는 중앙 정제탑에 의존") |

Timeline (5y/3y/1y/6m), magic rank 1성–7성, 에테르 mechanism, the 침식 마법 taboo, and the `의무 결속령` are consistent between the two. Lucian's published world text matches the shared bible; the candidate keeps his facts, so no Lucian canon change is proposed. **If D1/D2/D3/D4 are decided differently, the shared text and the public intro paragraph about the northern house (taxes, rations) need a matching edit before approval.**

## 4. Public intro — comparison with user character #13

`https://hav.chat/character/13` redirects to a login page for this agent, so the real text could not be read. The structural rubric from the task was used instead (world mood and core conflict, protagonist identity and charm, the present dilemma, why the user can step in, existing relationships and branches, a hook, plus job/faction/status/social rules/choices for persona building).

| Rubric element | Before (Wolfgang) | After |
| --- | --- | --- |
| World mood + core conflict | one paragraph, ether depletion only | shared-world north paragraph + the four powers and the 의무 결속령 pressure |
| Protagonist identity/charm | stat block | stat block kept, charm shown in `플레이 포인트` (awkward care through coats, meals, return times) |
| Current dilemma | 2 short paragraphs | `현재 상황` + `플레이 포인트` |
| Why the user can step in | implied | explicit persona roles (noble, 수사청 특무관, mercenary, courier, servant) |
| Existing relationships / branches | one generic paragraph | `관계 포인트` with branches (accomplice, rival, protected, suspect) |
| Hook | closing question | closing question kept |

Creator comment: the existing gate allows only `p/b/br`, which is policy, not a security limit (`sanitizeCreatorCommentHtml` uses a broad DOMPurify allowlist). The candidates stay inside p/b/br, so **no new renderer or security change is needed.** Each comment has character-specific section titles (Wolfgang: 증거를 다루는 법; Lucian: 루시안 읽는 법) and does not repeat the intro. If richer markup (tables, images) is wanted later, that is a security-boundary decision for the owner of `publicProfileText.ts` / the sanitizer and is not proposed here.

Screenshots (local rows copied from the candidates, headless Chrome, 430px):

- `assets/world-intro-quality/lucian-before-full.png`, `lucian-after-full.png`
- `assets/world-intro-quality/wolfgang-before-full.png`, `wolfgang-after-full.png`

## 5. Save and final RP injection verification

| Draft | system_prompt | `[예시 대화]` | combined (after cap) |
| --- | --- | --- | --- |
| Lucian (current) | 4,151 | 2,020 | 8,369, no overflow |
| Wolfgang (current) | 5,445 | 1,928 | 8,608, no overflow |

With the candidate world (2,374) plus Wolfgang on `compact_rp_v1`, Wolfgang's source exceeds the 10,000 cap. At the last measurement the overflow was 269 with the current projection and about 464 with the candidate world, which silently deletes the speech block. Lucian stays at 0 overflow with the candidate world.

Fix shipped (guardrail only): `characterText.officialRpSettingOverflowChars` plus an advisory `rp_setting_truncated` warning in `evaluateOfficialStagedSaveLength`. It is a warning, not an error, so approved historical locks such as `pilot-rf-v4-02-locked-2026-09-27.json` (overflow 611) still reconcile. `characterParser` now exports `CHARACTER_SETTING_SOURCE_CHAR_CAP` and `characterSettingSourceOverflowChars`; behavior of `buildCombinedCharacterSettingSource` is unchanged.

Decision needed (not made here):

- A. Raise the parser cap to 12,000 so it matches the save limit. Largest effect: it changes RP prompt size for every character, including user characters, so it needs a cost/regression review.
- B. Keep 10,000 and trim Wolfgang. Test-verified trim that fits: drop `일상:` and `취미:` lines, `progression[3]` and the `장기 변화:` line. Secrets and lorebooks stay.
- C. Make `[예시 대화]` come before the world so the cut hits lore, not speech.

Storage/tokens: the shared text is stored once per character snapshot (about +1.2k chars each for Wolfgang). There is no per-character duplicate of the shared explanation after the move.

## 6. Speech investigation (findings and candidates only)

Original bible `speech` → `speech_personality/traits/examples/forbidden` fields → `composeExampleDialog` → `[예시 대화]` in the RP prompt. The derived `speech_profile` (`speechMetadataPolicy`) is metadata and is not injected into the final prompt.

- `extractRegisterLabel` cuts register text at 72 chars (`…`) and `creator_notes` at 240; Wolfgang's long situational register sentence is truncated and a canonical label scan can pick a wrong `반말`.
- Wolfgang's source says formal 존댓말 in official interrogation/operations, short 반말 with subordinates/old comrades. A derivation that only keeps a label turns that into one register, which contradicts the source; a global "no register mixing in one turn" rule then removes the situational switching.
- Candidate fix (separate PR): store the situation→register pairs (`공식 심문 → 존댓말`, `부하·동료 → 반말`, `친밀 → 짧은 반말, 존댓말은 심문 틀에서만`) as `context → register` lines which `extractContextRegisterPairs` already understands, and scope the no-mixing rule to "within one utterance".

## 7. Image tag investigation (candidates only)

- Wolfgang has 14 slots (rep, sig1–4, emo1–6, scene1–3). The model sees only a bare JSON list of tag strings; matching is exact and the fallback is the first tag; max tag length is `CREATOR_ASSET_TAG_MAX` = 32.
- Abstract titles (`기록의 모순`, `뜻밖의 동요`, `증거 앞의 판단`) can be emitted as `[태그: …]` but give the model no cue about when the picture fits.
- Candidate tags (concrete state or scene; not applied, no image regeneration): `기록의 모순 → 문서 대조·의심`, `분노의 억제 → 분노 참음`, `증거 앞의 판단 → 증거 확인·판단`, `뜻밖의 동요 → 당황·굳음`, `경계의 완화 → 경계 풀림`, `귀환의 안도 → 안도`, `절제된 온기 → 식사·배려`, `봉인고의 열쇠 → 봉인고 조사`.
- Feasibility: tag text is an editable field on the existing fast-save path (PR #1589 area), so this needs no generation spend.

## 8. Personality-grounded adult dynamics (candidates only; no server adult-mode/safety change)

Wolfgang's `adultSection` already ties intimacy to control and restraint. Concrete scene candidates built from his traits (not copied from other characters):

1. Pulse check as intimacy: he removes his gloves to read the partner's pulse and temperature, speaks in shorter orders as it rises, and asks about wounds and the next return time afterwards.
2. Jealousy as interrogation: if the partner is close to someone else he does not punish; he re-asks about loyalty in clipped questions, then freezes when answered kindly.
3. Responsibility disguised as possession: after the user chooses to stay, he locks the door and checks whether the user really chooses it, withdrawing instantly and without blame on a stop signal (matches `consentBehavior`).

These can go into the existing `adultSection` fields (`tone`, `scenarioExamples`) without touching `adultDialogueProfile`/consent modes.

## 9. Owner changes and remnants

Changed owners (one responsibility each):

- `characterParser.ts`: cap exported, `characterSettingSourceOverflowChars` added (no behavior change).
- `characterText.ts`: `officialRpSettingOverflowChars` plus advisory warning.
- New test `officialSupply.worldIntroCandidate.test.ts`.

Not changed (follow-ups, KEEP until the user approves): `officialSharedWorld.ts` band and projection, `world-bible.json`, Wolfgang's `promptStandard`, `publicProfile` fields. Nothing deleted: removing the old projection fields and Wolfgang's legacy `worldContext` is safe only after approval and a writer/reader check, so it is listed as FOLLOW-UP.

## 10. Tests

- `node --conditions=react-server --import tsx --import ./src/lib/test/regularTestEgressPolicy.ts --test src/lib/officialSupply/*.test.ts`: 460 pass, 0 fail.
- `git diff --check`, `npm run lint`, `npm run typecheck:app`: clean.

## 11. Regression risks

- The overflow warning is advisory; it will not block a save that loses its speech tail. Promoting it to an error needs a decision on the cap (section 5).
- Applying the candidate world to Lucian is safe by test, but needs a new approved Text Lock and a sync through the existing in-place sync owner.
- D1–D4 decisions change the shared text.

## 12. Follow-up list

Assets (tags), speech derivation, adult dynamics (sections 6–8), cap decision (section 5), widen the projection band and migrate Wolfgang to `compact_rp_v1` after approval.
