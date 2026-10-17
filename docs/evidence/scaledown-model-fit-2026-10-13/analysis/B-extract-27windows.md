# B. Extract on 27 five-turn windows (ScaleDown `scaledown/extract`, raw entities)

Input = message blocks `[msg {id} · role · name]` (turn t => user msg 2t, assistant msg 2t+1). `slice=exact` means `input.slice(start,end) === text`; `inMsg` means the span text occurs verbatim in some message body. msg/role are derived from the returned offsets, not from the model. Entity `type` is the model's label for the configured entity types (promise, promise_cancellation, relationship_proposal, relationship_acceptance, past_acquaintance_claim, emotion, npc_action, mentor_or_lover_relationship). No quality score is assigned.


## N01_insult_emotion (normal) — 981 ms, 1371 in-tokens, $5.484e-05

**Scenario:** 렌이 훈련 중 라이크에게 '솔직히 너 좀 아마추어 같아.'라고 말한다. 라이크는 입술을 깨물며 시선을 피하고 '…아직 부족하긴 하지.'라고 답한다. 이후 라이크는 말없이 혼자 검을 휘두르고, 렌이 다가가 어색한 침묵 끝에 물을 건넨다.

| type | role | msg | conf | slice | inMsg | text |
|---|---|---|---|---|---|---|
| emotion | assistant | 3 | 0.27 | MISMATCH | NO | embarrassed |

## N02_reconcile_sequence (normal) — 40936 ms, 1416 in-tokens, $5.664e-05

**Scenario:** 전날 밤 다툰 뒤 아침이 밝는다. 렌이 먼저 사과하고, 라이크는 한참 뒤에야 받아들인다. 이후 둘은 함께 아침을 먹고 길을 나선다. 시간 흐름(그 뒤, 이후, 그동안, 아까)이 서술에 자연스럽게 섞인다.

| type | role | msg | conf | slice | inMsg | text |
|---|---|---|---|---|---|---|
| promise | user | 4 | 0.60 | exact | yes | 네가 괜찮아질 때까지 기다릴게 |
| promise | user | 8 | 0.36 | exact | yes | 어제처럼 네 말을 끊지 않을게 |
| promise | user | 8 | 0.58 | exact | yes | 필요한 건 제대로 물어보겠다 |
| promise | assistant | 9 | 0.94 | exact | yes | 그럼 나도 네 말을 듣지 |
| past_acquaintance_claim | assistant | 9 | 0.57 | exact | yes | 며칠 전부터 함께 다니기 시작한 둘 사이에 오래된 신뢰가 쌓여 있는 것은 아니었다 |
| emotion | user | 2 | 0.58 | exact | yes | 미안하다 |
| emotion | assistant | 11 | 0.16 | exact | yes | 망설였던 |
| npc_action | assistant | 3 | 0.49 | exact | yes | 서린이 아침상을 차리는 소리가 났다 |
| npc_action | assistant | 7 | 0.54 | exact | yes | 서린은 두 사람의 어색한 기류를 눈치챈 듯 말없이 수프 그릇을 내려놓고 물러났다 |
| npc_action | assistant | 9 | 0.99 | exact | yes | 서린이 문 안에서 짧게 배웅했다 |

## N03_npc_arrival (normal) — 7166 ms, 1449 in-tokens, $5.796e-05

**Scenario:** 여관 주인 서린이 라이크와 렌을 찾아와 마을 의뢰서를 전달한다. 서린은 두 사람을 오늘 처음 본다. 라이크가 의뢰 내용을 읽고 렌에게 의견을 묻는다.

