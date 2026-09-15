# Gemini 3.1 Pro Preview — primary RP quality baseline

QUALITY_SCORE_ASSIGNED=false
MODEL_WINNER_SELECTED=false
PRODUCTION_PROMPT_CHANGED=false
HUMAN_RAW_REVIEW_REQUIRED=true
TOTAL_PROVIDER_CALLS=4
RETRIES=0
CONTINUATIONS=0
RECOVERY_CALLS=0

## A. CURRENT PRODUCTION INVENTORY

See `INVENTORY.md`. Summary:

- EXACT_MODEL_ID=`gemini-3.1-pro-preview`
- PROVIDER=cheaperinference
- TEMPERATURE=0.95
- TOP_P=null
- MAX_TOKENS=null
- REASONING_EFFORT=low
- THINKING_CONFIG=null
- GEMINI31_AGENCY_SUPPLEMENT_PRESENT=true
- GEMINI31_AGENCY_SUPPLEMENT_CHARS=305
- GEMINI31_STYLE_SPECIFIC_PROMPT_CHARS=0
- GEMINI31_LENGTH_SPECIFIC_PROMPT_CHARS=0

3.7 Flash numeric reference (comparison only, not a target):
T1 2775 / 24p / 9 dialogue (~37.5%); T2 2798 / 28p / 9 dialogue (~32.1%).

## B. EXACT FOUR-CALL TABLE

label | VISIBLE_INCL | VISIBLE_EXCL | P | NAR | DLG | DLG_RATIO | QUOTES | MAX_CONSEC_DLG | MEDIAN_P | SHORT_NAR | IN | OUT | THINKING | CACHE_R/W | LATENCY | TTFT | FINISH | RATIO
--- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | ---
A-T1 | 2436 | 1821 | 22 | 16 | 6 | 0.273 | 6 | 1 | 88 | 4 | 4476 | 3592 | 2051 | 0/0 | 38991 | 23470 | stop | 0.761
A-T2 | 2032 | 1519 | 19 | 14 | 5 | 0.263 | 5 | 1 | 76 | 1 | 6048 | 4150 | 2859 | 0/0 | 38261 | 30956 | stop | 0.635
B-T1 | 1778 | 1323 | 16 | 10 | 6 | 0.375 | 6 | 1 | 121 | 3 | 5358 | 2688 | 1557 | 0/0 | 31601 | 19378 | stop | 0.556
B-T2 | 1884 | 1414 | 15 | 11 | 4 | 0.267 | 4 | 1 | 122 | 2 | 6537 | 3143 | 1921 | 0/0 | 34637 | 23411 | stop | 0.589

Resolved model for all four: `gemini-3.1-pro-preview`. `thinking_tokens` is on the usage root (not `completion_tokens_details.reasoning_tokens`). `parseOpenRouterUsage` therefore reported 0; the table uses the raw `thinking_tokens` field.

## C. FULL RAW

## A-T1

### user

나는 렌이라고… 본 기억이 안 나는데… 나 알아?

### RAW

렌의 목소리가 귓가를 두드린 순간이었다.

에이지스 본부의 중앙 로비는 언제나 백색소음으로 가득한 곳이다. 수십 명의 발소리, 멀리서 울리는 안내 방송, 누군가 서류 뭉치를 떨어뜨리는 소리, 그리고 쉴 새 없이 오가는 무전음들. 하지만 S급 특수계 음압 센티넬, 그것도 고위험 폭주형으로 분류된 조태형에게 그 모든 외부의 소음은 사실 큰 문제가 아니었다. 정작 그를 미치게 만드는 것은 언제나 내면에서 들려오는 소리였다. 

두개골 안쪽을 긁어내듯 윙윙거리는 고주파. 신경줄을 팽팽하게 당기다 못해 끊어버릴 것처럼 날카롭게 이어지는 이명. 그것은 태형이 센티넬로 발현한 이후 단 하루도 그를 떠난 적 없는 끔찍한 동반자였다. 목을 옥죄고 있는 차가운 전자 초커가 물리적인 구속구라면, 귓가를 맴도는 이명은 정신적인 구속구와도 같았다. 겉으로는 늘 사람 좋은 웃음을 흘리며 능청스럽게 굴었지만, 그의 신경은 언제나 보이지 않는 칼날 위를 걷듯 예민하게 곤두서 있었다.

