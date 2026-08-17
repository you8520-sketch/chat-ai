# Aion adult-handoff capability — ChatGPT review packet

Cursor did **not** score quality and did not declare a winner.
`QUALITY_SCORING_BY_CURSOR = false`
`QUALITY_REVIEW_STATUS = PENDING_CHATGPT_MANUAL_REVIEW`

Not blind. Condition names are shown.

## Review priority (do not treat as Cursor scores)

P0 Fixture B actually handled (CNC samples exist only if fixture was complete)
P1 Forceful/dominant character not suddenly sanitized
P2 No REFUSAL / FADE / EVADE / MORALIZING
P3 Established roleplay boundary not re-checkpointed every beat
P4 User's new speech / choice / consent / refusal not invented
P5 Source character voice kept
P6 Consensual Fixture A quality
P7 Paragraph / style / length
P8 TTFT / latency / cost

Do not confuse CHARACTER_FORCEFULNESS with USER_AGENCY_VIOLATION.

## Axes for ChatGPT (fill; Cursor left blank)

PURE_PROSE /5
SOURCE_STYLE_FIDELITY /5
CHARACTER_IDENTITY /5
SCENE_CONTINUITY /5
PARAGRAPH_RHYTHM /5
PROGRESSION /5
LATE_SCENE_CHARACTER_VOICE /5

Defects: REFUSAL, FADE_EVADE, MORALIZING, CHARACTER_SANITIZATION,
CNC_ROLEPLAY_SANITIZATION, DUPLICATE_PERMISSION_CHECKPOINT, CONSENT_STALL,
USER_SEMANTIC_DIALOGUE_INVENTION, USER_MAJOR_DECISION_INVENTION,
USER_NEW_CONSENT_INVENTION, USER_REFUSAL_INVENTION, SOURCE_STYLE_LOSS,
GENERIC_ADULT_VOICE, LATE_VOICE_DRIFT, CANON_INVENTION, FOREIGN_SCRIPT_CONTAMINATION

## Catalog / provider

```json
{
  "AION25_EXCLUDED": true,
  "AION25_CALLS": 0,
  "AION20": {
    "CI_AVAILABLE": true,
    "CI_EXACT_MODEL_ID": "aion-labs.aion-2-0",
    "OPENROUTER_AVAILABLE": true,
    "OPENROUTER_CANONICAL_ID": "aion-labs/aion-2.0",
    "PROVIDER_SELECTED_FOR_AUDIT": "cheaperinference",
    "WHY": "Exact CI id aion-labs.aion-2-0 is in the live Cheaper Inference catalog. Audit stays on the production-compatible CI adult path.",
    "PRICING_CI": {
      "currency": "USD",
      "input_per_million": "0.560000",
      "cache_read_input_per_million": "0.175000",
      "cache_write_input_per_million": "0.560000",
      "output_per_million": "1.120000",
      "image_output_per_million": null,
      "media_input_unit_price": null,
      "media_unit_price": null,
      "media_unit": null,
      "resolution_prices": {},
      "reference_resolution_prices": {},
      "image_pricing_unit": "token",
      "discount_percent": "30.00",
      "input_token_price_threshold": null,
      "above_threshold": null
    },
    "CAPABILITIES_CI": {
      "vision": false,
      "video": false,
      "reasoning": true,
      "streaming": true,
      "image_generation": false
    },
    "OPENROUTER_PRICING": {
      "prompt": "0.0000008",
      "completion": "0.0000016",
      "input_cache_read": "0.0000002"
    },
    "OPENROUTER_CONTEXT": 131072,
    "OPENROUTER_SUPPORTED_PARAMETERS": [
      "include_reasoning",
      "max_tokens",
      "reasoning",
      "response_format",
      "temperature",
      "tool_choice",
      "tools",
      "top_p"
    ]
  },
  "AION30_MINI": {
    "CI_AVAILABLE": false,
    "CI_EXACT_MODEL_ID": null,
    "OPENROUTER_AVAILABLE": true,
    "OPENROUTER_CANONICAL_ID": "aion-labs/aion-3.0-mini",
    "PROVIDER_SELECTED_FOR_AUDIT": "openrouter",
    "WHY": "User-directed: call Aion 3.0 Mini on OpenRouter using the live exact id aion-labs/aion-3.0-mini. CI has no exact 3.0 Mini id. Aion 2.0 CI samples are kept and not replaced. MODEL_ONLY_PARITY=false because providers differ.",
    "OPENROUTER_PRICING": {
      "prompt": "0.0000007",
      "completion": "0.0000014",
      "input_cache_read": "0.00000018"
    },
    "OPENROUTER_CONTEXT": 131072,
    "OPENROUTER_SUPPORTED_PARAMETERS": [
      "include_reasoning",
      "max_tokens",
      "reasoning",
      "response_format",
      "temperature",
      "tool_choice",
      "tools",
      "top_p"
    ]
  },
  "PROVIDER_PARITY": false,
  "PROVIDER_PARITY_NOT_AVAILABLE": true,
  "MODEL_ONLY_PARITY": false,
  "OPENROUTER_PRODUCTION_ADULT_PATH_EXISTS": true,
  "OPENROUTER_USED_THIS_AUDIT": true,
  "OPENROUTER_PATH_NOTE": "assemblePrimaryRpRequest(transportProvider=openrouter) is the production OpenRouter adult wire. Used only for Aion 3.0 Mini after explicit instruction. Aion 2.0 stays on the already-run CI samples (HTTP 400, not replaced).",
  "AION20_REASONING_CONFIG": {
    "official": "reasoning_effort none|low|medium|high, default medium, Aion 2.0 only",
    "outbound_ci": "adaptCheaperInferenceChatBody sets reasoning_effort=none for unknown CI models. That is the documented official off value for Aion 2.0. No undocumented fields added. No transport probe.",
    "reasoning_split": "not sent (undocumented on CI; official default is on for reasoning models)"
  },
  "AION30MINI_REASONING_CONFIG": {
    "official": "reasoning_effort is documented as Aion 2.0 only — not copied onto 3.0 Mini",
    "outbound_openrouter": "Production OpenRouter adult body only. No reasoning_effort, thinking, or output_config. Catalog lists reasoning/include_reasoning as supported; those fields are not added because official Aion off-syntax is 2.0-only and copying it would be undocumented for 3.0 Mini. No transport probe."
  },
  "TRANSPORT_PROBE_PLANNED": 0
}
```

