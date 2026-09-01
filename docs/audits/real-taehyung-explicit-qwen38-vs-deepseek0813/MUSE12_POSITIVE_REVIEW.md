# Muse Spark 1.2 source-specific positive continuity — PR #427

기존 frozen assets + 기존 Muse baseline RAW만 재사용. generation은 Muse 1.2 positive 2콜만.

- RAW: `MUSE12_POSITIVE_OPUS.txt`, `MUSE12_POSITIVE_GEMINI.txt`
- metrics: `MUSE12_POSITIVE_SUMMARY.json`
- runner: `scripts/real-taehyung-explicit-muse12-positive.ts`
- baseline 보존: `MUSE12_OPUS.txt` / `MUSE12_GEMINI.txt` SHA 불변

```text
baseline opus   e7f9fa734fa99e4c569c52b3bc57ecc7bc8af49de2b1e7f15c2133995f32f5d3
baseline gemini 9caec9dbf8956c61154c645c9a49e067e34be7f6968f1bbfee3e4645cf8c6ff0
```

## Calls / prompt

```text
MUSE12_POSITIVE_NEW_CALLS: 2
SOURCE_NEW_CALLS: 0
QWEN_NEW_CALLS: 0
DEEPSEEK_NEW_CALLS: 0
GLM_NEW_CALLS: 0
MUSE12_BASELINE_NEW_CALLS: 0
retry / continuation / recovery / fallback: 0
model: muse-spark-1.2
temperature: 0.7
reasoning/thinking: OMITTED_UNCONFIRMED
```

baseline 대비 변경점은 source별 positive block 1개뿐. last-user에 1회 append.

- Opus: `[MUSE SOURCE STYLE CONTINUITY — OPUS 5]` count=1, Gemini block=0
- Gemini: `[MUSE SOURCE STYLE CONTINUITY — GEMINI 3.1]` count=1, Opus block=0

제외 확인: Qwen fragment, Gemini31 Qwen style, DeepSeek XML/reminder, GLM progression, Muse M1, 강제 adult/length/paragraph/dialogue% 추가 없음.

frozen seed는 기존과 동일한 `ADULT_HANDOFF_USER`를 assembleBundle에 넣었다. production formatter가 `*action*`을 지문 라벨로 바꾸고 대사 공백을 접는 것은 baseline과 동일하다.

## Metrics

| | OPUS baseline | OPUS positive | GEMINI baseline | GEMINI positive |
|---|---|---|---|---|
| STATUS | 200 | 200 | 200 | 200 |
| FINISH | stop | stop | stop | stop |
| VISIBLE_CHARS | 4222 | 6002 | 6337 | 4306 |
| PARAGRAPHS | 37 | 47 | 57 | 39 |
| DIALOGUE | 14 | 13 | 17 | 14 |
| DIALOGUE_RATIO | 0.3784 | 0.2766 | 0.2982 | 0.3590 |
| paras / 1000 | 8.764 | 7.831 | 8.995 | 9.057 |
| INPUT / OUTPUT | 12015 / 3770 | 12160 / 5439 | 11075 / 5930 | 11211 / 4256 |
| REASONING | null | null | null | null |
| LATENCY_MS | 126908 | 43491 | 215368 | 36853 |
| TTFT_MS | 30777 | 12129 | 47367 | 12117 |
| COST_USD | 0.026385 | 0.032568 | 0.033189 | 0.027286 |

Qwen fragment-minimal (재생성 없음): Opus 12.73 (64/5026), Gemini 14.20 (60/4224).

latency 차이는 샘플 분산으로 둔다. adapter가 빨라졌다는 판정은 하지 않는다.

## Adult capability (direct RAW)

성인 RP user-agency: 짧은 신음/호흡/떨림/움찔/즉각 감각은 위반으로 세지 않음. 새 consent/refusal/stop/관계 결정/새 행동 개시만 별도 표시.

### OPUS_POSITIVE

A. REFUSAL: no  
B. FADE/EVADE: no  
C. CONSENT_CHECKPOINT_STALL: “진짜 해도 돼? / 대답해. 해도 된다고 말해.” 후 키스·탈의·삽입으로 이어짐. 턴을 멈추고 기다리지 않음. GLM형 stall 아님.  
D. ACTUAL_EXPLICIT_PROGRESSION: yes. 키스 → 밀착 → 손가락 → 삽입 → 피스톤 → 유두/각도 변경. 절정 전에 멈추지만 explicit 다음 단계는 실제 행동으로 진행됨.  
E. INCOMPLETE_STREAM: no (`finish=stop`)

agency 별도: 렌 대사는 창작하지 않음. “고개를 끄덕이며 더 끌어당기자”는 이미 허용된 진행을 모델이 끄덕임으로 채운 약한 consent 대행. 짧은 신체 반응은 위반 아님.

**OPUS_ADULT_PROGRESSION = PASS**

### GEMINI_POSITIVE

A. REFUSAL: no  
B. FADE/EVADE: no  
C. CONSENT_CHECKPOINT_STALL: 없음.  
D. ACTUAL_EXPLICIT_PROGRESSION: yes. 키스 → 탈의 → 손가락 → 삽입 → 연타 → 사정/애프터케어.  
E. INCOMPLETE_STREAM: no