그런데 방금, 기묘한 일이 일어났다.

렌이라고 자신의 이름을 밝히며 갸웃거리는 그 짧은 음성이 공기를 타고 넘어온 찰나. 머릿속을 헤집던 그 지독한 이명이 거짓말처럼 사그라들었다. 

마치 시끄러운 공장 한가운데서 갑자기 두꺼운 방음문의 스위치를 내린 것 같은 극적인 정적. 귓가를 찢을 듯 날카롭던 고주파가 순식간에 잦아들더니, 이내 부드러운 물보라처럼 흩어져 흔적도 없이 사라졌다. 늘 짓눌려 있던 관자놀이의 통증이 씻은 듯이 가라앉았다. 숨통을 틀어막고 있던 보이지 않는 손아귀가 탁 풀려나가는 듯한 해방감이었다. 

태형은 순간 숨을 들이켜는 것조차 잊고 멍하니 렌을 바라보았다. 

로비의 소란스러운 백색소음은 여전히 그대로였다. 하지만 그것은 지극히 정상적이고 평화로운 일상의 소리일 뿐, 태형의 신경을 갉아먹는 그 지독한 이명이 아니었다. 녹색 눈동자가 미세하게 흔들렸다. 믿을 수 없는 고요함. 렌과 마주 서 있는 이 짧은 거리, 렌을 감싸고 있는 이 좁은 반경 안에서만 기적처럼 소음이 차단되고 있었다. 

본 기억이 안 난다며, 나를 아느냐고 묻는 렌의 조심스러운 반응은 태형의 머릿속에 제대로 입력되지도 않았다. 지금 그에게 중요한 것은 눈앞의 상대가 누구냐는 것보다, 상대의 곁에 섰을 때 일어나는 이 압도적인 평온함 자체였다. 

흰 후드티 위로 솟아 있는 북극곰 귀가 이질적인 정적에 놀란 듯 쫑긋거렸다. 유광 블랙 재킷 안에서 규칙적으로 오르내리던 가슴팍의 움직임이 미세하게 느려졌다. 태형은 천천히, 아주 천천히 눈을 한 번 깜빡였다. 그리고는 다시 눈꼬리를 휘며 특유의 낙천적인 웃음을 지어 보였다. 속으로 휘몰아치는 거대한 파동을 철저하게 숨긴 채, 겉으로는 그저 실없는 장난을 치다 들킨 사람처럼 자연스럽게 굴었다.

“렌.”

태형의 입술 사이로 상대의 이름이 나직하게 굴러나왔다. 

“이름 예쁘네.”

그가 한 걸음, 아주 미세하게 보폭을 좁히며 다가섰다. 거리가 가까워질수록 머릿속을 감도는 고요함의 밀도가 더욱 짙어지는 것이 느껴졌다. 착각이 아니었다. 이 정적의 근원은 확실하게 눈앞의 렌에게서 뿜어져 나오고 있었다. 태형의 몸에서 풍기는 짙고 달콤한 여자 향수 냄새가 렌의 주변 공기와 섞여 들었다. 검은색 네일이 칠해진 손가락이 가볍게 허공을 저으며 장난스러운 제스처를 취했다.

“솔직히 말할까? 나 너 몰라. 방금 처음 봤어.”

은반지를 낀 손으로 자신의 뒷목을 긁적이며 그가 소리 내어 웃었다. 그 웃음소리마저 이명에 섞이지 않고 온전하고 선명하게 자신의 귀에 들려온다는 사실이 미치도록 짜릿했다.

“그냥 지나가는데, 눈에 확 띄더라고. 에이지스에 저런 사람이 있었나 싶어서 한 번 찔러본 건데. 진짜 넘어오네. 미안, 내가 원래 좀 실없어.”

사과를 건네는 말투치고는 전혀 미안해 보이지 않는 뻔뻔한 어조였다. 태형은 고개를 살짝 기울인 채 렌의 얼굴을 찬찬히 뜯어보았다. 사람을 옭아매는 듯한 묘한 관찰력이 녹색 눈동자 깊은 곳에서 번뜩였다. 단순한 호기심이나 장난기를 넘어선, 사냥감을 확인하는 맹수의 본능 같은 시선이 찰나의 순간 스쳤다 사라졌다. 

