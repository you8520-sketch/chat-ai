# 방장 해결 확인 (R4 이후, 모델 호출 0)

- 결과: confirmed

## 확인 전 goals_json
```json
{
  "version": 1,
  "goals": [
    {
      "id": "goal-2-1",
      "title": "세관 심부름꾼 추적: 뒷골목 석조 창고에서 철제 서류함을 회수한다",
      "status": "active",
      "source": "gm",
      "createdRound": 2,
      "claimedRound": 4,
      "claimSource": {
        "generationId": "12fcf1b4e041979e977ec0a9",
        "narrationDigest": "dee3ba855ee79a46267d02d7da113c03"
      }
    },
    {
      "id": "goal-2-2",
      "title": "등대 신호의 공백 조사: 곶 끝 등대에서 사흘 전 새벽의 목격 증언을 확보한다",
      "status": "active",
      "source": "gm",
      "createdRound": 2
    },
    {
      "id": "goal-4-1",
      "title": "강도현 체포 및 오 노인의 증언 확보: 도주를 저지하고 진실을 밝혀낸다",
      "status": "active",
      "source": "gm",
      "createdRound": 4
    }
  ]
}
```

## 확인 후 goals_json
```json
{
  "version": 1,
  "goals": [
    {
      "id": "goal-2-1",
      "title": "세관 심부름꾼 추적: 뒷골목 석조 창고에서 철제 서류함을 회수한다",
      "status": "completed",
      "source": "gm",
      "createdRound": 2,
      "claimedRound": 4,
      "claimSource": {
        "generationId": "12fcf1b4e041979e977ec0a9",
        "narrationDigest": "dee3ba855ee79a46267d02d7da113c03"
      },
      "closedRound": 4,
      "evidence": {
        "kind": "host_confirmed",
        "round": 4,
        "participantId": 1
      }
    },
    {
      "id": "goal-2-2",
      "title": "등대 신호의 공백 조사: 곶 끝 등대에서 사흘 전 새벽의 목격 증언을 확보한다",
      "status": "active",
      "source": "gm",
      "createdRound": 2
    },
    {
      "id": "goal-4-1",
      "title": "강도현 체포 및 오 노인의 증언 확보: 도주를 저지하고 진실을 밝혀낸다",
      "status": "active",
      "source": "gm",
      "createdRound": 4
    }
  ]
}
```

### 확인 후 HUD — 렌(host)
- [진행 중] 등대 신호의 공백 조사: 곶 끝 등대에서 사흘 전 새벽의 목격 증언을 확보한다
- [진행 중] 강도현 체포 및 오 노인의 증언 확보: 도주를 저지하고 진실을 밝혀낸다
- [방장 확인 완료] 세관 심부름꾼 추적: 뒷골목 석조 창고에서 철제 서류함을 회수한다

### 확인 후 HUD — 현(guest)
- [진행 중] 등대 신호의 공백 조사: 곶 끝 등대에서 사흘 전 새벽의 목격 증언을 확보한다
- [진행 중] 강도현 체포 및 오 노인의 증언 확보: 도주를 저지하고 진실을 밝혀낸다
- [방장 확인 완료] 세관 심부름꾼 추적: 뒷골목 석조 창고에서 철제 서류함을 회수한다

