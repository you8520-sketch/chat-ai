# G5-1B — why the modern comedy manuscript drifted into document / authority / responsibility RP

Scope: investigate the **박수진** outcome only. No new comedy generation, no speculative prompt edits, no new QA scorer. Facts vs hypotheses are separated.

GPT literary score for 박수진: **5.8/10** (comment `6472189151`). Pattern overlap with G3 로언 / G4 가브리엘: records, authority limits, self-disclosed fault, user co-decision.

## Confirmed facts (from saved raw + code)

1. **Authoring axes were present in the final Voice prompt.** Call `11-…character_bible_voice.prompt.json` contains `유머 비중: 핵심…`, `전개 비중: 대사 중심…`, and `문체: 경쾌하게…`. `humor=central` / `pacing=dialogue` were not dropped before Voice.

2. **The conflict type was already fixed at the portfolio brief, before Part1/Voice.** Saved `brief.json`:
   - occupation = `해원시 생활권 조정실 현장 조정 담당`
   - rpHook / oneLineConflict = temporary passage marker, civil complaints, temporary agreement, self-disclosed marker move
   - speechDirection already ends with “중요한 대목에서는 농담을 멈추고 누가 어떤 불편과 부담을 지는지 분명히 말한다.”
   Part1 user (`10-…character_bible_1.prompt.json`) pastes that brief verbatim. Voice can only dress an already-administrative conflict.

3. **The world premise was already an administrative negotiation stage.** `world-bible.json` centralPremise: 재개발·생활 규칙 변화 속에서 “조정”하고 “웃음과 협상”으로 조건을 다시 만든다. Biggest event = 생활권 재편안, 부서·보상 절차 분리. Character occupation follows the world, not a roommate/neighbor slice of daily life.

4. **`castIntent` asked for 이웃·동료·룸메이트; the model did not deliver that occupation.** Intent string is in `authoring-plan.json` and in portfolio user prompt call `03`. Output chose a municipal field coordinator. Gate accepted it on the first try (`brief-gate.json`: `world_portfolio` errors `[]`).

5. **PRIMARY market signals were not comedy-specific.** Call `03` PRIMARY list: `kr-07` (fantasy stats/dice RP), `kr-08` (shared multi-character world), plus mid fantasy/wuxia/apocalypse/sports. A `현대/일상` signal appears only under SUPPORTING (`global-08` angst family drama). `excludeRomanceLedSignals: true` removed romance-led rows but left fantasy-top domestic signals as PRIMARY. Proven picks on the brief: `kr-08`, `kr-07`.

6. **G3/G4 cast text was not pasted into the comedy portfolio or Part1 prompts.** `로언` / `가브리엘` / `레온` / `이든` do not appear in call `03` or `10` user text. Cast-context briefs were available to `evaluateBriefCastFit` for the gate, but that gate did not reject. Overlap checks did not treat “서류·권한·책임” as a forbidden shared play pattern.

7. **Humor line itself caps comedy.** `HUMOR_LINES.central` ends with “단 농담이 인물의 목표·약점·대가를 대신하지 않는다.” Combined with light-tone “목표와 대가는 실제로 있어야 한다” and the brief’s “농담을 멈추고…”, the accepted Voice opening uses one joke then “농담은 여기까지.”

8. **Profile was `genre_neutral`, not a modern-comedy-specific world/character profile.** `authoring-plan.json` → `profileKey: "genre_neutral"`. 18 non-rofan genres share that fallback (GPT review already noted).

9. **Cross-check after horror live run (not a comedy rewrite):** `문재호` (`g5-horror-dry`) also centers 판정·기록·허가·폐기 절차·면허 — another document/authority/responsibility skeleton, different genre/tone. That strengthens the claim that the pattern is not a Voice-only comedy failure.

## Hypotheses (not proven; do not patch from these alone)

- **H1.** Non-magic worlds fill `powerSystem` / situation with bureaucratic influence (권한·기록·절차), and portfolio then picks the official who operates those levers.
- **H2.** Relationship-first market-fit language (`oneLineConflict must state who the character is to the user and the conflict`) rewards premise structures that look like G3/G4 even when romance is excluded. Horror’s first brief (`박도윤`) was rejected for that gate and replaced with `문재호`.
- **H3.** Without a comedy-primary market signal and without a modern-daily world template, `genre_neutral` + “real stakes” instructions converge on civic negotiation as the default “serious enough” daily conflict.
- **H4.** Cast-diversity feedback as implemented cannot catch play-pattern clones that differ in name/occupation/trope wording; that is a policy gap, not evidence that G3/G4 text was copied into the comedy prompts.

## What this is not

- Not a missing `humor=central` / `pacing=dialogue` injection at Voice.
- Not a Text Lock or raw-response loss.
- Not proof that any single prompt sentence is the root cause — GPT asked not to assert that yet.

## Follow-ups (out of G5-1B MUST FIX; for GPT / G5-2+)

Record only — no code change in this pass:
- Genre-conditioned market-signal priority (comedy/daily PRIMARY, not leftover fantasy tops).
- Stronger planning check that `castIntent` occupation class (roommate/neighbor vs municipal officer) actually lands, or one replan when it does not.
- Play-pattern overlap (records / authority limits / self-fault disclosure), not only name/trope strings.
- Optional non-rofan world templates so `genre_neutral` is not the sole creative prior for 18 genres.