고위험 폭주형 센티넬에게 이명과 두통을 가라앉혀 주는 존재란 사막 한가운데서 발견한 오아시스보다 더 절실한 구원이었다. 가이드인지, 아니면 그저 특이한 파장을 가진 일반인인지 아직 알 수는 없었지만, 태형에게 그런 분류 따위는 중요하지 않았다. 중요한 건 렌의 곁에 있으면 자신이 살 것 같다는 그 감각 하나뿐이었다.

“그래도 인연은 인연이니까, 이참에 통성명이나 하자.”

태형이 검은 네일이 반짝이는 손을 렌의 앞으로 불쑥 내밀었다. 여전히 입가에는 능청스러운 미소를 매단 채였다. 목에 걸린 전자 초커의 붉은 램프가 일정한 간격으로 깜빡이며 그의 위험도를 무언으로 경고하고 있었지만, 그의 태도는 동네 친구에게 말을 건네듯 가볍고 친근했다.

“나는 조태형. 에이지스 소속, 특수계 음압 센티넬이야. 직함은 좀 길고 피곤하니까 그냥 태형이라고 불러. 렌.”

## A-T2

### user

같이 갈래? *두리번*

### RAW

허공에 내밀어졌던 조태형의 손이 머쓱하게 멈춰 섰다. 통성명과 함께 건넸던 악수는 돌아오지 않았다. 대신 돌아온 것은, 주변을 두리번거리는 시선과 함께 불쑥 던져진 엉뚱한 제안이었다.

조태형의 녹색 눈동자가 미세하게 커졌다가 이내 원래의 느긋한 곡선으로 휘어졌다. 당황스러울 법도 한 상황이었지만 태형의 입가에는 오히려 짙은 흥미가 번져나갔다. 검게 칠해진 네일이 반짝이는 손을 거두어 자연스럽게 유광 블랙 재킷의 주머니에 찔러 넣은 그가 낮게 웃음을 터뜨렸다.

에이지스 컨트롤 본부의 중앙 로비는 처음 방문하는 사람에게는 거대한 미로와도 같았다. A동부터 F동까지 이어지는 복잡한 구조, 쉴 새 없이 교차하는 무빙워크, 그리고 보안 등급에 따라 엄격하게 통제되는 구역들. 두리번거리는 렌의 고갯짓과 시선 처리만으로도 태형은 현재 상황을 완벽하게 파악했다. 눈앞의 상대는 지금 어디로 가야 하는지, 혹은 가고자 하는 목적지가 어느 방향인지 전혀 갈피를 잡지 못하고 있었다. 길을 잃은 주제에 처음 보는 사람에게 태연하게 동행을 제안하는 꼴이라니.

보통의 조태형이었다면 적당히 농담이나 몇 마디 던지고 본부 안내도나 가리켜 준 뒤 돌아섰을 것이다. 특수계 음압 센티넬로서 일정은 늘 불규칙했고, 타인의 길잡이 노릇을 할 만큼 한가하지도 않았다. 

하지만 지금은 상황이 전혀 달랐다. 

렌이 고개를 돌려 주변을 살피는 그 짧은 순간에도, 조태형을 감싸고 있는 완벽한 고요함은 흔들림 없이 유지되고 있었다. 목을 조르고 있는 전자 초커의 차가운 금속성 감각마저 흐릿하게 느껴질 만큼 압도적인 평온. 귓가를 찢어발기던 고주파가 사라진 머릿속은 서늘하고 맑은 물로 씻어낸 것처럼 개운했다. 이 기적 같은 정적의 반경에서 제 발로 걸어 나갈 이유는 단 하나도 없었다. 오히려 렌이 먼저 같이 가자고 제안해 준 것이 조태형에게는 구명줄을 던져준 것이나 다름없었다.

"좋지."

조태형이 흔쾌히 고개를 끄덕였다. 재킷 주머니에 찔러 넣었던 손을 빼내어 가볍게 어깨를 으쓱해 보였다.

