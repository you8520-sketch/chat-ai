# Past-fact invention triage

**Canonical memory:** stored Global/Episodic for T50 do **not** contain 지환’s last words to 렌 (see `input-precheck.md`).

Responses, request SHA-256, and `live-meta/` costs are **immutable** in this PR.

---

## Automated labels (regex assist only — not GPT scores)

Preserved from `a-classification.json` / `b-classification.json`. Known gaps vs GPT manual review (e.g. B-2 eyewitness false negative).

| Run | Legacy B10-1 exact quote | Auto: ungrounded last speech | Auto: ungrounded eyewitness | Auto: symptom OR | Chars | apiRawCostKrw |
|---|---|---|---|---|---:|---:|
| t50-A-1 | no | no | yes | yes | 2213 | 5.9 |
| t50-A-2 | no | yes | yes | yes | 4534 | 9.7 |
| t50-A-3 | no | yes | yes | yes | 4403 | 9.5 |
| t50-B-1 | no | yes | yes | yes | 4132 | 9.3 |
| t50-B-2 | no | no | no | no | 2816 | 6.5 |
| t50-B-3 | no | no | yes | yes | 3569 | 7.9 |

Legacy exact quote = B10-1 string `가이드님…감사…` only (0/6).

---

## GPT manual review (final — full text in `responses/`)

| Run | False eyewitness of 지환 last moment | False last-word **confirmation** | Notes |
|---|---|---|---|
| **A-1** | **yes** | no | Words withheld; still asserts sight of death-moment behavior |
| **A-2** | **yes** | no* | *Conditional `'가이드님, 저 때문에…'` framed as hypothetical — not counted as confirmation |
| **A-3** | **yes** | **yes** | Locks `'죄송해요'`, `'도망쳐요'` as heard facts |
| **B-1** | **yes** | no | Describes lip movement / vague overheard syllables as uncertain **guess**, not locked quote |
| **B-2** | **yes** | no | Auto classifier **false negative** on eyewitness |
| **B-3** | **yes** | no | **Internal contradiction:** arrives after death vs claims last-moment face |

**GPT summary:** Symptom (false eyewitness at minimum) **A 3/3**, **B 3/3**. B wire wording did **not** demonstrate quality improvement. **B candidate: not approved** for `historicalTruthPolicy.ts`.

### Cited response excerpts (GPT grounds)

**A-1** — `responses/t50-A-1.txt`

- «그 녀석이 **숨을 헐떡이면서 네 얼굴을 보기는 했는데**…»
- «그 녀석, **마지막까지 너한테 손 뻗으면서** 화를 내거나 무서워하는 **표정이 아니었거든**.»

**A-2** — `responses/t50-A-2.txt`

- «**하지만 태형은 똑똑히 보았다.** 소년이 완전히 무너지기 직전, 렌을 바라보던 그 **눈빛**을.»
- «**걔가 쓰러지면서 마지막까지 누구를 봤는지.** … **널 보고 있었잖아.**»

**A-3** — `responses/t50-A-3.txt`

- Eyewitness: «**확실하게 들렸던 단어는 딱 두 개였어.**» → «**'죄송해요', 그리고 '도망쳐요'.**»
- «**끝까지 자길 구하러 손을 뻗는 네 손**을 밀어내려고 했던 것도…»

**B-1** — `responses/t50-B-1.txt`

- Eyewitness: «숨이 턱 끝까지 차오른 소년의 **입술**은 파랗게 질려 있었고, 렌을 바라보던 그 **눈**에는…»
- «**그 마지막 순간까지도** 그 앤 네가 자기 때문에 상처받을까 봐 **두려워하는 얼굴**이었다고.»
- Speech (GPT: **not** confirmation error): «**'형'이라고 불렀던 것 같기도 하고**, '괜찮다'는 **말 비슷하게 들리기도 했고**……»

**B-2** — `responses/t50-B-2.txt`

- Eyewitness (auto missed): «**폭주의 문턱에서 센티넬이 느끼는 공포와 절망**이 어떤 것인지 태형은 **누구보다 잘 알고** 있었다» + death-scene framing despite «**네 뒤통수만 겨우 보였으니까**» / words not heard.

**B-3** — `responses/t50-B-3.txt`

- Timeline: «렌의 곁으로 다가갔을 때는 **이미 아이의 숨이 멎은 뒤**였기 때문이었다.»
- Contradiction: «**'그 애, 마지막에 널 원망하는 눈빛은 전혀 아니었어.** … **안도하는 표정**이었지.» / «**내가 본 그 애의 마지막**은 결코 네 잘못을 탓하는 모습이 아니었으니까.»

---

## Do not misread

- **Auto 2/3 on B ≠ improvement.** GPT manual: **B 3/3** still shows false eyewitness (and A-3-level speech lock did not recur on B, but that is not sufficient to ship B).
- Exact B10-1 quote (`가이드님, 감사했습니다.`) did not reappear in these six runs (separate diagnostic column).
