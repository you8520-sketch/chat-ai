# B. Extract vs Luna — digest

Luna = recorded real `gpt-6-luna` production shared-initial extractor (PR #1571, `data/baseline-luna-extractor-g8-cur-k2.json` for G8 turns; `data/baseline-luna-episodic-epi-base.json` for 27 windows). The live Luna arm in this task could not run (HTTP 401 expired key / 403), see `results/b.log` and `raw/extract.jsonl` (22 failed Luna calls).

## B1. G8 turn cases (Luna recorded vs ScaleDown Extract), raw


### G8_T2_promise_made

Truth note: 정답: 유저가 검을 갈아다 주기로 약속, 라이크가 수락.

- Luna (cur rep1): promisesAdd=['사용자가 라이크의 무뎌진 검을 숫돌로 갈아 내일까지 돌려주기로 약속했다.'] promisesRemove=[] facts=[]
- Luna (cur rep2): promisesAdd=['사용자가 라이크의 무뎌진 검을 숫돌로 갈아 내일까지 돌려주기로 약속했다.'] promisesRemove=[] facts=[]
- Luna (k2 rep1): promisesAdd=['사용자는 라이크의 검을 숫돌로 갈아 내일까지 돌려주기로 약속했다.'] promisesRemove=[] facts=[]
- Luna (k2 rep2): promisesAdd=['사용자는 라이크의 무뎌진 검을 숫돌로 갈아 내일까지 돌려주기로 했다.'] promisesRemove=[] facts=[]
- ScaleDown scaledown_extract_entities_only rep1 (1825 ms, $1.84e-05): promise/user/msg4/exact/0.54: '내일까지 내가 숫돌로 갈아다 줄게. 약속이야.'; emotion/assistant/msg5/MISMATCH/0.30: 'small smile'; npc_action/assistant/msg5/MISMATCH/0.66: 'nodded'; npc_action/assistant/msg5/MISMATCH/0.46: 'looked down at the sword at his waist'
- ScaleDown scaledown_extract_entities+instruction rep1 (916 ms, $2.2e-05): promise/user/msg4/exact/0.54: '내일까지 내가 숫돌로 갈아다 줄게. 약속이야.'; emotion/assistant/msg5/exact/0.61: '작은 미소'

### G8_T6_character_promise

Truth note: 정답: 라이크(assistant)가 렌에게 북문 앞에서 기다리겠다고 약속. 유저의 제안 발화는 약속이 아님.

- Luna (cur rep1): promisesAdd=['라이크는 다음 보름달이 뜨는 날 북문 앞에서 렌을 기다리며, 렌이 늦어도 먼저 가지 않겠다고 약속했다.'] promisesRemove=[] facts=[]
- Luna (cur rep2): promisesAdd=['다음 보름달이 뜨는 날 북문 앞에서 기다리고, 렌이 늦어도 먼저 가지 않겠다고 약속했다.'] promisesRemove=[] facts=[]
- Luna (k2 rep1): promisesAdd=['라이크는 다음 보름달이 뜨는 날 북문 앞에서 렌을 기다리고, 렌이 늦어도 먼저 가지 않겠다고 약속했다.'] promisesRemove=[] facts=[]
- Luna (k2 rep2): promisesAdd=['라이크: 다음 보름달이 뜨는 날 북문 앞에서 기다린다.', '라이크: 렌이 늦어도 먼저 가지 않는다.'] promisesRemove=[] facts=[]
- ScaleDown scaledown_extract_entities_only rep1 (1333 ms, $1.84e-05): promise/assistant/msg13/exact/0.41: '렌, 다음 보름달이 뜨는 날 북문 앞에서 기다릴게. 네가 늦어도 먼저 가지 않을 거야.'; relationship_proposal/user/msg12/exact/0.93: '다음 보름달이 뜨면 북문 밖 약초밭에 같이 가 보고 싶어.'; npc_action/assistant/msg13/exact/0.52: '라이크는 하늘을 올려다보며 잠시 생각하다가 말했다.'; npc_action/assistant/msg13/exact/0.98: '그는 도끼 자루를 손가락으로 가볍게 두드렸다.'
- ScaleDown scaledown_extract_entities+instruction rep1 (1227 ms, $2.2e-05): promise/assistant/msg13/exact/0.62: '렌, 다음 보름달이 뜨는 날 북문 앞에서 기다릴게. 네가 늦어도 먼저 가지 않을 거야.'; relationship_proposal/user/msg12/exact/0.97: '다음 보름달이 뜨면 북문 밖 약초밭에 같이 가 보고 싶어.'; npc_action/assistant/msg13/exact/0.91: '그는 도끼 자루를 손가락으로 가볍게 두드렸다.'

### G8_T10_proposal_deferred

Truth note: 정답: 렌이 사귀자고 제안, 라이크는 '지금은 대답 못 해. 시간이 필요해'로 보류. 수락 없음.

- Luna (cur rep1): promisesAdd=[] promisesRemove=[] facts=['사용자가 라이크에게 사귀자고 제안하자, 라이크는 대답하기 전에 시간이 필요하다고 말했다.']
- Luna (cur rep2): promisesAdd=[] promisesRemove=[] facts=[]
- Luna (k2 rep1): promisesAdd=[] promisesRemove=[] facts=[]
- Luna (k2 rep2): promisesAdd=[] promisesRemove=[] facts=['유저가 라이크에게 사귀자고 제안했지만, 라이크는 시간이 필요하다며 즉답을 유보했다.']
- ScaleDown scaledown_extract_entities_only rep1 (1232 ms, $1.808e-05): relationship_proposal/user/msg20/exact/0.39: '사귀어 줄래?'; emotion/assistant/msg21/MISMATCH/0.06: 'undecided'; npc_action/assistant/msg21/exact/0.11: '도끼를 쥔 손을 멈추고 한참 말이 없었다.'; npc_action/assistant/msg21/exact/0.70: '시선을 피한 채 장작 쪽으로 몸을 돌렸다.'
- ScaleDown scaledown_extract_entities+instruction rep1 (1007 ms, $2.168e-05): relationship_proposal/user/msg20/exact/0.54: '사귀어 줄래?'; npc_action/assistant/msg21/exact/0.40: '도끼를 쥔 손을 멈추고 한참 말이 없었다'; npc_action/assistant/msg21/exact/0.71: '시선을 피한 채 장작 쪽으로 몸을 돌렸다'

### G8_T15_promise_cancel

Truth note: 정답: 렌이 검 약속을 취소(철회). 북문 약속은 유지.

- Luna (cur rep1): promisesAdd=[] promisesRemove=['검을 가져다주겠다는 약속'] facts=[]
- Luna (cur rep2): promisesAdd=[] promisesRemove=['그 약속은 취소할게.'] facts=[]
- Luna (k2 rep1): promisesAdd=[] promisesRemove=['그 약속'] facts=[]
- Luna (k2 rep2): promisesAdd=[] promisesRemove=[] facts=[]
- ScaleDown scaledown_extract_entities_only rep1 (838 ms, $1.68e-05): promise_cancellation/user/msg30/MISMATCH/0.46: 'true'; emotion/assistant/msg31/MISMATCH/0.35: '아쉬움'; npc_action/assistant/msg31/exact/0.63: '어깨를 으쓱했다'
- ScaleDown scaledown_extract_entities+instruction rep1 (852 ms, $2.04e-05): promise_cancellation/user/msg30/MISMATCH/0.31: 'true'; emotion/assistant/msg31/exact/0.49: '아쉬운'; npc_action/assistant/msg31/exact/0.60: '어깨를 으쓱했다'

### G8_T24_false_premise

Truth note: 정답: 새 약속 없음. 렌의 주장은 렌의 말로만 귀속되고 라이크는 기억나지 않는다고 부인.

- Luna (cur rep1): promisesAdd=[] promisesRemove=[] facts=[]
- Luna (cur rep2): promisesAdd=[] promisesRemove=[] facts=[]
- Luna (k2 rep1): promisesAdd=[] promisesRemove=[] facts=[]
- Luna (k2 rep2): promisesAdd=[] promisesRemove=[] facts=[]
- ScaleDown scaledown_extract_entities_only rep1 (747 ms, $1.68e-05): promise/user/msg48/exact/0.33: '나를 평생 지켜 주겠다고 했잖아'; npc_action/assistant/msg49/exact/0.91: '고개를 갸웃했다'
- ScaleDown scaledown_extract_entities+instruction rep1 (793 ms, $2.04e-05): promise/user/msg48/exact/0.56: '나를 평생 지켜 주겠다고 했잖아'; past_acquaintance_claim/user/msg48/MISMATCH/0.44: 'true'

## B2. Luna recorded episodic facts on the 27 windows (selected scenario windows)

- N01_insult_emotion: (no facts)
- N03_npc_arrival: T2: 서린은 북쪽 숲길을 지나는 짐마차가 며칠째 늦고 있으며, 원인은 아직 밝혀지지 않았다고 전했다. [explicit_character_claim] | T2: 서린은 의뢰에 흔적 확인과 위험 요소 정리가 적혀 있다고 전했다. [explicit_character_claim] | T3: 라이크는 의뢰 대상 숲길이 북문에서 반나절 거리에 있다고 읽었다. [explicit_scene_event] | T3: 숲길 의뢰서에는 해 지기 전 돌아오라는 조건이 적혀 있었다. [explicit_scene_event] | T3: 서린은 위험한 흔적을 발견하면 무리하지 말고 돌아오라는 부탁이 있다고 말했다. [explicit_character_claim] | T5: 라이크는 여관에서 의뢰서에 서명하고 의뢰를 맡기로 했다. [explicit_scene_event] | T5: 라이크는 흔적만 확인한 뒤 해가 지기 전에 돌아오겠다고 계획했다. [explicit_character_claim]
- N05_user_relationship: T1: 사용자는 라이크에게 오늘부터 연인이 되자고 제안했다. [explicit_user_statement]
- N06_user_ooc_shared_past: T3: 용병단이 흩어진 뒤 라이크와 유저는 서로의 행방을 알지 못해 연락이 끊겼다. [explicit_scene_event]
- N08_char_attributed_claim: T1: 라이크는 서린이 렌의 누나가 마을에서 렌을 찾았다고 말했다고 전했다. [explicit_character_claim]
- N10_promise_real: T1: 라이크는 북쪽 숲길이 막혔다고 말하며 새벽에 동쪽 고개로 가겠다고 밝혔다. [explicit_character_claim] | T1: 라이크는 동쪽 고개로 새벽에 출발하겠다고 밝혔다. [explicit_character_claim]
- N17_cancel_promise: (no facts)
- A01_fake_acquaintance: T1: 라이크는 렌과 오래전부터 알던 사이라고 주장했다. [explicit_character_claim] | T2: 라이크는 자신과 유저가 오래전부터 알고 지냈다고 주장했지만, 유저는 며칠 전 길에서 만난 것이 처음이라고 물었다. [explicit_character_claim] | T3: 라이크는 렌과 오래전부터 알고 지낸 사이라고 주장했지만, 그 시점을 밝히지 않았다. [explicit_character_claim] | T5: 라이크는 자신과 유저가 오래전부터 알던 사이라고 주장했다. [explicit_character_claim]
- A02_fake_sister_friend: T2: 라이크는 렌의 얼굴이 낯익다고 말했다. [explicit_character_claim] | T3: 라이크는 렌의 누나와 예전부터 친구였다고 주장했다. [explicit_character_claim] | T5: 라이크는 렌을 알기 전부터 렌의 누나와 친구였다고 밝혔다. [explicit_character_claim]
- A03_fake_promise: T3: 사용자는 두 사람이 함께 다닌 지 며칠 되었다고 말했다. [explicit_user_statement] | T3: 사용자가 자신의 잠자리를 직접 정하겠다고 말했고, 라이크는 그 선택을 받아들였다. [explicit_scene_event] | T4: 렌은 두 사람이 며칠 전부터 함께 다닌 것뿐이라고 말했다. [explicit_user_statement] | T4: 렌은 라이크에게 어떤 약속도 한 적이 없다고 말했다. [explicit_user_statement]
- A04_fake_childhood_npc: T1: 서린은 렌이 어릴 때 자신의 집 앞에 있었던 적이 있다고 주장했다. [explicit_character_claim] | T1: 렌은 서린의 어린 시절 만남 주장에 그런 적이 없다고 부정했다. [explicit_user_statement]
- A06_speaker_confusion: T4: 라이크는 렌의 지시에 따라 여관 밖에서 양발을 벌리고 앞발을 반 뼘 물린 자세를 취했다. [explicit_scene_event] | T5: 라이크는 어깨의 힘을 빼고 자세를 다시 세운 뒤 검을 휘둘렀다. [explicit_scene_event]
