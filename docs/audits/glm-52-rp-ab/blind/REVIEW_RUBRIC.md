# Blind human review pack

Do not open `blind/BLIND_KEY.json` until scoring is finished.

Each seed has two unlabeled outputs (X / Y). Compare only those two files.

## Compare

- which side is better as a character-chat product
- prose / literary density
- character voice
- immersion
- scene progression
- natural Korean
- agency / speech-act / repetition / question-loop / dialogue-overuse / early-stop / summary-preview leakage

## Site goals (for the scorer, not pre-scored here)

- narration-first
- no dialogue overuse
- scene must actually progress
- do not preempt user action/intent
- 3000+ chars is helpful if not padded by repetition

## Files

- S1 user: 나는 렌이라고… 본 기억이 안 나는데… 나 알아?
  - `docs/audits/glm-52-rp-ab/blind/S1-X.txt`
  - `docs/audits/glm-52-rp-ab/blind/S1-Y.txt`
- S2 user: 같이 갈래? *두리번*
  - `docs/audits/glm-52-rp-ab/blind/S2-X.txt`
  - `docs/audits/glm-52-rp-ab/blind/S2-Y.txt`
- S3 user: *가방 끈을 꼭 쥐고* 음… 조금만. 나 길 잘 모르거든.
  - `docs/audits/glm-52-rp-ab/blind/S3-X.txt`
  - `docs/audits/glm-52-rp-ab/blind/S3-Y.txt`
- S4 user: *물병을 꺼내 내민다* …목마르면 마셔. 나 괜찮으니까.
  - `docs/audits/glm-52-rp-ab/blind/S4-X.txt`
  - `docs/audits/glm-52-rp-ab/blind/S4-Y.txt`