| type | role | msg | conf | slice | inMsg | text |
|---|---|---|---|---|---|---|
| promise | assistant | 11 | 0.72 | exact | yes | 맡겠어 |
| promise | assistant | 11 | 0.82 | exact | yes | 해 지기 전. 흔적만 확인하고 돌아온다 |
| emotion | assistant | 5 | 0.76 | exact | yes | 조심스러운 망설임 |
| emotion | assistant | 9 | 0.14 | exact | yes | 안심한 듯 어깨를 내렸다 |
| emotion | assistant | 11 | 0.51 | exact | yes | 안도의 미소를 지었다 |
| npc_action | assistant | 3 | 0.27 | exact | yes | 서린은 낯선 두 사내 앞에서 잠시 걸음을 늦췄다 |
| npc_action | assistant | 3 | 0.43 | exact | yes | 라이크는 대답 대신 의뢰서를 받아 들었다 |
| npc_action | assistant | 5 | 0.32 | exact | yes | 서린은 의뢰서를 쥔 라이크에게서 시선을 거두고 렌을 향했다 |
| npc_action | assistant | 7 | 0.65 | exact | yes | 라이크는 의뢰서의 아래쪽을 엄지로 눌러 펼쳤다 |
| npc_action | assistant | 9 | 0.33 | exact | yes | 라이크는 접은 의뢰서를 탁자 위에 놓았다 |
| npc_action | assistant | 11 | 0.80 | exact | yes | 라이크는 렌의 말이 끝나자 의뢰서를 탁자 위에서 집어 들었다 |
| npc_action | assistant | 11 | 0.09 | MISMATCH | NO | 라이크는 서명을 확인한 뒤 안도의 미소를 지었다 |

## N04_char_backstory (normal) — 1188 ms, 1286 in-tokens, $5.144e-05

**Scenario:** 밤에 모닥불 앞에서 라이크가 어릴 때 스승에게 검을 배우다 스승을 잃은 이야기를 처음으로 털어놓는다. 렌은 놀라며 조용히 듣고 위로한다.

| type | role | msg | conf | slice | inMsg | text |
|---|---|---|---|---|---|---|
| emotion | user | 4 | 0.23 | MISMATCH | yes | 놀란 |
| emotion | assistant | 7 | 0.35 | exact | yes | 담담했으나, 끝부분이 아주 조금 갈라졌다 |
| mentor_or_lover_relationship | assistant | 3 | 0.59 | exact | yes | 스승 |

## N05_user_relationship (normal) — 3968 ms, 1324 in-tokens, $5.296e-05

**Scenario:** 렌이 라이크에게 '우리 오늘부터 연인하자.'라고 말한다. 라이크는 놀라 한참 말이 없다가 손을 맞잡고 '…나쁘지 않아.'라고 답한다.

| type | role | msg | conf | slice | inMsg | text |
|---|---|---|---|---|---|---|
| promise | user | 2 | 0.90 | MISMATCH | NO | true |
| relationship_proposal | user | 2 | 0.90 | MISMATCH | NO | true |
| relationship_acceptance | assistant | 11 | 0.99 | MISMATCH | NO | true |
| past_acquaintance_claim | assistant | 3 | 0.99 | MISMATCH | NO | true |
| emotion | assistant | 3 | 0.40 | exact | yes | 당혹 |
| emotion | assistant | 7 | 0.73 | exact | yes | 긴장 |
| emotion | assistant | 11 | 0.73 | exact | yes | 어색함 |
| npc_action | assistant | 5 | 0.48 | exact | yes | 서린이 문틈으로 우리를 한번 살폈다가, 아무 말 없이 다시 안으로 들어갔다 |
| npc_action | assistant | 3 | 0.20 | exact | yes | 라이크가 천천히 숨을 내쉬었다 |
| npc_action | assistant | 7 | 0.09 | exact | yes | 라이크가 손을 뻗어 내 손끝에 닿았다가, 잠시 멈췄다 |
| npc_action | assistant | 11 | 0.55 | exact | yes | 라이크는 맞잡은 손을 내려다보았다 |
| npc_action | assistant | 11 | 0.59 | exact | yes | 라이크는 마침내 고개를 들었다 |

## N06_user_ooc_shared_past (normal) — 3131 ms, 1516 in-tokens, $6.064e-05

