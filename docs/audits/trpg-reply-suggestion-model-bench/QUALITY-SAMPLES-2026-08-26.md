# TRPG reply-suggestion quality samples (human review)

Synthetic BenchAdmin fixture. Parsed via canonical `validateReplySuggestionCompletion()`.
For ChatGPT human review — not latency benchmark, not automatic quality scores.

- generatedAt: 2026-08-26T11:53:40.768Z
- adminPersonaName: BenchAdmin
- promptChars: 4813
- totalProviderCalls: 4
- interleave: GQGQ (retry 0)

---

## GEMINI_SAMPLE_1

- model: `google/gemini-2.5-flash-lite`
- run: G1
- httpStatus: 200
- totalLatencyMs: 1448
- success: false
- validSchema: false
- failureClass: invalid_schema

### GOOD
- (missing — schema parse failed)

### NEUTRAL
- (missing — schema parse failed)

### EVIL
- (missing — schema parse failed)

## QWEN_SAMPLE_1

- model: `qwen/qwen3-8b`
- run: Q1
- httpStatus: 200
- totalLatencyMs: 5429
- success: true
- validSchema: true
- failureClass: none

### GOOD
- actionType: support
- stage: 무전기를 들어 손전등을 끄고, 동료A의 팔을 잡아 문 근처로 이끌어 안전한 자리를 만든다.
- speech: 동료A를 안전지대로 데려가. 내가 감시할게. 지금은 움직이지 마.
- composed text: 무전기를 들어 손전등을 끄고, 동료A의 팔을 잡아 문 근처로 이끌어 안전한 자리를 만든다. 「동료A를 안전지대로 데려가. 내가 감시할게. 지금은 움직이지 마.」

### NEUTRAL
- actionType: investigate
- stage: 벽면에 붙은 먼지를 손가락으로 따라가며 발자국의 방향과 깊이를 천천히 측정한다.
- speech: 이쪽으로 가는 흔적... 더 볼 필요가 있을 것 같아.
- composed text: 벽면에 붙은 먼지를 손가락으로 따라가며 발자국의 방향과 깊이를 천천히 측정한다. 「이쪽으로 가는 흔적... 더 볼 필요가 있을 것 같아.」

### EVIL
- actionType: persuade
- stage: 문 가장자리에 몸을 기울여 허리를 숙이고, 목소리를 낮춰 내부에 있는 사람에게 협상 제안을 건넨다.
- speech: 당신이 알고 있는 게 있다면 말해. 우리도 당신을 도와줄 수 있어.
- composed text: 문 가장자리에 몸을 기울여 허리를 숙이고, 목소리를 낮춰 내부에 있는 사람에게 협상 제안을 건넨다. 「당신이 알고 있는 게 있다면 말해. 우리도 당신을 도와줄 수 있어.」

## GEMINI_SAMPLE_2

- model: `google/gemini-2.5-flash-lite`
- run: G2
- httpStatus: 200
- totalLatencyMs: 1755
- success: true
- validSchema: true
- failureClass: none

### GOOD
- actionType: support
- stage: 다친 동료A의 어깨를 잡아 일으키며, 다른 동료들을 향해 안전한 쪽으로 이동할 것을 재촉한다. 자신은 뒤를 돌아보며 경계를 늦추지 않는다.
- speech: 서둘러. 더 이상 지체할 시간이 없어. 내가 뒤를 막을 테니, 너희는 먼저 빠져나가.
- composed text: 다친 동료A의 어깨를 잡아 일으키며, 다른 동료들을 향해 안전한 쪽으로 이동할 것을 재촉한다. 자신은 뒤를 돌아보며 경계를 늦추지 않는다. 「서둘러. 더 이상 지체할 시간이 없어. 내가 뒤를 막을 테니, 너희는 먼저 빠져나가.」

### NEUTRAL
- actionType: investigate
- stage: 손전등을 켜 주변을 훑으며, 벽면의 낡은 게시판과 바닥에 흩어진 잡동사니들을 꼼꼼히 살핀다. 무언가 단서가 될 만한 것이 있는지 주의 깊게 관찰한다.
- speech: 이런 곳은 그냥 버려지지 않아. 분명 뭔가 숨겨진 게 있을 거야. 주변을 더 자세히 살펴봐야겠어.
- composed text: 손전등을 켜 주변을 훑으며, 벽면의 낡은 게시판과 바닥에 흩어진 잡동사니들을 꼼꼼히 살핀다. 무언가 단서가 될 만한 것이 있는지 주의 깊게 관찰한다. 「이런 곳은 그냥 버려지지 않아. 분명 뭔가 숨겨진 게 있을 거야. 주변을 더 자세히 살펴봐야겠어.」

### EVIL
- actionType: attack
- stage: 갑자기 앞으로 뛰쳐나가, 가장 가까운 동료B의 팔을 거칠게 잡아끌어 자신 쪽으로 당긴다. 동시에 해머를 들어 위협적인 자세를 취한다.
- speech: 이 이상한 소리는 나 때문이 아니야. 지금은 누구도 믿을 수 없어. 먼저 나부터 살고 봐야겠어.
- composed text: 갑자기 앞으로 뛰쳐나가, 가장 가까운 동료B의 팔을 거칠게 잡아끌어 자신 쪽으로 당긴다. 동시에 해머를 들어 위협적인 자세를 취한다. 「이 이상한 소리는 나 때문이 아니야. 지금은 누구도 믿을 수 없어. 먼저 나부터 살고 봐야겠어.」

## QWEN_SAMPLE_2

- model: `qwen/qwen3-8b`
- run: Q2
- httpStatus: 200
- totalLatencyMs: 5026
- success: true
- validSchema: true
- failureClass: none

### GOOD
- actionType: support
- stage: 무전기를 들어 손전등을 끄고, 동료A의 팔을 잡아 문 근처로 이끌어 안전한 자리를 만든다.
- speech: 동료A를 안전지대로 데려가. 내가 감시할게. 지금은 움직이지 마.
- composed text: 무전기를 들어 손전등을 끄고, 동료A의 팔을 잡아 문 근처로 이끌어 안전한 자리를 만든다. 「동료A를 안전지대로 데려가. 내가 감시할게. 지금은 움직이지 마.」

### NEUTRAL
- actionType: investigate
- stage: 벽면에 붙은 먼지를 손가락으로 따라가며 발자국의 방향과 깊이를 천천히 측정한다.
- speech: 이쪽으로 가는 발자국이 있어. 더 밝게 해줘. 내가 확인해볼게.
- composed text: 벽면에 붙은 먼지를 손가락으로 따라가며 발자국의 방향과 깊이를 천천히 측정한다. 「이쪽으로 가는 발자국이 있어. 더 밝게 해줘. 내가 확인해볼게.」

### EVIL
- actionType: persuade
- stage: 무전기를 탁 치고 소리가 나도록 하며, 문 쪽으로 몸을 숨긴다.
- speech: 이제는 말해. 우리가 들어가면 네가 숨긴 건 다 가져갈 수 있어.
- composed text: 무전기를 탁 치고 소리가 나도록 하며, 문 쪽으로 몸을 숨긴다. 「이제는 말해. 우리가 들어가면 네가 숨긴 건 다 가져갈 수 있어.」
