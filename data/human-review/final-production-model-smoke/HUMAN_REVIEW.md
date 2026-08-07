# HUMAN_REVIEW — Final Production Model Smoke

```text
status: NOT_RUN — waiting for ChatGPT
DEEPSEEK_FINAL_SMOKE_CAPTURED
TERRA_FINAL_SMOKE_CAPTURED
FINAL_HUMAN_REVIEW_REQUIRED
```

Use `RAW_OUTPUTS_FOR_HUMAN_REVIEW.md`. Do not auto-PASS from heuristics.

## Checklist (each output)

```text
1. 캐릭터 말투/정체성 유지
2. 문장 자연스러움
3. 지문 우세
4. 대사 폭증 여부
5. 같은 화자의 대사를 한 문장씩 과도하게 분절하는 현상
6. 반대로 너무 긴 설명 대사 블록
7. 지문 자체의 과도한 한두 문장 단위 파편화
8. 장면 실제 진행
9. NPC/환경 능동성
10. severe user takeover
11. over-freeze
12. false shared memory
13. 시스템/프롬프트 누출
14. 이상한 외국어·깨진 문자
15. 반복·루프
16. 분량의 명백한 붕괴
17. 장면이 요약/예고로 끝나는지
```

## Dialogue criterion

```text
같은 화자의 자연스럽게 이어지는 2~4문장 정도의 대사는
한 대사 문단 안에 함께 있어도 정상이다.
습관적으로 한 문장마다 별도 문단으로 쪼개면 regression.
```

Dialogue share is not a hard numeric FAIL gate (~15–30% prose-dominant preferred).

## Merge

```text
merge: NOT_RUN — waiting for ChatGPT final human review
```