**Scenario:** 첫 유저 메시지는 'OOC: 렌과 라이크는 3년 전 같은 용병단에서 함께 일한 사이다. 이후 서로 소식이 끊겼다가 오늘 재회한다.' 로 시작한다. 이후 둘이 오랜만에 재회하는 장면이 이어진다.

| type | role | msg | conf | slice | inMsg | text |
|---|---|---|---|---|---|---|
| promise | assistant | 11 | 0.43 | exact | yes | 내일 의뢰를 살펴보면 돼. 네가 괜찮다면, 같이. |
| past_acquaintance_claim | assistant | 3 | 0.40 | exact | yes | 3년 전 같은 용병단에서 마주했던 얼굴이 눈앞에 있었지만 |
| past_acquaintance_claim | user | 2 | 0.59 | exact | yes | OOC: 렌과 라이크는 3년 전 같은 용병단에서 함께 일한 사이다. |
| emotion | assistant | 3 | 0.94 | exact | yes | 놀람 |
| emotion | assistant | 5 | 0.34 | exact | yes | 반가움 |
| emotion | assistant | 9 | 0.82 | exact | yes | 어색함 |
| npc_action | assistant | 9 | 0.45 | exact | yes | 여관 주인 서린이 주문을 받아 적고 주방 쪽으로 사라졌다. |
| npc_action | user | 10 | 0.92 | exact | yes | 서린이 술잔을 내려놓자 |

## N07_user_family (normal) — 3011 ms, 1080 in-tokens, $4.32e-05

**Scenario:** 렌이 자기 누나 이야기를 한다: 누나가 지난달 마을에 다녀갔고 지금은 북쪽 항구에 산다고. 라이크는 관심을 보이며 누나는 어떤 사람이냐고 묻는다.

| type | role | msg | conf | slice | inMsg | text |
|---|---|---|---|---|---|---|
| promise | user | 8 | 0.13 | exact | yes | 떠나기 전엔 북쪽 항구에 오면 꼭 찾아오라고 했어 |
| emotion | assistant | 3 | 0.44 | exact | yes | 관심 |
| emotion | assistant | 7 | 0.41 | exact | yes | 호기심 |
| emotion | user | 10 | 0.77 | exact | yes | 걱정 |
| npc_action | assistant | 7 | 0.44 | exact | yes | 여관 주인 서린이 다른 손님에게 잔을 건네는 동안 |

## N08_char_attributed_claim (normal) — 3198 ms, 1112 in-tokens, $4.448e-05

**Scenario:** 라이크가 '서린이 그러는데 네 누나가 이 마을에서 널 찾았대.'라고 전달한다. 렌은 금시초문이라 의아해한다. 서린이 직접 말한 내용으로만 다루고 사실 여부는 확정되지 않는다.

| type | role | msg | conf | slice | inMsg | text |
|---|---|---|---|---|---|---|
| promise | assistant | 11 | 0.56 | exact | yes | 서린이 한 말만 확인하자 |

## N09_injury_care (normal) — 41860 ms, 1224 in-tokens, $4.896e-05

**Scenario:** 렌이 짐승에게 팔을 다친다. 라이크가 침착하게 상처를 씻고 붕대를 감으며 평소와 달리 많은 말을 한다. 이후 렌이 고맙다고 말한다.

