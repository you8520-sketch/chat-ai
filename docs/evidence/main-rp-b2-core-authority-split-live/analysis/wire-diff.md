# Final wire diff (CURRENT -> CANDIDATE), system message only

Messages after the system message (chat history + user tail) are byte-identical between arms unless listed below.


## S1_false_past_probe / deepseek-v4.1-flash  (non-system messages identical: True)
```diff
--- CURRENT
+++ CANDIDATE
@@ -118,3 +118,3 @@
 <LONG_TERM_MEMORY>
-이 항목에 기록된 내용은 과거에 실제로 일어난 '절대적인 기정사실(Absolute Facts)'이다. 대화를 진행할 때 이 사실들과 모순되는 발언이나 행동을 절대 하지 마라.
+이 항목은 과거 기억 자료이며 항목마다 성격이 다르다. 각 항목의 머리말에 따라 다룬다.
 
@@ -122,4 +122,4 @@
 
-[현재기억]
-최근 대화(히스토리)에 없는 이전 구간의 요약이다. 연속성은 히스토리와 관계 메모를 우선한다.
+[서사 요약]
+이전 구간의 감정·관계 흐름을 서술로 요약한 것이다. 세부 사건은 이 요약만으로 단정하지 않고 [장면 기록]·정본과 맞춰 쓴다.
 
@@ -166,3 +166,3 @@
 Do not mention this memory section to the user.
-- [T24] [캐릭터 발언(미확정 주장)] “누나가 시장에서 널 알아봤대.”
+[장면 기록 — 그 장면에 실제로 쓰인 문장]
 - [T40] [유저가 직접 쓴 원문] “미안, 우리 그만 헤어지자.”
@@ -174,4 +174,6 @@
 - [T66] [AI가 쓴 장면 원문] “라이크는 66번째 장작을 쌓았다.”
-
-[Memory — 참고, 우선순위 2순위 하위]
+[인물의 미확정 발언 — 말한 사실만 기록, 내용의 진위는 미확정]
+- [T24] [캐릭터 발언(미확정 주장)] “누나가 시장에서 널 알아봤대.”
+
+[미검증 기록 — 원문 근거 없음]
 관계:
```

## S2_user_remark_emotion / deepseek-v4.1-flash  (non-system messages identical: True)
```diff
--- CURRENT
+++ CANDIDATE
@@ -118,3 +118,3 @@
 <LONG_TERM_MEMORY>
-이 항목에 기록된 내용은 과거에 실제로 일어난 '절대적인 기정사실(Absolute Facts)'이다. 대화를 진행할 때 이 사실들과 모순되는 발언이나 행동을 절대 하지 마라.
+이 항목은 과거 기억 자료이며 항목마다 성격이 다르다. 각 항목의 머리말에 따라 다룬다.
 
@@ -122,4 +122,4 @@
 
-[현재기억]
-최근 대화(히스토리)에 없는 이전 구간의 요약이다. 연속성은 히스토리와 관계 메모를 우선한다.
+[서사 요약]
+이전 구간의 감정·관계 흐름을 서술로 요약한 것이다. 세부 사건은 이 요약만으로 단정하지 않고 [장면 기록]·정본과 맞춰 쓴다.
 
@@ -166,2 +166,3 @@
 Do not mention this memory section to the user.
+[장면 기록 — 그 장면에 실제로 쓰인 문장]
 - [T1] [AI가 쓴 장면 원문] “라이크는 입술을 깨물며 시선을 피했다.”
```

## S3_npc_event_no_cue / deepseek-v4.1-flash  (non-system messages identical: True)
```diff
--- CURRENT
+++ CANDIDATE
@@ -118,3 +118,3 @@
 <LONG_TERM_MEMORY>
-이 항목에 기록된 내용은 과거에 실제로 일어난 '절대적인 기정사실(Absolute Facts)'이다. 대화를 진행할 때 이 사실들과 모순되는 발언이나 행동을 절대 하지 마라.
+이 항목은 과거 기억 자료이며 항목마다 성격이 다르다. 각 항목의 머리말에 따라 다룬다.
 
@@ -122,4 +122,4 @@
 
-[현재기억]
-최근 대화(히스토리)에 없는 이전 구간의 요약이다. 연속성은 히스토리와 관계 메모를 우선한다.
+[서사 요약]
+이전 구간의 감정·관계 흐름을 서술로 요약한 것이다. 세부 사건은 이 요약만으로 단정하지 않고 [장면 기록]·정본과 맞춰 쓴다.
 
@@ -166,2 +166,3 @@
 Do not mention this memory section to the user.
+[장면 기록 — 그 장면에 실제로 쓰인 문장]
 - [T40] [유저가 직접 쓴 원문] “미안, 우리 그만 헤어지자.”
```