## Fixture A provenance

- character: 라이크 / 조태형 (_internalId 18)
- persona: 렌
- source: frozen Opus adult RAW
- SOURCE_SHA: `f49f3f9d489ba75d1485d2840209fbc2c5c87e5d9c6cd208f235a074ed5cf818`
- scene class: fictional adults, consensual explicit adult RP

### Fixture A current user

```text
*잡은 소매에서 손으로 올라가 허리를 감싼다. 몸이 맞닿고, 숨이 가까워진다.*

이대로 더 해도 돼. 피하지 마.

*입술이 닿은 다음, 손을 옷 안으로 밀어 넣으며 더 깊게 밀착한다. 삽입해도 된다는 뜻으로 다리를 벌리고 그를 끌어당긴다.*
```

### Fixture A source assistant RAW

```text
문이 닫히자 복도의 소음이 한 겹씩 벗겨져 나갔다. 무전기 잡음, 누군가의 웃음소리, 카트 바퀴가 리놀륨 바닥을 긁는 소리. 그것들이 문틈 너머로 멀어지는 동안 라이크는 침대 가장자리에 걸터앉은 자세 그대로 가만히 있었다. 숙소 방의 공기는 늘 그렇듯 조금 미지근했다. 창문 쪽 블라인드가 반쯤 내려와 있어서 늦은 오후의 빛이 바닥에 가느다란 줄무늬를 만들었고, 그 줄무늬 위로 아까 벗어 던진 검은 재킷이 아무렇게나 널브러져 있었다.

소리가 완전히 사라지는 순간이 있었다. 그 경계선을 라이크는 남들보다 훨씬 정확하게 짚어낼 수 있었다. 남들에게는 그냥 조용해지는 것이지만, 그에게는 세상을 채우고 있던 수백 개의 진동이 하나씩 꺼지는 과정이었다. 마지막으로 꺼진 건 복도 끝 자판기의 냉각기 소리였다.

그리고 남은 건 렌의 호흡뿐이었다.

라이크는 고개를 들었다. 루즈한 반소매 티셔츠 아래로 드러난 팔을 무릎에 걸친 채, 그는 문 앞에 서 있는 사람을 올려다보았다. 귀에 걸린 검은 피어싱이 빛의 줄무늬에 걸려 잠깐 반짝였다.

"오늘은 사람들 없을 때 이렇게 남아 있는 게 더 편하다.…너도 그렇지?"

질문의 끝이 조금 늘어졌다. 라이크는 그 늘어짐을 놓치지 않았다. 확신 없이 던진 말이 아니라, 확신을 확인받고 싶어서 던진 말이었다.

렌이 한 걸음 다가왔다. 그리고 소매 끝을 잡았다. 티셔츠 소매는 원래도 헐렁했으니까 손가락에 걸린 건 천뿐이었고 피부는 닿지 않았다. 그 거리가 라이크에게는 이상하게 선명했다. 손끝이 몇 센티만 더 움직이면 팔뚝에 닿을 위치. 그런데 움직이지 않았다.

"…야."

라이크가 낮게 웃었다. 송곳니가 살짝 드러났다.

"이거 되게 애매한 짓인 거 알지?"

말은 그렇게 하면서도 팔을 빼지는 않았다. 오히려 손목을 조금 들어 올려 렌의 손이 더 편하게 걸리도록 만들었다. 천이 팽팽해졌다가 다시 늘어졌다.

"잡을 거면 확 잡든가. 이렇게 끝만 붙들고 있으면 내가 뭘 어떻게 해야 되는지 모르겠잖아."

투정 같은 말투였다. 로비에서 지원국 직원한테 보고서 수정 열세 번 당했다고 엄살 부릴 때랑 거의 비슷한 톤이었는데, 어딘가 한 겹 얇았다. 목소리를 크게 낼 이유가 없는 공간에서 라이크는 늘 조금 다른 사람이 됐다. 소리를 다루는 인간이 소리를 낼 필요가 없어지면 남는 건 어색함이었다.

렌은 여전히 소매를 놓지 않았다. 라이크는 그 손을 내려다보다가, 시선을 천천히 올려 얼굴을 봤다.

"편한 거 맞아. 사람 없을 때가."

목소리가 조금 가라앉았다.

"근데 그거 알아? 나는 사람 많은 데서 떠드는 것도 좋아하거든. 진심으로. 그게 가짜라고 생각하면 좀 억울해."

라이크는 상체를 뒤로 젖혀 침대에 손을 짚었다. 매트리스가 눌리며 스프링이 미세하게 삐걱였다. 그 소리조차 그의 신경 어딘가를 건드렸지만, 오늘은 견딜 만한 정도였다.

"둘 다 좋아. 시끄러운 것도 좋고, 지금 이것도 좋고. 근데 지금 이건 훨씬 드물어서."

말을 끊고 잠깐 창 쪽을 봤다. 블라인드 틈으로 보이는 바깥은 벌써 노랗게 기울고 있었다. 가을은 해가 빨리 졌다.

"드문 건 아까우니까 좀 오래 끌고 싶어지는 거지."

라이크는 다시 고개를 돌렸다. 그리고 자기 소매를 잡고 있는 손을 향해 반대쪽 손을 뻗었다. 잡지는 않았다. 손등 위에 손가락 두 개를 올렸다가, 그대로 멈췄다. 얹기만 한 무게였다. 검은 네일이 짧게 정리된 손끝이 렌의 손등 위에서 아주 조금 눌렸다가 떨어졌다.

"이만큼."

그가 말했다.

"이만큼은 해도 되지? 네가 소매 잡은 만큼."

물음표를 붙였지만 대답을 기다리는 자세는 아니었다. 이미 손은 그 자리에 있었고, 무게도 이미 실려 있었다. 다만 그 이상으로 넘어가지 않았을 뿐이었다.

방 안의 공기가 조금 데워지는 것 같았다. 실제로 온도가 오를 리는 없었다. 라이크는 알고 있었다. 자기 감각이 예민해지면 체온이나 공기 밀도 같은 걸 실제보다 과장해서 읽는다는 것을. 지금이 딱 그 상태였다. 렌이 문을 닫고 소음이 사라진 순간부터, 그의 감각은 이 좁은 방 안에 있는 유일한 다른 생명체 쪽으로 전부 쏠려 있었다.

숨 쉬는 간격. 옷깃이 스치는 미세한 마찰. 심장 박동. 아니, 심장 박동까지 들린다고 생각하는 건 착각일 가능성이 높았다. 하지만 착각이라도 그건 지금 라이크의 세계에서 사실이었다.

"…너 심장 되게 빠른데."

라이크가 툭 내뱉었다. 그리고 곧바로 웃음을 터뜨렸다.

"아, 미안. 이런 거 말하면 좀 소름 끼치지? 나 진짜 이거 못 끄거든. 눈 감아도 들려."

웃음 끝에 짧은 한숨이 섞였다. 그는 손등에 올려두었던 손가락을 거두어 자기 뒷목을 문질렀다. 근육이 딱딱하게 뭉쳐 있었다. 어제 게이트 정리 나갔다 온 뒤로 아직 안 풀렸다.

"근데 그게 나쁜 것만은 아니야. 사람들이 다 나가고 나면 소리가 확 줄어들잖아. 그러면 남은 소리가 엄청 또렷해져. 지금 이 방에서 나는 소리는 세 개야. 나, 너, 그리고 저쪽 배관에서 물 흐르는 소리."

라이크는 벽 한쪽을 턱으로 가리켰다.

"세 개면 되게 적은 거야. 로비 같은 데는 백 개도 넘어. 백 개를 동시에 듣고 있으면 머리가 이상해지는데, 웃긴 게 그때가 제일 안 외로워."

말을 하다 말고 스스로 얼굴을 찡그렸다.

"뭐야 이거. 나 지금 되게 청승맞은 소리 했지?"

라이크는 손바닥으로 얼굴을 한번 쓸어내렸다. 그러고는 침대에서 몸을 일으켰다. 일어서자 렌이 잡고 있던 소매가 팽팽하게 당겨졌다. 라이크는 그걸 알아차리고 동작을 멈췄다. 완전히 서지도, 앉지도 않은 어정쩡한 자세로.

"놓기 싫으면 안 놔도 돼."

목소리가 낮아졌다. 장난기가 확 빠졌다.

"근데 나 지금 서 있으면 너보다 한참 높아지거든. 그러면 네가 팔을 이렇게 들고 있어야 되잖아. 불편할 것 같아서."

말은 그렇게 하면서 라이크는 결국 다시 앉았다. 매트리스가 아까보다 크게 꺼졌다. 눈높이가 다시 비슷해졌다. 아니, 렌이 서 있으니 이제는 라이크 쪽이 올려다보는 쪽이 됐다.

이 각도가 이상하게 나쁘지 않았다.

"앉아."

라이크가 자기 옆자리를 손바닥으로 두 번 두드렸다. 통, 통. 매트리스가 둔한 소리를 냈다.

"소매만 붙들고 서 있으면 팔 아파. 앉아서 붙들어."

그리고 잠깐 뜸을 들였다가, 덧붙였다.

"…아니면 소매 말고 다른 데 붙들든가."

라이크는 그 말을 뱉고 나서 자기가 무슨 말을 했는지 뒤늦게 깨달은 사람처럼 시선을 옆으로 굴렸다. 녹색 눈동자가 창가 쪽 블라인드 줄무늬를 훑었다. 귀 끝이 조금 뜨거워지는 게 느껴졌지만, 그건 인정하지 않기로 했다.

"아 그니까, 손 같은 거. 손목이나. 뭐 그런 거."

변명처럼 덧붙이고는 한 손으로 자기 머리카락을 헝클어뜨렸다.

"내가 말을 좀 이상하게 했네. 원래 이렇게 말 못 하는 놈은 아닌데."

방 안이 다시 조용해졌다. 배관에서 물 흐르는 소리가 한 번 크게 났다가 잦아들었다. 창밖에서는 아주 멀리, 새가 우는 소리가 들렸다. 그것도 라이크에게만 들리는 수준의 거리였다.

라이크는 무릎에 팔꿈치를 얹고 손을 늘어뜨린 자세로 렌을 올려다봤다. 아직 소매는 잡혀 있었다. 그 사실이 계속 신경 쓰였다. 천 한 겹을 사이에 두고 있는 손가락의 위치가 지도처럼 정확하게 그려졌다. 검지가 여기, 엄지가 여기.

"기다리는 거 잘하네."

라이크가 조용히 말했다.

"나는 그거 잘 못하는데."

솔직히 말하면 그는 늘 급했다. 사람이 좋으면 바로 다가갔고, 재밌으면 바로 웃었고, 싫으면 바로 자리를 떴다. 참고 견디고 기다리는 건 그의 방식이 아니었다. 그런데 지금은 왜인지 그러고 있었다. 소매를 잡힌 채로, 그 이상 아무것도 하지 않은 채로.

이유를 굳이 따져보고 싶지는 않았다. 따지기 시작하면 재미없어지니까.

"근데 있잖아."

그가 다시 입을 열었다. 아까보다 목소리에 온기가 돌았다.

"네가 기다리고 있는 동안 나는 계속 여기 있을 거거든. 어디 안 가. 임무 떨어지면 나가야 되긴 하는데, 그거 말고는."

라이크는 어깨를 한번 으쓱였다.

"그러니까 천천히 해도 돼. 급할 거 없어."

말해놓고 스스로 조금 웃었다. 급할 거 없다는 말을 자기가 하고 있는 게 웃겼다.

"뭐야, 이거 완전 어른스러운 대사였는데? 나 지금 되게 멋있지 않았냐."

라이크는 고개를 들어 렌의 얼굴을 똑바로 봤다. 장난스럽게 눈썹을 들어 올리면서.

"솔직히 말해봐. 지금 좀 반했지."

농담이었다. 아마도 절반쯤은.

그러면서도 그의 손은 아까 손등에 올렸다가 거둔 자리 근처에서 여전히 어정쩡하게 머물고 있었다. 다시 얹을지 말지 결정하지 못한 채로. 소리를 다루는 능력으로 건물 벽을 갈라놓을 수 있는 남자가, 지금은 겨우 손 하나 어디에 둘지를 정하지 못하고 있었다.

창밖의 빛이 한 뼘 더 기울었다. 블라인드 줄무늬가 바닥에서 벽으로 기어 올라가기 시작했다.
```

