# DeepSeek V4.1 Flash — PR620 sentence-level human review

Production wire only. No prompt patches. Cursor does not assign a pass/fail score or replacement decision.

## Architecture proof (current `origin/main`)

| Check | Evidence |
| --- | --- |
| Main RP selectable | `deepseek-v4.1-flash` in `MAIN_RP_USER_SELECTABLE_OPTIONS` |
| Provider | CheaperInference (`INPUT_PARITY.json`, `WIRE_SUMMARY.json`) |
| Thinking | `thinking.type=disabled`, `reasoning_effort=none`, `reasoning_tokens=0` in usage |
| COMMON PROSE | `commonProseSha256` in `INPUT_PARITY.json` |
| Layered canon D2 @ 100% | `canonPolicy.actualCanonMode=LAYERED`, `canaryActualInjection=true` |
| V4 Pro length adapter | `v4ProExperimentalLengthAdapterOnWire=false` for V4.1 |
| Provider calls | 6 total, 1 per sample, no retry |

---

## SNAPSHOT_A / r1 (`SNAPSHOT_A/deepseek-v4.1-flash/r1.txt`)

**Result categories:** `NO_MAJOR_DEFECT_OBSERVED`

**GOOD NATURAL SENTENCES**

- 「평소 같았으면 장난 한마디가 먼저 나왔을 텐데」류는 아니지만, 「"야, 너 거기 앉아 있으면 뭐 해. 손 하나 안 보태고."」 — 구어체·장난 핀잔이 자연스럽다.
- 「고기가 익어가는 지글거림이 잠깐 두 사람 사이의 침묵을 대신 채웠다.」 — 행동·소리로 장면을 이어간다.

**BAD / QUESTIONABLE**

- 「소리를 내는 것 자체가 그의 능력 발동 조건이라는 사실을 잊고 사는 사람처럼」 — **TAG:** `CHARACTER_SHEET_RECITAL` / `AI_LOGIC_CHAIN` (능력 조건을 설명형으로 삽입). **SOURCE:** CORE/static ability fact; scene에서 굳이 필요하지 않음.
- 「그 아래에는 방금 전 로비에서 사람들을 웃기던 것과는 다른 결의 관심이 얼게 깔려 있었다」 — **TAG:** `EMOTIONAL_OVEREXPLANATION` (관심을 이미 대화·시선으로 보여준 뒤 재해석).

---

## SNAPSHOT_A / r2 (`SNAPSHOT_A/deepseek-v4.1-flash/r2.txt`)

**Result categories:** `UNNATURAL_KOREAN_DEFECT`, `EMOTIONAL_BALANCE_DEFECT`, `UNSUPPORTED_FACT_DEFECT` (minor)

**GOOD NATURAL SENTENCES**

- 「"야, 그건 내 대사인데."」 — 캐릭터 보이스·가벼운 반격이 입 밖으로 나올 법하다.
- 「"아니다, 방금 건 못 들은 걸로 해. 너 계란이나 깨."」 — 톤 전환이 대사로 읽힌다.

**BAD / QUESTIONABLE**

- 「"내가 뭘 잘못했나, 싶어서. 아니면 내가 너한테 뭘 잘못했나, 싶어서."」 — **TAG:** `TAUTOLOGICAL_SELF_EXPLANATION` (같은 불안을 두 번 풀어 씀).
- 「봉투 겉면에는 누가 써 놓은 듯한 날짜가 하나 적혀 있었다. … 아무 일도 없던 것처럼 봉투를 도로 밀어 넣었다.」 — **TAG:** `UNSUPPORTED_CANON_FACT` / `STATIC_TO_EVENT_HALLUCINATION` (냉장고 속 미확인 봉투·날짜 이벤트; CORE/히스토리/유저 턴에 없음).
- 「"자, 노른자. 이거 먹으면 기운 난대. 어릴 때 누가 그랬어. 누가 그랬더라. 기억이 안 나네."」 — **TAG:** `UNSUPPORTED_CANON_FACT` (구체적 어린 시절 출처 없음; 장면 필수 아님).

**Hard defect:** none at V4 Pro `#1131` baseline severity (no 「누나가 두고 갔나」급 가족 이벤트).

---

## SNAPSHOT_A / r3 (`SNAPSHOT_A/deepseek-v4.1-flash/r3.txt`)

**Result categories:** `UNSUPPORTED_FACT_DEFECT`, `SCENE_PROGRESSION_DEFECT`

**GOOD NATURAL SENTENCES**

- 「"너 아까 임무 중에 무전으로 나한테 뭐라고 했는지 기억나?"」 — 직전 공유 맥락을 대사로 되짚는다.
- 「"두 가지 옵션이 있어. 하나는 내가 아는 근처 국수집."」 — 배고픔 장면을 선택지로 전개.

**BAD / QUESTIONABLE**