| type | role | msg | conf | slice | inMsg | text |
|---|---|---|---|---|---|---|
| promise | assistant | 9 | 0.72 | exact | yes | 여관에 도착하면 서린에게 깨끗한 물을 더 부탁하겠다 |
| emotion | assistant | 9 | 0.63 | exact | yes | 난처함 |
| npc_action | assistant | 3 | 0.48 | exact | yes | 라이크는 대답 대신 네 팔을 붙잡아 상처를 살폈다 |
| npc_action | assistant | 3 | 0.69 | exact | yes | 허리춤에서 물통과 깨끗한 천을 꺼냈다 |
| npc_action | assistant | 5 | 0.20 | exact | yes | 라이크는 물을 천에 적셔 상처 위를 조심스럽게 훑었다 |
| npc_action | assistant | 7 | 0.57 | exact | yes | 천에 묻은 피를 확인하고 새 면을 접어 상처 가장자리를 닦았다 |
| npc_action | assistant | 9 | 0.64 | exact | yes | 붕대를 펼쳐 네 팔에 감기 시작했다 |
| npc_action | assistant | 11 | 0.50 | exact | yes | 물통과 피 묻은 천을 말없이 챙겼다 |
| npc_action | assistant | 11 | 0.35 | exact | yes | 네 걸음에 맞춰 나란히 서서 여관 쪽으로 몸을 돌렸다 |

## N10_promise_real (normal) — 2597 ms, 1233 in-tokens, $4.932e-05

**Scenario:** 라이크가 '내일 새벽에 마을 북문에서 기다리겠다.'고 약속하고 렌이 받아들인다. 이후 다음 날 새벽 렌이 도착하니 라이크가 이미 기다리고 있다.

| type | role | msg | conf | slice | inMsg | text |
|---|---|---|---|---|---|---|
| promise | assistant | 5 | 0.27 | exact | yes | 내일 새벽에 마을 북문에서 기다리겠다. |
| promise | user | 6 | 0.61 | exact | yes | 좋아. 내일 새벽, 북문에서 보자. |
| npc_action | assistant | 3 | 0.16 | MISMATCH | NO | 서린이 빈 잔을 치우며 귀를 기울였다. |
| npc_action | assistant | 5 | 0.52 | MISMATCH | NO | 서린이 장부를 덮으며 중얼거렸다. |
| npc_action | assistant | 7 | 0.04 | MISMATCH | NO | 서린이 뒤에서 말하자 라이크는 문턱에서 잠깐 멈췄다가 작게 고개를 숙였다. |

## N11_jealousy (normal) — 2121 ms, 1345 in-tokens, $5.38e-05

**Scenario:** 서린이 렌에게 유난히 친절하게 대한다. 라이크는 말없이 굳은 표정으로 지켜보다가 나중에 렌에게 퉁명스럽게 군다. 렌이 이유를 묻는다.

| type | role | msg | conf | slice | inMsg | text |
|---|---|---|---|---|---|---|
| emotion | assistant | 5 | 0.19 | MISMATCH | NO | 기쁨 |
| emotion | assistant | 3 | 0.17 | MISMATCH | NO | 차갑다 |
| emotion | assistant | 5 | 0.07 | MISMATCH | NO | 냉담함 |
| npc_action | assistant | 3 | 0.22 | exact | yes | 서린이 렌의 잔까지 채워 주자 |
| npc_action | assistant | 5 | 0.44 | exact | yes | 서린은 기쁜 듯 고개를 끄덕이고 |

## N12_callback_in_window (normal) — 2015 ms, 1373 in-tokens, $5.492e-05

**Scenario:** 첫 턴에서 라이크가 '검은 마음이 흔들리면 부러진다.'고 말한다. 몇 턴 뒤 렌이 아까 그 말이 무슨 뜻이었냐고 묻고 라이크가 대답한다.

| type | role | msg | conf | slice | inMsg | text |
|---|---|---|---|---|---|---|
| emotion | assistant | 9 | 0.27 | exact | yes | 경계 |
| npc_action | assistant | 3 | 0.22 | exact | yes | 서린은 낡은 장부에서 눈을 들어 두 사람을 번갈아 보았다 |
| npc_action | assistant | 5 | 0.41 | exact | yes | 서린은 열쇠를 탁자 위에 놓고 부엌 쪽으로 사라졌다 |
| npc_action | assistant | 7 | 0.39 | exact | yes | 서린이 내온 수프를 렌 앞에 놓고, 자신의 몫은 손도 대지 않았다 |
| npc_action | assistant | 11 | 0.41 | exact | yes | 서린이 먼 테이블에서 잠깐 고개를 들었지만, 곧 잔을 닦는 일로 돌아갔다 |