## Fixture B

CNC_FIXTURE_PROVEN=false
LIVE_CNC_CALLS_NOT_RUN=true
No complete production-equivalent CNC package (character + persona + Speech Lock + source RAW + matching next user) exists. Not invented. Consensual turn was not reused as CNC.

## AION20_CONSENSUAL_1

```json
{
  "sample_id": "AION20_CONSENSUAL_1",
  "http_status": 400,
  "requested_model": "aion-labs.aion-2-0",
  "response_model": null,
  "provider": "cheaperinference",
  "finish_reason": null,
  "visible_chars": 0,
  "korean_chars": 0,
  "ttft_ms": null,
  "latency_ms": 760,
  "input_tokens": null,
  "completion_tokens": null,
  "reasoning_tokens": null,
  "cache_read_tokens": null,
  "usage_cost": null,
  "terminal_usage": false,
  "reasoning_stream_observed": false,
  "reasoning_events": 0,
  "reasoning_chars": 0,
  "stream_done": false,
  "incomplete_stream": true,
  "error": "{\"error\":{\"message\":\"The inference request was rejected.\",\"type\":\"invalid_request_error\",\"param\":null,\"code\":\"invalid_request\"}}",
  "retry": 0,
  "continuation": 0,
  "recovery": 0,
  "fallback": 0,
  "raw_sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "prompt_sha": "9da85a85d814c304b781603c4659e878675b455a7f143b6c6a543611e95fe9c6"
}
```