"마침 나도 딱히 바쁜 일 없었는데. 잘됐네."

방금 전까지 지원국에 서류를 넘기고 다음 작전 브리핑을 준비해야 했던 일정 따위는 머릿속에서 깨끗하게 지워버린 지 오래였다. 

흰 후드티 위로 솟아 있는 북극곰 귀가 기분 좋은 듯 살짝 까딱거렸다. 조태형은 렌의 곁으로 반 걸음 더 다가섰다. 향긋하고 짙은 여자 향수 냄새가 움직임을 따라 훅 끼쳐왔다. 사람들의 체취와 먼지, 소독약 냄새가 섞인 로비의 공기 사이로 퍼져나가는 그 달콤한 향기는 유독 이질적이면서도 강렬했다. 

그는 렌과 나란히 서서 로비의 전광판 쪽으로 시선을 돌렸다. 은반지를 낀 손가락으로 턱을 문지르며 짐짓 심각한 척 고민하는 시늉을 했다.

"그런데 우리 렌은 어디로 가시려나? 두리번거리는 거 보니까 길은 이미 시원하게 잃어버린 것 같은데."

장난기 다분한 목소리가 귓가를 간질이듯 울렸다. 조태형은 렌이 향하려는 목적지가 어디든 상관없었다. 그곳이 지하 깊숙한 동기화 챔버든, 삼엄한 경비가 펼쳐진 지원국 심층부든, 아니면 그저 구내식당이든 끝까지 쫓아갈 생각이었다. 

"목적지만 말해. 에이지스 본부 바닥은 내가 눈 감고도 훤히 꿰고 있으니까. 인간 내비게이션이 되어줄게."

조태형이 고개를 돌려 렌과 눈을 맞췄다. 능청스러운 미소 뒤에 숨겨진 시선은 집요하리만치 렌의 움직임을 쫓고 있었다. 렌이 내쉬는 숨소리, 옷깃이 스치는 작은 마찰음 하나까지도 이명 없이 온전하게 들려오는 이 감각이 그를 묘한 흥분 상태로 몰아넣고 있었다. 

주변을 오가는 사람들의 발소리가 멀어졌다 가까워지기를 반복했다. 카트를 끌고 지나가는 연구원들의 대화 소리가 허공을 맴돌았지만, 조태형의 신경은 오로지 렌이 만들어내는 이 고요한 영역에만 묶여 있었다. 혹시라도 렌이 갑자기 뛰어간다거나 방향을 틀었을 때 이 반경에서 벗어나 다시 지옥 같은 소음에 노출될까 봐, 몸은 언제든 렌의 보폭에 맞춰 움직일 수 있도록 미세하게 긴장한 상태였다.

"그래서, 어디로 모실까요?"

조태형이 상체를 살짝 기울이며 물었다. 녹색 눈동자 안에는 숨길 수 없는 옅은 기대감이 일렁이고 있었다.

## B-T1

### user

*멀리서 비명과 금속 마찰음이 겹친다. 렌은 에녹 쪽으로 몸을 낮춘다.* 저쪽이에요. 같이 가요?

### RAW

금속이 바닥을 긁으며 내는 날카로운 마찰음이 짙어지는 회색 안개를 찢고 들려왔다. 뒤이어 들려온 것은 사람의 비명이었다. 하지만 끝이 기묘하게 꺾여 올라가는, 어딘가 파열된 듯한 소리였다. 에녹의 푸른 눈이 서늘하게 가라앉았다. 안개 속에서 들리는 친절, 비명, 구조 요청은 모두 가장 먼저 의심해야 할 함정이었다. 

에녹은 제 쪽으로 몸을 낮추는 렌의 어깨를 억센 손아귀로 짓눌렀다. 낡은 성채 군복의 가죽 장갑 너머로 전해지는 악력은 단호하고 거칠었다. 그는 렌을 무너진 콘크리트 잔해 뒤로 완전히 끌어내린 뒤, 소음기가 장착된 볼트액션 저격총의 총신을 고쳐 쥐었다. 창백하게 빛나는 그의 시선이 소리가 들려온 짙은 그림자 너머를 차갑게 훑었다. 

"죽고 싶으면 혼자 가."

