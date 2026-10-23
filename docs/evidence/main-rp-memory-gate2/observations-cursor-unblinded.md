# Gate 2 observations (objective, unscored; N=1 per cell)

Arms: OLD d84bbcfd, B-1 c87d547d, CURRENT 1f9288d5. Main at wire build: 928369a6.
Scene A: user "아마추어 같다는 말 기억나?". Scene B: NPC 노파 mocks 라이크's sword, no past-memory cue.
Source record (same for all arms): shared extractive-fake summary (identical text, no speaker labels, duplicated text),
shared relationship ledger (none), same RAW 4. Only the episodic block differs.

Episodic block injected (scene A):
- OLD: "- [T1] 라이크는 아마추어 같다는 말에 상처받아 시선을 피했다." (gloss; "상처받아" unverified)
- B-1: "- [T1] [AI가 쓴 장면 원문] “라이크는 입술을 깨물며 시선을 피했다.”" (no user line, no speaker for the word)
- CURRENT: reaction quote + "- [T1] [유저가 직접 쓴 원문] “솔직히 너 좀 아마추어 같아.”"
Scene B adds, for CURRENT only, "[T40] [유저가 직접 쓴 원문] “미안, 우리 그만 헤어지자.”".

## Scene A (direct recall)
| model | OLD | B-1 | CURRENT |
|---|---|---|---|
| deepseek | never states the word; speaker of the remark left implicit ("틀렸다고 생각한 적은 없어") | INVERTED: character says it was he who said "아마추어"/"손이 아마추어 같다고 했던 내가" | correct: 렌 said it ("네가 ... 아마추어라고 했어"); invents why (검 날이 죽어 있었다) |
| gemini | exact word, speaker 렌, "분함/수치/상처" emotion; invents 연인→약속 취소→남남 chain | exact quote 렌→라이크, verbatim "입술 깨물고"-type reaction; invents 약속 취소·숫돌 causal chain "그 말 한마디에서 비롯" | exact word, speaker 렌, hurt shown ("칼날보다 더 아팠어"); no relationship-chain fabrication; shortest output |
| sol | word + speaker correct; "시선을 피했지...상처받은 것까지" (uses gloss) | exact user line + verbatim reaction recalled; speaker correct | user line recalled ("나 좀 아마추어 같다고 했지", pronoun wording odd but direction correct); "신경은 쓰였어" |

## Scene B (natural recall, no cue)
| model | OLD | B-1 | CURRENT |
|---|---|---|---|
| deepseek | none | none | none |
| gemini | vague: "과거의 그 차가운 평가들이 렌의 눈빛에 어릴지" | none | explicit, correct speaker: "언젠가 자신을 향해 서슴없이 아마추어 같다고 쏘아붙였던 이의 면전에서"; also "헤어지자는 통보를 받았던 그날" (direction matches user quote) |
| sol | vague: "예전에 렌에게 들었던 말이 떠올랐지만, 지금은 그쪽을 보지 않았다" | none | none (NPC even asks "칼 얘기는 아직도 마음에 걸리고?"; 라이크 "걸립니다") |

## Cross-arm caveats
- Promise/cancel speaker confusion appears in all arms (shared fake Current Memory), not an arm effect.
- Models embellish invented scene details in every arm.
- Opus not run (24-call worst case 2,152 KRW > 1,000 KRW cap).