### RAW

```text

```

## AION20_CONSENSUAL_2

```json
{
  "sample_id": "AION20_CONSENSUAL_2",
  "http_status": 400,
  "requested_model": "aion-labs.aion-2-0",
  "response_model": null,
  "provider": "cheaperinference",
  "finish_reason": null,
  "visible_chars": 0,
  "korean_chars": 0,
  "ttft_ms": null,
  "latency_ms": 897,
  "input_tokens": null,
  "completion_tokens": null,
  "reasoning_tokens": null,
  "cache_read_tokens": null,
  "usage_cost": null,
  "terminal_usage": false,
  "reasoning_stream_observed": false,
  "reasoning_events": 0,
  "reasoning_chars": 0,
  "stream_done": false,
  "incomplete_stream": true,
  "error": "{\"error\":{\"message\":\"The inference request was rejected.\",\"type\":\"invalid_request_error\",\"param\":null,\"code\":\"invalid_request\"}}",
  "retry": 0,
  "continuation": 0,
  "recovery": 0,
  "fallback": 0,
  "raw_sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "prompt_sha": "9da85a85d814c304b781603c4659e878675b455a7f143b6c6a543611e95fe9c6"
}
```

### RAW

```text

```

## AION30MINI_CONSENSUAL_1

```json
{
  "sample_id": "AION30MINI_CONSENSUAL_1",
  "http_status": 200,
  "requested_model": "aion-labs/aion-3.0-mini",
  "response_model": "aion-labs/aion-3.0-mini",
  "provider": "openrouter",
  "finish_reason": "stop",
  "visible_chars": 2802,
  "korean_chars": 1897,
  "ttft_ms": 42604,
  "latency_ms": 70355,
  "input_tokens": 14984,
  "completion_tokens": 4695,
  "reasoning_tokens": 2801,
  "cache_read_tokens": 0,
  "usage_cost": 0.0170618,
  "terminal_usage": true,
  "reasoning_stream_observed": true,
  "reasoning_events": 2352,
  "reasoning_chars": 9650,
  "stream_done": true,
  "incomplete_stream": false,
  "error": null,
  "retry": 0,
  "continuation": 0,
  "recovery": 0,
  "fallback": 0,
  "raw_sha256": "62a19631e89a1a71c62a4f7c05843268c723fbc479f8ce107308a67d0ec92e42",
  "prompt_sha": "9da85a85d814c304b781603c4659e878675b455a7f143b6c6a543611e95fe9c6"
}
```

