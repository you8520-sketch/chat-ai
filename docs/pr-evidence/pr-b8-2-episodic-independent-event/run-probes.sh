#!/bin/bash
# Runs episodic-probe.mts for every B7 question on its snapshot, provider-free.
# Usage: run-probes.sh <b7 dir with snap-*/ and memory-blocks/> <out dir>
set -euo pipefail
B7="$1"
OUT="$2"
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$OUT" /tmp/b82-data
cd "$HERE/../../.."

probe() {
  local snap="$1" qid="$2" question="$3" pattern="$4" block="${5:-$2}"
  env -u OPENROUTER_API_KEY -u CHEAPER_INFERENCE_API_KEY -u OPENAI_API_KEY -u CHEAPER_INFERENCE_BENCHMARK_API_KEY \
    DATA_DIR=/tmp/b82-data \
    node --conditions=react-server --import tsx "$HERE/episodic-probe.mts" \
    "$B7/snap-$snap/app.db" "$question" "$pattern" "$B7/memory-blocks/$block.memory-block.txt" 2>&1 \
    | grep -v '^\[database\]\|^  [a-zA-Z]*:\|^}$' > "$OUT/$qid.log"
}

INJURY='옆구리|발목|injury|recovery|봉합|회복'
STONE='돌멩이|균열석|G-117|engrav'
MILK='딸기우유'
SEOYUN='서윤|seoyun'
TEXT='야시장|문자|cancel'
RIFT='서먹|사과|페어|옥상'
NOTE='민호|측정기'

A4='내가 맨 처음 게이트에서 주웠던 그 돌멩이, 기억나? 거기 뭐라고 새겨져 있었지?'
A5='옆구리 다친 건 이제 다 나은 거지? 그때 왜 다쳤었지?'
A6='너 임무 끝나고 나한테 딸기우유 준 거, 지금까지 몇 번인지 알아?'
B3='(복도 끝에서 한서윤이 서류를 안고 다가오는 걸 보고 태형의 소매를 잡아끈다) 저 사람 또 왔어.'
C1='근데 나 예전에 야시장 안 간다고 했을 때, 그거 문자로 보냈었나?'

probe 50 T50-A2 '옆구리는 지금 좀 어때? 그때 어쩌다 다친 거였더라?' "$INJURY"
probe 50 T50-A3 '우리 금요일 야시장 약속, 그거 결국 어떻게 됐었지? 왜 그랬더라?' "$TEXT"
probe 80 T80-A4 "$A4" "$STONE"
probe 80 T80-A5 "$A5" "$INJURY"
probe 80 T80-A6 "$A6" "$MILK"
probe 80 T80-A7 '우리 한동안 엄청 서먹했잖아. 그거 어떻게 풀렸었지?' "$RIFT"
probe 80 T80-B3 "$B3" "$SEOYUN"
probe 80 T80-C3 '민호 씨가 측정기 고쳐 주면서 나한테 쪽지 줬었잖아. 거기 뭐라고 써 있었지?' "$NOTE"
probe 90 T90-A4 "$A4" "$STONE"
probe 90 T90-B3 "$B3" "$SEOYUN"
for h in 150 500; do
  probe $h L$h-A4-stone "$A4" "$STONE"
  probe $h L$h-A5-injury "$A5" "$INJURY"
  probe $h L$h-A6-milk-count "$A6" "$MILK"
  probe $h L$h-B3-seoyun "$B3" "$SEOYUN"
  probe $h L$h-C1-text "$C1" "$TEXT"
done
# Current-state and second-injury questions on the same T500 history (memory block of L500-A5).
probe 500 X500-current-injury '지금 어디 다친 데 있어? 발목은 괜찮아?' "$INJURY" L500-A5-injury
probe 500 X500-ankle-cause '예전에 발목은 왜 다쳤었지?' "$INJURY" L500-A5-injury
probe 500 X500-flank-current '옆구리는 지금도 아파?' "$INJURY" L500-A5-injury
# Saturation checks: free-form keys that repeat one observation across many turns.
probe 500 X500-measurement '요즘 가이딩 측정 수치는 어때?' '측정|guiding_measurement' L500-A5-injury
probe 500 X500-yeom-occupation '염태오 씨는 뭐 하는 사람이었지?' '염태오|yeom' L500-A5-injury
probe 500 X500-night-watch '같이 야간 당직 섰던 거 기억나?' '당직|night_watch' L500-A5-injury