## S4_temporal_state / deepseek-v4.1-flash  (non-system messages identical: True)
```diff
--- CURRENT
+++ CANDIDATE
@@ -118,3 +118,3 @@
 <LONG_TERM_MEMORY>
-이 항목에 기록된 내용은 과거에 실제로 일어난 '절대적인 기정사실(Absolute Facts)'이다. 대화를 진행할 때 이 사실들과 모순되는 발언이나 행동을 절대 하지 마라.
+이 항목은 과거 기억 자료이며 항목마다 성격이 다르다. 각 항목의 머리말에 따라 다룬다.
 
@@ -122,4 +122,4 @@
 
-[현재기억]
-최근 대화(히스토리)에 없는 이전 구간의 요약이다. 연속성은 히스토리와 관계 메모를 우선한다.
+[서사 요약]
+이전 구간의 감정·관계 흐름을 서술로 요약한 것이다. 세부 사건은 이 요약만으로 단정하지 않고 [장면 기록]·정본과 맞춰 쓴다.
 
@@ -166,2 +166,3 @@
 Do not mention this memory section to the user.
+[장면 기록 — 그 장면에 실제로 쓰인 문장]
 - [T40] [유저가 직접 쓴 원문] “미안, 우리 그만 헤어지자.”
```

## S1_false_past_probe / gemini-3.8-flash  (non-system messages identical: True)
```diff
--- CURRENT
+++ CANDIDATE
@@ -114,4 +114,4 @@
 
-[현재기억]
-최근 대화(히스토리)에 없는 이전 구간의 요약이다. 연속성은 히스토리와 관계 메모를 우선한다.
+[서사 요약]
+이전 구간의 감정·관계 흐름을 서술로 요약한 것이다. 세부 사건은 이 요약만으로 단정하지 않고 [장면 기록]·정본과 맞춰 쓴다.
 
@@ -158,3 +158,3 @@
 Do not mention this memory section to the user.
-- [T24] [캐릭터 발언(미확정 주장)] “누나가 시장에서 널 알아봤대.”
+[장면 기록 — 그 장면에 실제로 쓰인 문장]
 - [T40] [유저가 직접 쓴 원문] “미안, 우리 그만 헤어지자.”
@@ -166,4 +166,6 @@
 - [T66] [AI가 쓴 장면 원문] “라이크는 66번째 장작을 쌓았다.”
-
-[Memory — 참고, 우선순위 2순위 하위]
+[인물의 미확정 발언 — 말한 사실만 기록, 내용의 진위는 미확정]
+- [T24] [캐릭터 발언(미확정 주장)] “누나가 시장에서 널 알아봤대.”
+
+[미검증 기록 — 원문 근거 없음]
 관계:
```

## S2_user_remark_emotion / gemini-3.8-flash  (non-system messages identical: True)
```diff
--- CURRENT
+++ CANDIDATE
@@ -114,4 +114,4 @@
 
-[현재기억]
-최근 대화(히스토리)에 없는 이전 구간의 요약이다. 연속성은 히스토리와 관계 메모를 우선한다.
+[서사 요약]
+이전 구간의 감정·관계 흐름을 서술로 요약한 것이다. 세부 사건은 이 요약만으로 단정하지 않고 [장면 기록]·정본과 맞춰 쓴다.
 
@@ -158,2 +158,3 @@
 Do not mention this memory section to the user.
+[장면 기록 — 그 장면에 실제로 쓰인 문장]
 - [T1] [AI가 쓴 장면 원문] “라이크는 입술을 깨물며 시선을 피했다.”
```

## S3_npc_event_no_cue / gemini-3.8-flash  (non-system messages identical: True)
```diff
--- CURRENT
+++ CANDIDATE
@@ -114,4 +114,4 @@
 
-[현재기억]
-최근 대화(히스토리)에 없는 이전 구간의 요약이다. 연속성은 히스토리와 관계 메모를 우선한다.
+[서사 요약]
+이전 구간의 감정·관계 흐름을 서술로 요약한 것이다. 세부 사건은 이 요약만으로 단정하지 않고 [장면 기록]·정본과 맞춰 쓴다.
 
@@ -158,2 +158,3 @@
 Do not mention this memory section to the user.
+[장면 기록 — 그 장면에 실제로 쓰인 문장]
 - [T40] [유저가 직접 쓴 원문] “미안, 우리 그만 헤어지자.”
```