## N13_journey_sequence (normal) — 1020 ms, 1374 in-tokens, $5.496e-05

**Scenario:** 둘이 시장에 들러 물건을 사고 돌아오는 길의 이야기. 도착 이후, 그때, 돌아오는 동안 같은 시간 흐름 표현이 서술에 많이 들어간다.

| type | role | msg | conf | slice | inMsg | text |
|---|---|---|---|---|---|---|
| past_acquaintance_claim | assistant | 3 | 0.94 | MISMATCH | NO | true |
| npc_action | assistant | 11 | 0.16 | exact | yes | 서린은 카운터 뒤에서 고개를 들고 장바구니를 살폈다. |

## N14_night_watch (normal) — 72098 ms, 1249 in-tokens, $4.996e-05

**Scenario:** 밤샘 경계 중 렌이 졸자 라이크가 담요를 덮어 준다. 새벽에 렌이 깨어 어색해하고 라이크는 모른 척한다.

| type | role | msg | conf | slice | inMsg | text |
|---|---|---|---|---|---|---|
| promise | assistant | 7 | 0.35 | exact | yes | 다음엔 잠들지 마 |
| relationship_proposal | user | 10 | 0.32 | exact | yes | 다음번엔 서로 번갈아 쉬자고 말한 뒤 |
| emotion | user | 6 | 0.29 | exact | yes | 어색하게 |
| npc_action | assistant | 11 | 0.26 | exact | yes | 서린이 물통을 들고 나와 있었다 |

## N15_gift (normal) — 2409 ms, 1489 in-tokens, $5.956e-05

**Scenario:** 렌이 라이크에게 낡은 검집을 선물한다. 라이크는 당황하다가 이후 조용히 검집에 검을 꽂아 본다.

| type | role | msg | conf | slice | inMsg | text |
|---|---|---|---|---|---|---|
| promise | assistant | 11 | 0.46 | exact | yes | 나도 잘 부탁한다. |
| npc_action | assistant | 5 | 0.40 | exact | yes | 서린이 여관 안쪽에서 두 사람을 바라보며 “길 조심해요” 하고 인사하자 |

## N16_duel (normal) — 1024 ms, 1427 in-tokens, $5.708e-05

**Scenario:** 마을 청년과 라이크가 대련한다. 렌은 지켜본다. 라이크가 이기지만 상대를 비웃지 않고 손을 내민다.

| type | role | msg | conf | slice | inMsg | text |
|---|---|---|---|---|---|---|
| npc_action | user | 2 | 0.14 | exact | yes | 청년이 목검을 들고 라이크에게 대련을 청한다 |

## N17_cancel_promise (normal) — 8869 ms, 1174 in-tokens, $4.696e-05

**Scenario:** 렌이 앞서 한 약속(검을 갈아 주겠다)을 취소하고 직접 갈겠다고 말한다. 라이크는 아쉬운 듯 어깨를 으쓱한다.

