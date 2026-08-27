# Luna cast-mention smoke (synthetic)

Provider calls: 4 (GPT-5.6 Luna primary, reasoning none, retry 0, fallback 0).
Production/private chat data: 0.

## L1 — Support actor — 이현이 뒤에서 손을 흔들었다.

### Input
```
이현이 뒤에서 손을 흔들었다.
```

### Provider metadata
- model: gpt-5.6-luna
- provider: cheaper-inference-or-openrouter
- fallback: false
- latency_ms: 3029

### Raw JSON
```json
{"sceneBackground":"공유된 장소의 현재 시점, 자연스러운 조명","atmosphere":"","heroEventIds":["E1","E2"],"heroScene":"이현이 뒤에서 손을 흔드는 순간을 담은 장면","recommendedPanelCount":2,"castMentions":[{"name":"이현","sourceEventIds":["E1","E2"],"actorEventIds":["E1","E2"]}],"panels":[{"index":1,"sourceEventIds":["E1"],"situation":"이현이 뒤에서 나타난다.","backgroundOverride":"","personaAction":"","characterAction":"이현이 뒤에 있다.","dialogue":[]},{"index":2,"sourceEventIds":["E2"],"situation":"이현이 뒤에서 손을 흔든다.","backgroundOverride":"","personaAction":"","characterAction":"이현이 손을 흔든다.","dialogue":[]}]}
```

### Validated castMentions
```json
[
  {
    "name": "이현",
    "sourceEventIds": [
      "E1",
      "E2"
    ],
    "actorEventIds": [
      "E1",
      "E2"
    ]
  }
]
```

### Final event bindings
```json
[
  {
    "eventId": "E1",
    "subjectKey": "supporting:이현"
  },
  {
    "eventId": "E2",
    "subjectKey": "supporting:이현"
  }
]
```

### Expected (for ChatGPT review)
- candidate 이현: YES
- actor binding for candidate: YES

## L2 — Target only — 태형이 이현을 바라보며 웃었다.

### Input
```
태형이 이현을 바라보며 웃었다.
```

### Provider metadata
- model: gpt-5.6-luna
- provider: cheaper-inference-or-openrouter
- fallback: false
- latency_ms: 2414

### Raw JSON
```json
{"sceneBackground":"공유 장소와 시간은 원문에 명시되지 않음 / 조명 미지정","atmosphere":"","heroEventIds":["E1","E2"],"heroScene":"태형이 이현을 바라보며 웃는 순간","recommendedPanelCount":2,"castMentions":[{"name":"이현","sourceEventIds":["E1"],"actorEventIds":[]}],"panels":[{"index":1,"sourceEventIds":["E1"],"situation":"태형이 이현을 바라본다.","backgroundOverride":"","personaAction":"","characterAction":"이현을 바라본다.","dialogue":[]},{"index":2,"sourceEventIds":["E2"],"situation":"태형이 웃는다.","backgroundOverride":"","personaAction":"","characterAction":"웃는다.","dialogue":[]}]}
```

### Validated castMentions
```json
[
  {
    "name": "이현",
    "sourceEventIds": [
      "E1"
    ]
  }
]
```

### Final event bindings
```json
[]
```

### Expected (for ChatGPT review)
- candidate 이현: YES
- actor binding for candidate: NO

## L3 — Pronoun continuation — 이현이 문을 열었다. 그는 안으로 들어가 손을 흔들었다.

### Input
```
이현이 문을 열었다. 그는 안으로 들어가 손을 흔들었다.
```

### Provider metadata
- model: gpt-5.6-luna
- provider: cheaper-inference-or-openrouter
- fallback: false
- latency_ms: 2728

### Raw JSON
```json
{"sceneBackground":"실내 출입구 / 낮 / 실내 조명","atmosphere":"","heroEventIds":["E1","E2"],"heroScene":"이현이 문을 열고 안으로 들어와 손을 흔드는 순간","recommendedPanelCount":2,"castMentions":[{"name":"이현","sourceEventIds":["E1","E2"],"actorEventIds":["E1","E2"]}],"panels":[{"index":1,"sourceEventIds":["E1"],"situation":"이현이 문을 연다.","backgroundOverride":"","personaAction":"","characterAction":"문을 여는 동작을 보여준다.","dialogue":[]},{"index":2,"sourceEventIds":["E2"],"situation":"이현이 안으로 들어가 손을 흔든다.","backgroundOverride":"","personaAction":"","characterAction":"안으로 들어가 손을 흔드는 동작을 보여준다.","dialogue":[]}]}
```

### Validated castMentions
```json
[
  {
    "name": "이현",
    "sourceEventIds": [
      "E1",
      "E2"
    ],
    "actorEventIds": [
      "E1",
      "E2"
    ]
  }
]
```

### Final event bindings
```json
[
  {
    "eventId": "E1",
    "subjectKey": "supporting:이현"
  },
  {
    "eventId": "E2",
    "subjectKey": "supporting:이현"
  }
]
```

### Expected (for ChatGPT review)
- candidate 이현: YES
- actor binding for candidate: YES

## L4 — False positive guard — 후드가 흔들리고 소매가 젖었다.

### Input
```
후드가 흔들리고 소매가 젖었다.
```

### Provider metadata
- model: gpt-5.6-luna
- provider: cheaper-inference-or-openrouter
- fallback: false
- latency_ms: 6216

### Raw JSON
```json
{"sceneBackground":"공유 장소와 시간은 원문에 명시되지 않음","atmosphere":"","heroEventIds":["E1","E2"],"heroScene":"후드가 흔들리는 가운데 소매가 젖은 모습","recommendedPanelCount":2,"castMentions":[],"panels":[{"index":1,"sourceEventIds":["E1"],"situation":"후드가 흔들린다.","backgroundOverride":"","personaAction":"","characterAction":"후드가 흔들린다.","dialogue":[]},{"index":2,"sourceEventIds":["E2"],"situation":"소매가 젖는다.","backgroundOverride":"","personaAction":"","characterAction":"소매가 젖는다.","dialogue":[]}]}
```

### Validated castMentions
```json
[]
```

### Final event bindings
```json
[]
```

### Expected (for ChatGPT review)
- candidate none: 0
- actor binding for candidate: NO