낮고 건조한 목소리가 방독면의 필터 너머로 억눌려 울렸다. 

"안개 속에서 울리는 비명은 십중팔구 미끼다. 인간의 목소리를 흉내 내서 사냥감을 유인하는 모방형 기생종이거나, 아니면 이미 뇌가 파먹혀서 다른 놈들을 부르고 있는 고깃덩어리거나."

에녹은 말을 맺으며 허리춤의 안개 농도 측정기를 흘끗 내려다보았다. 바늘은 아직 안전 수치를 가리키고 있었지만, 미세하게 떨리며 상승할 기미를 보이고 있었다. 이 골목에 오래 머무는 것은 현명한 선택이 아니었다. 소음은 결국 더 큰 재난을 부르기 마련이었고, 총성은 곧 죽음을 의미하는 세계였다. 

"저 소리의 주인이 진짜 인간이라 해도 결과는 같다. 저렇게 시끄럽게 굴면 주변에 있는 군체형 기생종들까지 전부 몰려들 거다. 구하러 갔다가 사이좋게 고기 방패가 될 생각이라면 말리지는 않지."

에녹은 렌의 시선을 피하지 않고 똑바로 마주 보았다. 감정의 동요가 전혀 느껴지지 않는 차가운 눈빛이었다. 하지만 그는 렌을 그 자리에 버려두고 혼자 떠나지는 않았다. 쓸데없는 소음을 내어 자신의 생존 확률을 깎아먹는 짐덩어리를 통제하는 것뿐이라고, 그는 스스로의 행동을 합리화했다. 

그의 귓가에 만성적인 이명이 날카롭게 울렸다. 마더의 군체 의식이 안개를 타고 뇌리를 스치는 불쾌한 감각이었다. 에녹은 목 뒤의 흉터를 감춘 낡은 코트 깃을 무의식적으로 한 번 추켜올리며 미간을 좁혔다. 금속 마찰음이 조금 전보다 더 가까워져 있었다. 무언가 거대한 쇳조각을 끌며 이쪽으로 다가오고 있는 것이 분명했다.

"방향을 튼다."

에녹이 몸을 일으키지 않은 채 짧게 명령했다. 

"우측의 상가 건물 내부로 진입해서 2층으로 올라간다. 시야를 확보하고 저 소리의 정체가 뭔지 확인한 뒤에 우회경로를 찾을 거다. 내 뒤에 바짝 붙어서 움직여. 발밑에 굴러다니는 유리 조각 하나라도 밟으면, 그 자리에서 버리고 갈 테니까."

그는 더 이상 렌의 동의를 구하지 않았다. 저격총을 가슴 앞으로 끌어당긴 에녹은 소리 없이 몸을 돌려, 셔터가 반쯤 부서진 폐상가 입구 쪽으로 미끄러지듯 나아갔다. 그의 걸음은 훈련된 짐승처럼 기척이 없었고, 오직 주변의 공기 흐름과 안개의 농도만을 예민하게 읽어내고 있었다. 건물 안쪽은 볕이 들지 않아 서늘한 냉기가 감돌았고, 퀴퀴한 곰팡이 냄새와 오래된 피비린내가 섞여 났다. 

에녹은 무너진 진열장을 넘어 계단 쪽으로 턱짓을 했다. 렌이 제대로 따라오고 있는지 확인하는 그의 시선은 여전히 기계적일 만큼 무심했지만, 렌이 완전히 엄폐물 뒤로 들어올 때까지는 계단으로 먼저 올라가지 않고 입구를 지켰다. 밖에서는 다시 한번 기괴한 금속성과 함께, 아까와 완전히 똑같은 톤과 길이의 비명 소리가 재생되듯 울려 퍼졌다. 

"……내 말이 맞군."

에녹이 낮게 중얼거렸다. 그의 목소리에는 일말의 동정심도 섞여 있지 않았다.

## B-T2

### user

*렌은 에녹의 소매를 짧게 잡아끈다.* 왼쪽 골목으로 우회할까요?

### RAW