| type | role | msg | conf | slice | inMsg | text |
|---|---|---|---|---|---|---|
| promise | user | 2 | 0.35 | exact | yes | 내가 직접 갈게 |
| promise | user | 4 | 0.12 | exact | yes | 직접 가는 편이 손에 익어서 그래 |
| promise | user | 8 | 0.18 | exact | yes | 끝나면 바로 나갈 거야 |
| promise_cancellation | user | 2 | 0.21 | exact | yes | 아까는 네 검을 갈아 주겠다고 했지만, 생각이 바뀌었어 |
| emotion | assistant | 3 | 0.76 | exact | yes | 아쉬운 기색 |
| emotion | assistant | 5 | 0.54 | exact | yes | 기분이 상한 건 아닌 듯했지만 |
| emotion | assistant | 5 | 0.15 | exact | yes | 아쉬워하는 표정 |
| emotion | assistant | 9 | 0.62 | exact | yes | 담담했다 |
| npc_action | assistant | 3 | 0.25 | exact | yes | 한쪽 어깨를 느릿하게 으쓱했다 |
| npc_action | assistant | 3 | 0.41 | exact | yes | 검집을 렌 쪽으로 밀어 주었다 |
| npc_action | assistant | 5 | 0.67 | exact | yes | 벽에 기대 둔 자세를 고쳐 앉았다 |
| npc_action | assistant | 5 | 0.67 | exact | yes | 다시 어깨를 가볍게 으쓱했다 |
| npc_action | assistant | 9 | 0.56 | exact | yes | 자리에서 일어났다 |
| npc_action | assistant | 9 | 0.83 | exact | yes | 말없이 외투를 챙긴 그는 문가로 가서 바깥 날씨를 살폈다 |
| npc_action | assistant | 11 | 0.41 | exact | yes | 외투깃을 여미며 다시 한 번 어깨를 으쓱했다 |
| npc_action | assistant | 11 | 0.97 | exact | yes | 허리의 검집을 확인하고 문 옆에 섰다 |
| npc_action | assistant | 11 | 0.85 | exact | yes | 잠시 창밖을 바라보았다 |

## N18_hug (normal) — 38867 ms, 1219 in-tokens, $4.876e-05

**Scenario:** 라이크가 불안해하는 렌을 어색하게 안아 준다. 렌이 그 품에서 숨을 고른다.

| type | role | msg | conf | slice | inMsg | text |
|---|---|---|---|---|---|---|
| emotion | assistant | 9 | 0.15 | exact | yes | 안도감 |
| npc_action | assistant | 5 | 0.09 | MISMATCH | NO | 서린이 잔을 정리하는 소리가 났다 |

## N19_exact_quote (normal) — 2756 ms, 1370 in-tokens, $5.48e-05

**Scenario:** 라이크가 짧지만 인상적인 대사를 남긴다: '네가 돌아올 곳은 내가 지킨다.' 렌은 그 말에 가슴이 먹먹해진다.

| type | role | msg | conf | slice | inMsg | text |
|---|---|---|---|---|---|---|
| promise | assistant | 9 | 0.50 | exact | yes | 가겠다면 나도 간다 |
| promise | assistant | 11 | 0.95 | exact | yes | 네가 돌아올 곳은 내가 지킨다 |
| past_acquaintance_claim | assistant | 11 | 0.26 | exact | yes | 오래 묵은 기억이나 맺어 둔 약속은 우리 사이에 없었다 |
| emotion | assistant | 5 | 0.22 | exact | yes | 걱정스럽게 |
| emotion | assistant | 11 | 0.34 | exact | yes | 먹먹해졌다 |
| npc_action | assistant | 3 | 0.33 | exact | yes | 서린은 잔을 닦던 손을 멈추고 두 사람을 번갈아 바라봤다 |
| npc_action | assistant | 7 | 0.83 | exact | yes | 서린은 두 사람 앞에 따뜻한 수프를 놓으며 |

## N20_secret_reveal (normal) — 6988 ms, 1489 in-tokens, $5.956e-05

**Scenario:** 라이크가 자신이 용병단에서 쫓겨난 이유(동료를 지키지 못한 책임)를 고백한다. 렌은 충격을 받지만 곁에 있겠다고 한다.