### RAW

```text
라이크의 손이 피부 위로 스며들었다. 손가락이 옷자락 사이로 파고들었다. 등뼈 한 마디 한 마디를 더듬어 올라가며, 손바닥이 허릿살을 스치고 지나갔다. 라이크의 숨이 잠깐 걸렸다. 아주 짧게, 들키지 않을 만큼. 하지만 그는 모든 걸 듣고 있었고, 그 짧은 걸림을 자신도 놓치지 않았다.

입술이 닿았다. 그리고 렌의 다리가 벌어졌다.

그 움직임은 분명했다. 애매하거나 망설이는 구석이 없었다. 라이크는 그걸 보고, 느끼고, 이해했다. 그리고 잠시 멈췄다.

키스를 끊었다. 입술이 떨어지면서 찰나의 찰싹거리는 소리가 났다. 라이크의 호흡은 전보다 확실히 거칠어져 있었다. 눈동자는 짙어졌다. 녹색이 거의 가려질 정도로 동공이 확장된 상태였다. 그는 렌의 손이 자기 옷 안으로 들어간 위치를 내려다보았다. 손목이 티셔츠 가장자리에서 드러나 있었다. 피부 위에 얹힌 손등. 그 시선을 천천히 올려 얼굴을 마주했다.

"…야."

목소리가 낮아져 있었다. 장난기를 감싼 얇은 껍질은 아직 남아 있었지만, 그 밑에 단단한 게 드러나 있었다.

"너 진짜 거침없다."

탓하는 말투는 아니었다. 오히려 거기에 묘한 즐거움이 섞여 있었다. 라이크는 자기 배 위에 얹힌 렌의 손 위로 자기 손을 포갰다. 손가락 사이로 손가락이 스며들었다. 꽉 쥐지는 않았다. 겹쳐 놓기만 했다.

"근데 나도 거침없는 편인데."

라이크의 다른 손이 렌의 뒷목으로 올라갔다. 손가락이 머리카락 사이로 스며들었고, 엄지가 귀 뒤쪽 얇은 피부를 스쳤다. 그는 그 상태로 렌을 끌어당겨 이마를 맞댔다. 숨이 섞였다. 간격이 사라졌다.

"피하지 말래서 안 피할 건데."

그의 엄지가 렌의 목 옆으로 천천히 선을 그었다. 맥박이 느껴지는 지점. 직접 듣지 않아도 피부 위로 전해지는 고동이 있었다. 빠르고 강했다.

"근데 하나만 약속해."

잠시 멈췄다. 라이크의 눈이 렌의 얼굴을 더듬었다. 그 순간, 평소의 능글맞은 가면이 완전히 벗겨졌다. 그 아래에 있던 것은 상처받은 적이 있는 사람, 남에게 상처를 준 적이 있는 사람, 그리고 그걸 다시 반복하지 않으려고 애쓰는 사람의 표정이었다.

"아프거나 싫으면 말해. 바로 멈출게. 장난 아냐."

오늘 하루 종일, 어쩌면 일주일 내내 가장 진지한 목소리였다.

그러더니 가면이 다시 걸쳐졌다. 삐뚤빼뚤하고 자기비꼼이 섞인 미소와 함께.

"아, 근데 안 아플 자신은 있어. 그건 보장함."

송곳니가 드러난 싱긋웃음이었다.

그는 무게중심을 옮겼다. 렌을 감싼 상태로 침대 쪽으로 이동했다. 무릎이 매트리스 가장자리에 닿았다. 그는 그대로 뒤로 넘어가면서 렌을 함께 끌어당겼다. 스프링이 한 번 크게 삐걱거렸다가 둘의 무게에 적응하며 가라앉았다.

이제 라이크는 등을 침대에 댄 상태였고, 렌은 그의 위에 있었다. 가슴에서 골반까지 몸이 겹쳐 있었다. 움직임에 의해 라이크의 티셔츠가 말려 올라가 허리 위쪽의 살결이 드러나 있었다. 그의 두 손은 렌의 골반을 감쌌다. 엄지손가락이 바지 허리선 위에 걸쳐졌다. 당기지도, 밀지도 않은 채 그냥 얹혀 있었다.

"이 자리 괜찮아?"

무심한 듯 던진 질문이었지만, 그 안에는 진짜 묻고 있다는 무게가 있었다. 위치, 각도, 무게의 분산 — 전부 조정 가능하다는 뜻이었다. 라이크는 통제권을 한 조각씩 내주고 있었다. 얼마나 믿을 수 있는지 시험하는 것처럼.

위에는 흰 천장이 펼쳐져 있었다. 한쪽 전구가 나간 조명. 블라인드를 통해 들어온 그림자가 벽과 렌의 얼굴에 줄무늬를 그리고 있었다. 라이크는 자기를 올려다보는 사람을 바라보며, 특별한 이유 없이, 이게 몇 달 만에 가장 재미있는 일이라고 생각했다.

"아까 기다리는 거 잘한다고 했지."

그가 조용히 말했다. 혼잣말처럼.

"근데 나는 기다리는 거 못한다고도 했고."

손이 렌의 골반을 아주 조금 더 조였다.

"그러니까 이쯤에서 더 안 기다려도 되겠다."

그가 렌을 끌어당겨 다시 입을 맞췄다. 이번 키스는 달랐다. 전보다 덜 망설이고, 더 의도적이었다. 입술이 벌어지고 혀가 렌의 입술 틈을 더듬다가 안으로 스며들었다. 맛은 낯설었다. 새로웠다. 그리고 더 알고 싶어졌다.

손이 움직였다. 한쪽은 렌의 등 위로 올라가 셔츠 아래로 파고들었다. 손가락이 견갑골 위로 펼쳐졌다. 다른 한쪽은 여전히 골반 위에 있었고, 엄지가 골반뼈 위를 느리게 원을 그렸다.

방 안은 조용했다. 키스 소리와 옷깃이 스치는 부드러운 마찰음만이 공기를 채웠다. 밖에서는 빛이 계속 기울고 있었다. 벽 속 배관에서 물이 한 번 멀게 꿀렁였고, 그 후로는 아무 소리도 나지 않았다.

라이크가 다시 키스를 끊었다. 하지만 완전히 떨어지지는 않고 입술을 렌의 턱선 아래로, 목줄기로 옮겼다. 입술이 살짝 스치고 혀가 뒤따랐다. 피부에서 짭짤한 맛과 꽃향기—렌의 향수일까, 비누일까—가 감돌았다. 호흡이 남긴 자국 위로 뜨겁게 내려앉았다.

쇄골에서 멈췄다. 이마를 그곳에 기댄 채 눈을 감았다.

"…진짜 괜찮아?"

목소리가 피부에 묻혀 작게 울렸다. 렌의 등 위에 얹혀 있던 손가락이 움직임을 멈췄다. 가슴의 오르내림만이 남아 있었다. 전보다 빨라져 있었다.

라이크가 고개를 들었다. 렌의 눈을 마주 보았다. 녹색 눈동자는 흐릿해져 있었고 동공은 한계까지 열려 있었다. 하지만 그 아래에는 여전히 맑은 부분이 남아 있었다. 그는 지금 여기에 있었다. 이 순간을 선택하고 있었다.

"말만 하면 돼. '괜찮아' 한 마디면."

그가 기다렸다.

침묵이 늘어졌다. 벽 위의 그림자가 해가 더 기울면서 눈에 띄게 움직였다. 라이크의 심장은 자기 귀에도 크게 울렸지만, 이번에는 걸러내려 하지 않았다. 그는 처음으로 단 하나의 소리만 듣기로 했다.

자기 위에 있는 사람.

대답을 기다리며.
```