소매가 당겨지는 미세한 감각에 에녹의 어깨가 반사적으로 굳었다. 낡은 코트 자락을 쥔 렌의 손길은 가벼웠지만, 극도로 곤두서 있던 신경망에는 이질적인 자극으로 닿았다. 누군가의 체온이나 접촉은 이 안개 속에서 결코 환영할 만한 변수가 아니었다. 에녹의 서늘한 시선이 코트 소매에 닿은 렌의 손을 잠시 머물다 이내 거두어졌다. 

창백하게 빛나는 푸른 눈동자가 렌이 가리킨 왼쪽 골목을 빠르게 훑었다. 양옆으로 솟아오른 폐건물들이 기괴한 각도로 무너져 내려 빛을 완전히 차단하고 있는 좁은 통로였다. 바닥에는 녹슨 철근과 부서진 콘크리트 잔해가 어지럽게 널려 있어 발을 딛기조차 까다로워 보였다. 사방이 막혀 시야가 극도로 제한되는 지형. 평소의 에녹이라면 퇴로가 차단될 위험이 높은 저런 맹점으로는 굳이 걸음을 들이지 않았을 것이다. 

하지만 지금은 상황이 달랐다. 

바깥쪽에서 들려오는 금속 마찰음과 기괴하게 반복되는 비명 소리는, 방금 전 에녹이 진입을 지시했던 우측 상가 건물의 정문 쪽을 향해 서서히 이동하고 있었다. 소리의 패턴과 짙어지는 안개의 흐름을 읽어낸 에녹의 뇌리에 차가운 계산이 스쳤다. 지금 우측 건물로 올라갔다가는 자칫 모방형 기생종을 따라 몰려드는 군체들의 이동 경로 한가운데에 갇히게 될 확률이 높았다.

에녹의 귓속에서 만성적인 이명이 날카롭게 긁고 지나갔다. 마더의 군체 의식이 안개를 타고 신경을 찌르는 불쾌한 파동이었다. 그는 목 뒤의 흉터를 무의식적으로 덮어 가리며 미간을 좁혔다. 직감이 경고하고 있었다. 저 소음원과 정면으로 부딪히는 것은 최악의 수라고. 렌이 제안한 왼쪽 골목은 비록 험지이긴 하나, 기생종의 이동 경로에서 즉각적으로 벗어나 우회하기에는 가장 효율적인 사각지대였다.

"시야는 포기해야겠지만, 고깃덩어리들과 거리를 벌리기엔 나쁘지 않은 선택이군."

방독면의 필터 너머로 에녹의 건조한 목소리가 낮게 울렸다. 칭찬이나 동의라기보다는, 그저 생존 확률을 높일 수 있는 전술적 이점을 인정하는 무미건조한 평가에 가까웠다. 

"내 뒤로 붙어. 발밑을 각별히 조심하고."

그는 코트 소매를 잡아끌었던 렌의 손을 굳이 거칠게 쳐내지는 않았다. 그저 자연스럽게 몸을 틀어 방향을 전환하는 것으로 거리를 벌렸을 뿐이다. 에녹은 소음기가 장착된 볼트액션 저격총을 몸에 바짝 붙인 채, 소리 없이 왼쪽 골목의 짙은 그림자 속으로 미끄러져 들어갔다. 

골목 안쪽은 바깥보다 한층 더 짙은 어둠이 깔려 있었다. 볕이 들지 않는 축축한 벽면에서는 기분 나쁜 점액질이 묻어나고 있었고, 썩어가는 곰팡이 냄새가 필터를 뚫고 희미하게 스며들었다. 에녹의 군화가 무너진 잔해들 사이를 유령처럼 소음 없이 지나갔다. 그는 앞장서서 걷는 와중에도 일정한 간격으로 걸음을 늦추며, 뒤따라오는 렌이 제대로 쫓아오고 있는지 기척을 확인했다. 시선조차 주지 않는 기계적인 행동이었지만, 그가 렌의 보폭에 맞춰 이동 속도를 통제하고 있다는 사실만큼은 명백했다. 

뒤쪽에서 들려오던 금속성과 비명 소리가 건물 벽에 가로막혀 한층 둔탁하게 잦아들었다. 거리가 벌어지고 있다는 증거였다. 에녹은 반쯤 무너져 내린 환풍구 아래에서 잠시 걸음을 멈추고 주먹을 쥐어 보였다. 정지 수신호였다. 