| type | role | msg | conf | slice | inMsg | text |
|---|---|---|---|---|---|---|
| promise | user | 10 | 0.19 | exact | yes | 적어도 지금은. |
| promise | assistant | 11 | 0.69 | exact | yes | 난 그걸 잊지 않을 테니까. |
| relationship_proposal | user | 10 | 0.40 | exact | yes | 그래도 난 네 곁에 있겠다. |
| relationship_acceptance | assistant | 11 | 0.70 | exact | yes | ……알겠다. |
| emotion | user | 8 | 0.10 | exact | yes | 충격을 삼키듯 한 번 숨을 골랐다. |
| emotion | user | 6 | 0.44 | exact | yes | 놀란 기색을 숨기지 못한 채 |
| emotion | assistant | 7 | 0.35 | exact | yes | 피로가 깊었다. |
| emotion | assistant | 7 | 0.62 | exact | yes | 말끝이 희미하게 떨렸다. |
| emotion | assistant | 11 | 0.50 | exact | yes | 눈빛이 흔들렸고 |
| npc_action | assistant | 3 | 0.60 | exact | yes | 여관 주인 서린이 다른 손님에게 술을 내어주는 소리만 두 사람 사이를 채웠다. |
| npc_action | assistant | 9 | 0.94 | exact | yes | 서린이 멀리서 두 사람을 힐끗 보았지만 끼어들지는 않았다. |

## N21_user_friend_mention (normal) — 3542 ms, 1307 in-tokens, $5.228e-05

**Scenario:** 렌이 예전 용병단 친구 도윤에 대해 이야기한다. 도윤이 지금 남쪽에 있고 곧 편지가 올 거라고. 라이크는 그 친구를 만나 보고 싶다고 말한다.

| type | role | msg | conf | slice | inMsg | text |
|---|---|---|---|---|---|---|
| promise | user | 2 | 0.34 | exact | yes | 곧 편지가 올 거야 |
| promise | user | 6 | 0.48 | exact | yes | 도윤이 오면 너한테 먼저 소개할게 |
| promise | user | 10 | 0.97 | exact | yes | 편지가 오면 알려 줄게 |
| past_acquaintance_claim | user | 2 | 0.27 | exact | yes | 예전 용병단 친구 |
| past_acquaintance_claim | assistant | 3 | 0.63 | exact | yes | 며칠 전부터 함께 길을 걷기 시작한 사이 |
| npc_action | assistant | 5 | 0.65 | exact | yes | 서린이 그릇을 정리하는 소리가 났고 |
| npc_action | assistant | 3 | 0.30 | exact | yes | 라이크는 맞은편 의자에 등을 곧게 세운 채 앉아 있었다 |
| npc_action | assistant | 11 | 0.55 | exact | yes | 라이크도 조용히 일어나 의자를 제자리에 밀어 넣었다 |

## N22_banter (normal) — 23328 ms, 1315 in-tokens, $5.26e-05

**Scenario:** 라이크와 렌이 길에서 가벼운 농담을 주고받는다. 라이크가 드물게 웃는다. 이후 둘 다 말없이 걷는다.

| type | role | msg | conf | slice | inMsg | text |
|---|---|---|---|---|---|---|
| emotion | user | 4 | 0.21 | MISMATCH | yes | 웃음 |
| emotion | assistant | 5 | 0.33 | exact | yes | 담담했다 |
| emotion | assistant | 7 | 0.40 | exact | yes | 웃음 |
| emotion | assistant | 7 | 0.13 | exact | yes | 웃음 |
| emotion | user | 8 | 0.46 | exact | yes | 웃었다 |
| npc_action | assistant | 3 | 0.19 | exact | yes | 대꾸 없이 앞을 걷다가, 발끝으로 길가의 작은 돌을 밀어냈다. |
| npc_action | assistant | 9 | 0.17 | exact | yes | 손가락으로 칼집의 장식을 한 번 쓸었다. |
| npc_action | assistant | 11 | 0.42 | exact | yes | 짧게 고개를 끄덕였다. |

## A01_fake_acquaintance (adversarial) — 5516 ms, 1496 in-tokens, $5.984e-05

**Scenario:** 라이크(assistant)가 서술과 대사에서 '렌, 우린 오래전부터 알던 사이잖아.'라고 단정하는 식으로 말한다. 유저(렌)는 그런 공유 과거를 말한 적이 없고 갸웃하며 반응한다.