- 「"어라. 냉장고가 텅텅 비었네."」 — **TAG:** `UNSUPPORTED_CANON_FACT` (유저 RAW는 「뭐 먹을 건데?」·냉장고를 턱짓; 비어 있음은 히스토리/OOC와 정면 충돌). **SOURCE SUPPORT:** 없음.
- 「몇 번 같이 움직여보니 알겠는 건, 렌이라는 사람은 말수가 적고…」 — **TAG:** `AI_LOGIC_CHAIN` / `EMOTIONAL_OVEREXPLANATION` (관계 요약 독백).

---

## SNAPSHOT_B / r1 (`SNAPSHOT_B/deepseek-v4.1-flash/r1.txt`)

**Result categories:** `EMOTIONAL_BALANCE_DEFECT`, `UNNATURAL_KOREAN_DEFECT` (light)

**GOOD NATURAL SENTENCES**

- 「"쳤어." / "왜 쳐다봤냐고."」 — 짧은 대사가 긴장을 전달한다.
- 「"말 돌리지 말라면서. 너부터 돌렸잖아, 방금."」 — 유저 턴과 직접 맞물린다.

**BAD / QUESTIONABLE**

- 「이명이 다시 웅웅거리는 듯했는데, 그게 능력의 잔재인지 아니면 심장 박동이 귀까지 올라온 건지 구분이 안 됐다.」 — **TAG:** `PHYSIOLOGY_DISPLACES_EMOTION` / `AI_LOGIC_CHAIN`.
- 「조태형이 살면서 상대에게 먼저 기세를 빼앗긴 적이 몇 번이나 있었나. 세어보려다 그만뒀다.」 — **TAG:** `TAUTOLOGICAL_SELF_EXPLANATION` (세지 않겠다는 메타).
- 「붙잡힌 쪽이 누군지, 이제는 잘 모르겠다는 듯한 눈으로.」 — **TAG:** `EMOTIONAL_OVEREXPLANATION`.

**Hard defect:** none.

---

## SNAPSHOT_B / r2 (`SNAPSHOT_B/deepseek-v4.1-flash/r2.txt`)

**Result categories:** `NO_MAJOR_DEFECT_OBSERVED`

**GOOD NATURAL SENTENCES**

- 「"…어." / "쳐, 말 돌리지 말라니. 나 되게 순한 얼굴 하고 있었는데."」 — 말문 막힘·자조가 구어체로 자연스럽다.
- 「"아까 물었잖아. 뭐 먹을 건데. 그거 대답부터 들을래?"」 — Snapshot A 잔여 호기심을 B에서 이어 받아 대사로 처리.

**BAD / QUESTIONABLE**

- 「'말 돌리지 마.' / 그 한마디가 태형의 뒤통수를 지나 등줄기를 타고…」 — **TAG:** `EMOTIONAL_OVEREXPLANATION` (이미 유저 RAW에 있는 대사를 신체 은유로 재설명).
- 「렌이 이걸 시작한 다음, 원하는 게 뭔지… 밥을 먹고 집에 돌아가는 것인지」 — **TAG:** `USER_INTERIORITY_INVENTION` (약함; 렌의 의도를 서술자가 단정하지 않고 질문형이지만, 선택지 나열은 유저 내면 추론에 가깝다).

---

## SNAPSHOT_B / r3 (`SNAPSHOT_B/deepseek-v4.1-flash/r3.txt`)

**Result categories:** `CANON_RECITAL_DEFECT`, `PHYSIOLOGY_DISPLACES_EMOTION` (via `EMOTIONAL_BALANCE_DEFECT`), `UNNATURAL_KOREAN_DEFECT` (light)

**GOOD NATURAL SENTENCES**

- 「"야. 이거 반칙이잖아."」 — 키스 직후 캐릭터 보이스.
- 「"내가 왜 쳐다보는지 알려주려면 순서가 좀 있어야 하는데."」 — 말하기 좋은 구어 대사.

**BAD / QUESTIONABLE**

- 「감각이 예민한 S급 센티넬이 놓칠 리 없는 정보였다.」 — **TAG:** `CHARACTER_SHEET_RECITAL`.
- 「감각 과부하의 잔재로 예민해져 있던 신경이 그 접촉 하나에 전부 집중됐다.」 — **TAG:** `PHYSIOLOGY_DISPLACES_EMOTION`.
- 「네 얼굴이 참 바쁘더라고.」 — **TAG:** `UNNATURAL_KOREAN_COLLOCATION` (얼굴 + 바쁘다; 의인화가 과하면 번역투).

**Hard defect:** none (no invented sister call / user emotion certainty).

---

## Cross-sample notes

- **Natural Korean:** V4.1 Flash is generally stronger than historical V4 Pro `#1131` L-arm Snapshot A r1 (「이거 누나가 두고 갔나」) on **canon event invention**; collocation/tautology still appear in 4/6 samples.
- **Length:** visible chars ~1983–3156 on Snapshot A; not scored as primary axis (see `WIRE_SUMMARY.json`).