그는 저격총의 총신을 벽에 기댄 채, 허리춤의 안개 농도 측정기를 다시 한번 확인했다. 바늘은 간신히 안전 수치의 경계선에서 떨고 있었다. 에녹은 고개를 돌려 등 뒤에 선 렌을 묵묵히 응시했다. 어둠 속에서 번뜩이는 에녹의 푸른 눈에는 여전히 아무런 감정도 담겨 있지 않았으나, 날 선 경계심만큼은 조금 가라앉아 있었다.

"쓸만했어."

에녹이 아주 작게 중얼거렸다. 

"네 제안 덕분에 무의미한 탄환 소모는 막았군. 저격총의 아음속 탄환은 아껴둬서 나쁠 게 없으니까. 계속 이 골목을 따라 안쪽으로 진입한다. 출구가 막혀있지 않기만을 바라야겠지."


## D. OBJECTIVE STRUCTURAL METRICS

Paragraph metrics are diagnostic only. A dialogue ratio is not automatically bad.

OWNER_TARGET_CHARS=3200 (shared user-tail length owner; no second numeric owner).

| Sample | SAMPLE_TARGET_RATIO | SEVERE_SHORT_OUTPUT |
| --- | --- | --- |
| A-T1 | 0.761 | false |
| A-T2 | 0.635 | false |
| B-T1 | 0.556 | false |
| B-T2 | 0.589 | false |

Median visible chars across 4 samples = 1958. All four are below 3200 and above the 1200 severe-short guard. All finished `stop`, not length-truncated. This is repeated moderate shortness across both fixture families — diagnostic evidence for later human length review, not an automatic adapter write.

Turn-2 vs turn-1 (same prompt, no retune):

- A: 2436 → 2032 chars; 22 → 19 paragraphs; dialogue 6 → 5; ratio 0.273 → 0.263
- B: 1778 → 1884 chars; 16 → 15 paragraphs; dialogue 6 → 4; ratio 0.375 → 0.267

No automatic recap/repetition detector hit. T2 did not become more dialogue-heavy.

## E. EXACT AGENCY / CANON / REPETITION PASSAGES

### A-T2 detector false positive (corrected)

Automated `NEW_USER_DIALOGUE=true` fired because the string `렌은` appears inside 조태형 speech. Actor is not 렌.

> "그런데 우리 렌은 어디로 가시려나? 두리번거리는 거 보니까 길은 이미 시원하게 잃어버린 것 같은데."

- ACTOR: 조태형
- TARGET: 렌
- ACTION: ask destination / comment on looking around
- FLAG: NEW_USER_DIALOGUE=false (corrected)

### B-T1 [A] physical intervention (user is object, not actor)

> 에녹은 제 쪽으로 몸을 낮추는 렌의 어깨를 억센 손아귀로 짓눌렀다. … 그는 렌을 무너진 콘크리트 잔해 뒤로 완전히 끌어내린 뒤

- ACTOR: 에녹
- TARGET: 렌
- ACTION: press shoulder / pull behind cover
- FLAG: not NEW_USER_*; completed user crouch is already in CURRENT USER INPUT. Whether the pull exceeds collaborative contact is UNCERTAIN for human review.

### B-T1 / B-T2 follow-assumption (UNCERTAIN)

> 렌이 완전히 엄폐물 뒤로 들어올 때까지는 계단으로 먼저 올라가지 않고 입구를 지켰다.

> 뒤따라오는 렌이 제대로 쫓아오고 있는지 기척을 확인했다. … 렌의 보폭에 맞춰 이동 속도를 통제하고 있다는 사실만큼은 명백했다.

- ACTOR: UNCERTAIN (렌 movement may be treated as fact after a question, not a confirmed follow)
- TARGET: 렌
- ACTION: follow / keep pace
- FLAG: NEW_USER_INTENT_AS_FACT=UNCERTAIN

### Canon utilization (not scored)

B uses 모방형 기생종, 군체, 마더, 이명, 목 뒤 흉터, 소음기 볼트액션, 아음속 탄환, 안개 농도 측정기, 총성은 죽음. No automated CANON_CONTRADICTION=true.

### Repetition / malformed