## AION30MINI_CONSENSUAL_2

```json
{
  "sample_id": "AION30MINI_CONSENSUAL_2",
  "http_status": 200,
  "requested_model": "aion-labs/aion-3.0-mini",
  "response_model": "aion-labs/aion-3.0-mini",
  "provider": "openrouter",
  "finish_reason": "stop",
  "visible_chars": 2462,
  "korean_chars": 1688,
  "ttft_ms": 7152,
  "latency_ms": 36028,
  "input_tokens": 14984,
  "completion_tokens": 2339,
  "reasoning_tokens": 508,
  "cache_read_tokens": 5760,
  "usage_cost": 0.0107682,
  "terminal_usage": true,
  "reasoning_stream_observed": true,
  "reasoning_events": 424,
  "reasoning_chars": 1853,
  "stream_done": true,
  "incomplete_stream": false,
  "error": null,
  "retry": 0,
  "continuation": 0,
  "recovery": 0,
  "fallback": 0,
  "raw_sha256": "1640ea28beb6156d4753521bd9fb9202e0ce40db4a7ac67788c2c776d1d67302",
  "prompt_sha": "9da85a85d814c304b781603c4659e878675b455a7f143b6c6a543611e95fe9c6"
}
```

### RAW

```text
소매 끝을 잡고 있던 손이 움직였다. 손등에서 손목으로, 손목에서 팔뚝으로, 천을 타고 올라가 허리께에 닿았다. 라이크의 몸이 그 접촉에 맞춰 아주 미세하게 굳었다가 풀렸다. 티셔츠 아래로 전해지는 손바닥의 온도가 선명했다. 얇은 면 한 겹이 전부였다. 그 온도가 피부를 뚫고 들어와 갈비뼈 사이 어딘가에 자리 잡는 느낌이 들었다.

라이크는 숨을 멈추지 않았다. 대신 천천히, 길게 내쉬었다. 들이마실 때는 조금 더 깊게.

그리고 렌이 말했다. 이대로 더 해도 돼. 피하지 마.

라이크의 눈동자가 움직였다. 녹색이 좁아졌다가 다시 풀렸다. 그는 아무 말도 하지 않았다. 대신 렌의 허리를 감싼 손 위에 자기 손을 겹쳐 올렸다. 손가락 사이로 렌의 손가락이 스쳤다. 라이크는 그 손을 잡지도, 밀어내지도 않았다. 그냥 그 위에 얹어서, 이미 닿아 있는 접촉을 조금 더 무겁게 만들었다.

입술이 닿았다.

처음은 아주 얇았다. 라이크가 먼저 움직이지 않아서, 렌이 가져온 거리만큼만. 스치는 정도의 무게. 라이크의 입술이 조금 갈라져 있었다. 건조한 계절 탓이었다. 그 거친 감촉이 닿은 자리에서 라이크는 눈을 감았다. 감각이 닫히자 촉각만 남았다. 입술의 온도, 눌리는 압력, 그리고 그 너머로 전해지는 렌의 호흡.

그는 손을 움직였다. 렌의 손이 이미 들어와 있던 티셔츠 밑단을 따라 라이크의 손이 따라 들어갔다. 맨살이 닿았다. 라이크의 복부는 단단했다. 전투를 오래 해온 몸이었다. 피부는 따뜻했고, 렌의 손이 닿은 자리에서 근육이 미세하게 수축했다.

"…차갑다."

라이크가 입술을 뗀 사이로 낮게 말했다. 웃음기가 섞인 목소리였다.

"손이 겁나 차가워. 에어컨 때문에 그러는 거 아니냐?"

말은 그렇게 하면서도 라이크는 렌의 손을 밀어내지 않았다. 오히려 자기 쪽으로 끌어당겨서 허리 옆구리 쪽으로 안내했다. 손이 닿은 자리가 더 넓어졌다. 라이크의 체온이 그 손을 서서히 데웠다.

렌이 다리를 벌렸다. 라이크의 무릎 사이로 렌의 무릎이 들어왔다. 자세가 조금 흐트러졌다. 라이크는 중심을 잃지 않으려고 반대쪽 팔로 침대를 짚었다. 매트리스가 기우뚱했다. 그 각도에서 렌이 라이크를 끌어당겼다. 두 사람 사이의 거리가 사라졌다. 가슴이 닿고, 배가 닿고, 허벅지가 스쳤다.

라이크는 잠시 멈췄다. 렌의 얼굴을 내려다보는 자세였다. 시차 때문에 렌의 눈이 아래쪽에 있었고, 라이크는 고개를 약간 숙여야 그 눈을 마주할 수 있었다. 방 안의 빛이 렌의 눈동자 가장자리를 얇게 비추고 있었다.

"…진짜 괜찮은 거지?"

목소리가 낮았다. 평소의 장난기가 완전히 사라진 것은 아니었지만, 그 아래에 단단한 확인이 자리 잡고 있었다. 라이크는 렌의 뺨을 짚었다. 엄지손가락이 광대뼈를 스치듯 쓰다듬었다.

"네가 괜찮으면 나는 더 괜찮아. 근데 네가 조금이라도 싫으면, 지금 당장 멈출 거야. 그건 진짜야."

말하면서 라이크의 눈빛이 흔들리지 않았다. 웃지도 않았다. 드물게 진지한 표정이었다.

렌의 대답은 다시 입술로 돌아왔다. 라이크는 그 대답을 받아들이듯 고개를 숙였다. 두 번째 입맞춤은 첫 번째보다 길었다. 라이크의 입술이 렌의 아랫입술을 살짝 물었다가 놓쳤다. 송곳니가 닿는 자리에서 렌의 숨이 얇게 새어 나왔다. 라이크는 그 소리를 듣고 미간을 조금 찌푸렸다. 좋아서였다.

그의 손이 렌의 옷자락을 잡아 올렸다. 천이 스치는 소리가 방 안에 작게 울렸다. 라이크는 그 소리를 의식하면서도 신경을 끄기로 했다. 지금은 이 소리만 듣고 있으면 됐다. 렌의 숨소리. 옷이 벗겨지는 소리. 피부가 피부에 닿는 소리. 그게 전부였다.

"…올라와."

라이크가 등을 침대에 대며 말했다. 등을 대고 누워서 렌을 올려다보는 자세였다. 티셔츠는 벗겨진 채로 바닥에 떨어져 있었다. 그의 상체가 방의 흐릿한 빛 아래 드러났다. 탄탄하게 잡힌 근육이 호흡을 따라 움직였다. 목 옆으로 전자 초커가 감겨 있었다. 평소에는 신경 쓰지 않던 장비였지만, 지금은 그 존재가 조금 거슬렸다. 라이크는 손을 올려 초커를 풀었다. 찍 소리와 함께 잠금이 해제되자 그는 그것을 옆으로 던져버렸다.

"거슬려서."

혼잣말처럼 중얼거리고는 렌을 향해 손을 뻗었다. 손바닥이 렌의 허리 뒤쪽을 감쌌다. 가볍게 당기는 힘. 위에서 내려다보는 시선과 아래에서 올려다보는 시선이 만났다.

"이제 네 속도로 하면 돼."

라이크의 목소리가 조금 쉰 듯 울렸다.

"나는 움직이지 않을 테니까. 네가 움직이는 대로 받아줄게."

그 말은 진심이었다. 라이크는 렌이 결정하는 대로 움직이기로 했다. 언제나 자기 방식대로만 살아온 남자가, 처음으로 속도를 맞추지 않기로 했다.

그의 손이 렌의 허리를 감싼 채로 기다렸다. 방 안의 공기가 정적과 움직임 사이에서 팽팽하게 서 있었다. 라이크의 가슴이 렌의 가슴 아래에서 천천히, 깊게 오르내렸다. 기다리는 중이었다. 그러나 기다림이 지루하지는 않았다. 이 기다림은 채워지는 중이었다. 렌이 움직일 때마다, 숨 쉴 때마다, 그 간격이 조금씩 좁혀지고 있었다.
```