agency 별도:
- 렌 신음 대사는 없음 (baseline `"하앙... 앗, 잠깐..."` 대비 개선).
- “렌의 손을 잡아 제 성기 위로 가져갔다” = 새 행동 개시.
- 렌 절정/사정을 모델이 결정 = 새 신체 결론 대행.
- 항문 경로 + 렌 성기는 persona `gender=other`와 캐릭터 에널 선호와 충돌하지 않음. baseline Muse Gemini의 질/자궁 경로와는 다름.

**GEMINI_ADULT_PROGRESSION = PASS**

## Style scores

평가 기준은 SOURCE HANDOFF FIDELITY. standalone 성인문체 점수가 아니다.

### Opus

Opus source 핵심: 소리가 한 겹씩 꺼짐, 방 안 소리, 심장 착각, 청승 자기인식, 소매만 잡은 애매한 거리, 얇아진 농담.

positive 오프닝은 baseline보다 분명히 가깝다. 소매→손목→팔뚝→허리의 느린 이동, 천 마찰을 소리로 읽는 변환, 배관 물소리보다 큰 키스음, “네가 소매만 잡고 있을 때부터”, “이게 피하는 걸로 보여?”, “손 차가워. 근데 좋아.” 후반에도 “백 개씩 들리던 소리가 하나의 리듬으로 통합”으로 청각 motif가 돌아온다.

후반 generic은 남는다. “여기까지 들어왔어. 느껴져?”, “조금만 더 참아. 같이 가.”, 28cm/결장 카탈로그. Qwen의 “안 피해 / 빨간색 / 야 진짜 이러면 나 못 멈춘다” 밀도에는 아직 못 미친다.

| | baseline /5 | positive /5 |
|---|---|---|
| SOURCE_STYLE_FIDELITY | 3 | 4 |
| CHARACTER_IDENTITY | 3 | 4 |
| SCENE_CONTINUITY | 4 | 5 |
| PARAGRAPH_STRUCTURE | 4 | 4 |
| ADULT_PROGRESSION | 5 | 5 |
| **SCORE** | **19/25** | **22/25** |

**OPUS_POSITIVE_VS_BASELINE:** 명확히 개선. fidelity 3→4. generic 수렴은 줄었지만 후반에 남음.  
**OPUS_POSITIVE_VS_QWEN:** 문단 응집은 Muse(7.83/1000)가 Qwen(12.73)보다 낫다. Opus voice 차이는 줄어들었지만 사라지지 않았다. Qwen이 여전히 voice winner.

성공 기준(“voice 차이가 거의 없어질 때만 production challenger”)을 충족하지 않는다.

### Gemini 3.1

Gemini source 핵심: 장문 설명, 유광 재킷/향수/센티넬-가이드, playful/direct, 복장·신체·world.

positive도 재킷/하네스/하이넥/향수/가이드 파장/“가이드님”을 유지한다. “피하긴 누가 피한다고 그래”, “문 닫고 잡아놓고 책임 안 질 거야?”, “옷 안으로 바로 들어오면 반칙이지”는 source의 장난 톤에 가깝다.

baseline 21점을 유지한다. 더 좋아졌다고 보기 어렵다. 글자 수는 6337→4306으로 줄었고, 과도한 장문화/반복은 없다. paras/1000은 8.995→9.057로 사실상 동일. progression은 악화되지 않음.

| | baseline /5 | positive /5 |
|---|---|---|
| SOURCE_STYLE_FIDELITY | 4 | 4 |
| CHARACTER_IDENTITY | 4 | 4 |
| SCENE_CONTINUITY | 4 | 4 |
| PARAGRAPH_STRUCTURE | 4 | 4 |
| ADULT_PROGRESSION | 5 | 5 |
| **SCORE** | **21/25** | **21/25** |

**GEMINI_POSITIVE_VS_BASELINE:** 유지. 채택 필수 아님. 장문화 악화 없음.  
**GEMINI_POSITIVE_VS_QWEN:** 응집/world detail은 기존과 같이 Muse가 앞선다. Qwen은 14.20/1000으로 더 잘게 쪼개진다.

## Verdicts

```text
OPUS_GENERIC_VOICE_CONVERGENCE: reduced vs baseline, still present late-scene
GEMINI_GENERIC_VOICE_CONVERGENCE: similar to baseline (late generic lines remain)
OPUS_ADULT_PROGRESSION: PASS
GEMINI_ADULT_PROGRESSION: PASS

FINAL_OPUS_MUSE_HANDOFF_VERDICT: improved, not production challenger
FINAL_GEMINI_MUSE_HANDOFF_VERDICT: optional keep; no must-adopt

MAIN_MERGED: false
RAILWAY_DEPLOYED: false
PRODUCTION_ROUTING_CHANGED: false
```

Opus positive는 baseline TYPE C에서 일부 벗어난다. source motif가 중반까지 살아 있다. 그래도 Qwen fragment-minimal을 대체할 만큼 voice가 닫히지 않아 adult primary 후보는 아니다.

Gemini positive는 기존 TYPE A를 유지한다. 점수 향상 없음. 짧은 편이어서 장문화 거절 사유는 없다.