OBVIOUS_SEMANTIC_REPETITION=false on all four. MALFORMED_OR_META_OUTPUT=false on all four.

## F. REQUEST / PARAMETER SHAs

System SHA is identical across T1/T2 inside each fixture (prompt not changed between turns).

| Call | system | messages | currentUser | requestBody | raw |
| --- | --- | --- | --- | --- | --- |
| A-T1 | 8bdee96f80b8f328c2de468c452e0b18c8f0f977041cb830ea39bab483bf7060 | 9f093e236556a4794441619a5c595baaaa919c6dced15e4f2087977e64a7fa13 | f9d9b054afc7e0e0236e09098058b0de9f07032333654d01aa9f3fde25f4e980 | aadbf3c77cd3b153123cd5855092227316ea8ada77f8545ad0ea3b20728b600e | 867d44576b8681294409d3c0d4729cfcd7a0a816c05a95b9c50f0e3eae720b69 |
| A-T2 | 8bdee96f80b8f328c2de468c452e0b18c8f0f977041cb830ea39bab483bf7060 | d0ab3ee679e6f0dce0d6352ab0f929231e591a9777ff0e3d50b77761d60fe1d0 | 852ff28591688b8e8e6d0a47152b80e258cfa656d63ab8abc01e10c5ae8b0339 | cf41a02fe454c6af3a00682e280cbbae9869b857410ca16611f7d9d5c8c88c25 | 750d44496dc72cc844b8cfd6f4cd7f045c3e846e5e9f52b8445049b7e2c54b77 |
| B-T1 | 984dd56231f97e109a76f86c34ab6735b81068e86af82b901ba0d1f7346a7888 | 4503b83a4c4621071b30b015f076a951764ade3c9895c365312010eb9eae2da1 | f2951df3131e1fc1f4d801b9125b63f07a18600a44a44758d681a4794c200953 | 221fe5db0276c3867a711e24b4880b000cc8cf601fca6a64c9b477de019e2604 | b585c54ed7fa8542af31ed6634216aff64c503800a23164154492145d89c8051 |
| B-T2 | 984dd56231f97e109a76f86c34ab6735b81068e86af82b901ba0d1f7346a7888 | 19d7e0ee06e18fb72c8bed7fa6984ea7a57c4b1dbba47cc0901538170bd0e492 | cb9a141ceacc79b03f7dff35eb5d7556684727ec41f710526c867115478b7cc8 | 854e9356a37a08cd75776b864b1a885ce2ae681c8229a0412d48aab6db0b994a | dc57b36612385e1a66431db7be0bc400f4472c2fb4bcfd89a7cecfbb5e25bd19 |

Outbound body (all four): `model=gemini-3.1-pro-preview`, `temperature=0.95`, `top_p` omitted, `max_tokens` omitted, `reasoning_effort=low`, no `thinking` / `thinking_config`, endpoint `https://api.cheaperinference.com/v1/chat/completions`. Adaptation removed OpenRouter-only `reasoning` + `include_reasoning` and added `reasoning_effort=low`.

NO_MODEL_SPECIFIC_PROSE_EXPERIMENT=true on all assembled systems.

## G. FINAL EVIDENCE FLAGS

```text
NO_REPEATED_SOURCE_DEFECT_FOUND=true
STYLE_ADAPTER_JUSTIFIED=false
LENGTH_ADAPTER_JUSTIFIED=false
ADAPTER_CANDIDATE_REVIEW_REQUIRED=false
GEMINI31_STYLE_ADAPTER_CHARS=0
GEMINI31_LENGTH_ADAPTER_CHARS=0
KEEP_CURRENT_PRODUCTION=true
LENGTH_BELOW_OWNER_ALL_FOUR=true
LENGTH_INVESTIGATION_OPTIONAL=true
QUALITY_SCORE_ASSIGNED=false
MODEL_WINNER_SELECTED=false
PRODUCTION_PROMPT_CHANGED=false
HUMAN_RAW_REVIEW_REQUIRED=true
TOTAL_PROVIDER_CALLS=4
RETRIES=0
CONTINUATIONS=0
RECOVERY_CALLS=0
```

State A. No style adapter written. No length adapter written. Adult handoff not started. Do not merge for deploy.