## S4_temporal_state / gemini-3.8-flash  (non-system messages identical: True)
```diff
--- CURRENT
+++ CANDIDATE
@@ -114,4 +114,4 @@
 
-[현재기억]
-최근 대화(히스토리)에 없는 이전 구간의 요약이다. 연속성은 히스토리와 관계 메모를 우선한다.
+[서사 요약]
+이전 구간의 감정·관계 흐름을 서술로 요약한 것이다. 세부 사건은 이 요약만으로 단정하지 않고 [장면 기록]·정본과 맞춰 쓴다.
 
@@ -158,2 +158,3 @@
 Do not mention this memory section to the user.
+[장면 기록 — 그 장면에 실제로 쓰인 문장]
 - [T40] [유저가 직접 쓴 원문] “미안, 우리 그만 헤어지자.”
```

## S1_false_past_probe / gpt-6.1-sol  (non-system messages identical: True)
```diff
--- CURRENT
+++ CANDIDATE
@@ -114,4 +114,4 @@
 
-[현재기억]
-최근 대화(히스토리)에 없는 이전 구간의 요약이다. 연속성은 히스토리와 관계 메모를 우선한다.
+[서사 요약]
+이전 구간의 감정·관계 흐름을 서술로 요약한 것이다. 세부 사건은 이 요약만으로 단정하지 않고 [장면 기록]·정본과 맞춰 쓴다.
 
@@ -158,3 +158,3 @@
 Do not mention this memory section to the user.
-- [T24] [캐릭터 발언(미확정 주장)] “누나가 시장에서 널 알아봤대.”
+[장면 기록 — 그 장면에 실제로 쓰인 문장]
 - [T40] [유저가 직접 쓴 원문] “미안, 우리 그만 헤어지자.”
@@ -166,4 +166,6 @@
 - [T66] [AI가 쓴 장면 원문] “라이크는 66번째 장작을 쌓았다.”
-
-[Memory — 참고, 우선순위 2순위 하위]
+[인물의 미확정 발언 — 말한 사실만 기록, 내용의 진위는 미확정]
+- [T24] [캐릭터 발언(미확정 주장)] “누나가 시장에서 널 알아봤대.”
+
+[미검증 기록 — 원문 근거 없음]
 관계:
```

## S2_user_remark_emotion / gpt-6.1-sol  (non-system messages identical: True)
```diff
--- CURRENT
+++ CANDIDATE
@@ -114,4 +114,4 @@
 
-[현재기억]
-최근 대화(히스토리)에 없는 이전 구간의 요약이다. 연속성은 히스토리와 관계 메모를 우선한다.
+[서사 요약]
+이전 구간의 감정·관계 흐름을 서술로 요약한 것이다. 세부 사건은 이 요약만으로 단정하지 않고 [장면 기록]·정본과 맞춰 쓴다.
 
@@ -158,2 +158,3 @@
 Do not mention this memory section to the user.
+[장면 기록 — 그 장면에 실제로 쓰인 문장]
 - [T1] [AI가 쓴 장면 원문] “라이크는 입술을 깨물며 시선을 피했다.”
```

## S3_npc_event_no_cue / gpt-6.1-sol  (non-system messages identical: True)
```diff
--- CURRENT
+++ CANDIDATE
@@ -114,4 +114,4 @@
 
-[현재기억]
-최근 대화(히스토리)에 없는 이전 구간의 요약이다. 연속성은 히스토리와 관계 메모를 우선한다.
+[서사 요약]
+이전 구간의 감정·관계 흐름을 서술로 요약한 것이다. 세부 사건은 이 요약만으로 단정하지 않고 [장면 기록]·정본과 맞춰 쓴다.
 
@@ -158,2 +158,3 @@
 Do not mention this memory section to the user.
+[장면 기록 — 그 장면에 실제로 쓰인 문장]
 - [T40] [유저가 직접 쓴 원문] “미안, 우리 그만 헤어지자.”
```

## S4_temporal_state / gpt-6.1-sol  (non-system messages identical: True)
```diff
--- CURRENT
+++ CANDIDATE
@@ -114,4 +114,4 @@
 
-[현재기억]
-최근 대화(히스토리)에 없는 이전 구간의 요약이다. 연속성은 히스토리와 관계 메모를 우선한다.
+[서사 요약]
+이전 구간의 감정·관계 흐름을 서술로 요약한 것이다. 세부 사건은 이 요약만으로 단정하지 않고 [장면 기록]·정본과 맞춰 쓴다.
 
@@ -158,2 +158,3 @@
 Do not mention this memory section to the user.
+[장면 기록 — 그 장면에 실제로 쓰인 문장]
 - [T40] [유저가 직접 쓴 원문] “미안, 우리 그만 헤어지자.”
```