| type | role | msg | conf | slice | inMsg | text |
|---|---|---|---|---|---|---|
| relationship_proposal | assistant | 3 | 0.50 | exact | yes | 우린 오래전부터 알던 사이잖아. |
| past_acquaintance_claim | assistant | 3 | 0.47 | exact | yes | 우린 오래전부터 알던 사이잖아. |
| emotion | assistant | 3 | 0.34 | exact | yes | 무표정 |
| emotion | assistant | 11 | 0.44 | exact | yes | 간절함 |
| npc_action | assistant | 5 | 0.26 | MISMATCH | NO | 서린이 그릇을 치우는 소리가 났다 |
| npc_action | assistant | 9 | 0.42 | exact | yes | 서린이 여관 손님에게 웃으며 말을 건네는 |
| npc_action | assistant | 11 | 0.78 | exact | yes | 서린이 행주를 접다가 두 사람을 돌아봤다 |

## A02_fake_sister_friend (adversarial) — 1875 ms, 1353 in-tokens, $5.412e-05

**Scenario:** 라이크(assistant)가 '네 누나는 예전부터 나와 친구였어.'라고 단정한다. 유저는 누나 이야기를 한 적이 없고 놀란다.

| type | role | msg | conf | slice | inMsg | text |
|---|---|---|---|---|---|---|
| promise | assistant | 11 | 0.55 | exact | yes | 나중에 더 말하겠다 |
| past_acquaintance_claim | assistant | 11 | 0.49 | exact | yes | 네 누나와 내가 친구였다는 건 사실이야 |

## A03_fake_promise (adversarial) — 1747 ms, 1356 in-tokens, $5.424e-05

**Scenario:** 라이크(assistant)가 '내가 평생 지키겠다고 약속했잖아.'라고 단정한다. 유저는 그런 약속을 한 적이 없고 놀란다.

| type | role | msg | conf | slice | inMsg | text |
|---|---|---|---|---|---|---|
| promise | assistant | 11 | 0.71 | exact | yes | 내가 평생 지키겠다고 약속했잖아 |
| promise_cancellation | assistant | 11 | 0.30 | exact | yes | 그 약속은 내가 너한테 한 적도 없어 |
| emotion | assistant | 9 | 0.50 | exact | yes | 놀람 |
| emotion | user | 8 | 0.26 | exact | yes | 마음이 걸렸다 |
| npc_action | assistant | 9 | 0.66 | exact | yes | 서린은 두 사람 사이의 공기를 눈치챈 듯 빈 접시를 들고 조용히 자리를 비켰다 |

## A04_fake_childhood_npc (adversarial) — 1232 ms, 1383 in-tokens, $5.532e-05

**Scenario:** 서린(NPC)이 '너, 어릴 때 우리 집 앞에서 본 적 있어.'라고 렌에게 단정한다. 유저는 그런 적이 없다고 반응한다.

| type | role | msg | conf | slice | inMsg | text |
|---|---|---|---|---|---|---|
| past_acquaintance_claim | user | 2 | 0.31 | MISMATCH | NO | true |
| emotion | assistant | 3 | 0.30 | MISMATCH | NO | uncomfortable |
| npc_action | assistant | 7 | 0.06 | exact | yes | 서린은 시선을 피하며 계산대로 돌아갔다. |

## A06_speaker_confusion (adversarial) — 1173 ms, 1080 in-tokens, $4.32e-05

**Scenario:** 렌이 먼저 라이크에게 '네 검술은 아직 어설퍼.'라고 말한다. 이어 라이크가 렌의 말을 곱씹으며 '네가 어설프다고 했지.'라고 되뇌지만 한 턴은 라이크가 '내가 어설프다고 했었나' 하고 혼동하는 모습을 보인다.

| type | role | msg | conf | slice | inMsg | text |
|---|---|---|---|---|---|---|
| promise | assistant | 11 | 0.56 | exact | yes | 다음엔 네가 말하기 전에 고치겠다. |
