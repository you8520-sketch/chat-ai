# 볼프강 대표 1장 — 실제 생성 직전 인가 게이트

**기준:** 병합된 #1510 (`2cae5c7c` on `main`) + GPT 검수 댓글 6098945856.

**이 기록의 범위:** 기존 owner 재사용, 런타임 모델/참조/POST 한도/비용 불확실성 보고.

**금지:** 유료 이미지 POST, 13장 추가, 운영 게시, 머지, 새 이미지 시스템, 볼프강 전용 retry rewrite.

검사 시각: 2026-10-10. Cloud Agent에서 Railway project-token GraphQL + 공개 HTTP HEAD. WSL 로컬 디스크는 이 환경에 없음.

## 환경

| 항목 | 관측 |
|---|---|
| `origin/main` | `752c7f3a` (포함: #1510 `2cae5c7c`, 이후 #1503) |
| Railway 최신 GitHub deploy | `enchanting-ambition / production` → `752c7f3a` (2026-10-10T15:14:44Z) |
| Railway project / service / env | `enchanting-ambition` / `chat-ai` / `production` |
| WSL | 이 Cloud VM에 `/mnt/c`, `/mnt/wsl` 없음. WSL `.env`는 미검증 |
| Railway SSH | `RAILWAY_SSH_*` 11바이트 stub. 운영 SQLite `/data/app.db` 미읽음 |
| 이 Cloud process `OPENAI_IMAGE_MODEL` | UNSET → 코드 기본값만 적용. 운영 런타임이 아님 |

## 실제 적용 모델

기존 owner: `resolveOfficialAssetImageModel` → `resolveChatImageGenerationModel` (`OPENAI_IMAGE_MODEL` trim, 없으면 `gpt-image-2`).

Railway `chat-ai` production 변수(값 자체는 모델 id, API 키가 아님):

- `OPENAI_IMAGE_MODEL=gpt-image-2.5-sunburst`
- `OPENAI_API_KEY` PRESENT (비어 있지 않음; 값은 기록하지 않음)
- `NEXTAUTH_URL=https://hav.chat`
- `RAILWAY_PUBLIC_DOMAIN=hav.chat`
- `RAILWAY_STATIC_URL=hav.chat`

**검증된 운영 모델은 `gpt-image-2.5-sunburst`이다.** 코드 기본값 `gpt-image-2`를 운영 모델이라고 쓰면 안 된다. 알려진 GPT Image id allowlist에 sunburst가 포함된다 (`CHAT_IMAGE_GENERATION_KNOWN_MODEL_IDS` / `isLucianSig4ProofSupportedImageModel`).

운영 공식 라이브 플래그는 모두 꺼져 있다 (`OFFICIAL_STYLE_PROOF_LIVE=0`, `OFFICIAL_ANCHOR_APPROVAL_LIVE=0`, Lucian publish/variations/finalize=0). `OFFICIAL_ANCHOR_DRAFT_KEY=pilot-rf-v4-03` (루시안). 이 플래그를 켜면 볼프강 1장이 아니라 기존 3캐릭터 proof 또는 다른 앵커가 돈다. 켜지 말 것.

## Cluster B 참조 접근

`buildClusterBRofanStyleSeed({ NEXTAUTH_URL: "https://hav.chat" })`가 만드는 대표 STYLE ONLY URL 3장:

| URL | HEAD | Content-Type | bytes | local `public/` |
|---|---|---|---|---|
| `https://hav.chat/official-supply/style-seeds/romance-fantasy-cluster-b-v1/primary/b7-black-gold-uniform.webp` | 200 | `image/webp` | 214512 | 214512 |
| `https://hav.chat/.../b13-black-red-fur.webp` | 200 | `image/webp` | 182512 | 182512 |
| `https://hav.chat/.../b5-red-dress-female.webp` | 200 | `image/webp` | 173714 | 173714 |

`https://chat-ai-production-4275.up.railway.app/...` 는 `hav.chat`으로 리다이렉트되어 동일 바이트. 구 호스트 `chat-ai-production-3e84.up.railway.app` 은 404.

런타임 준비 owner `prepareOfficialImageReferences`: origin이 `NEXTAUTH_URL` / `RAILWAY_PUBLIC_DOMAIN` / `RAILWAY_STATIC_URL`과 같으면 `public/` 로컬 파일을 읽고 provider 전에 실패하면 `OfficialImageTransportError(providerAttempted=false)`. Cluster B primary는 임의 HTTPS fetch가 아니라 platform public storage여야 한다.

#1510의 `NEXTAUTH_URL=https://example.test` 합성 preflight는 배포 URL 증거가 아니다. 이번 검사가 배포 호스트 증거다.

## 한 번 `rep` 실행의 provider POST

기존 owner만. 볼프강 전용 retry/fallback 플래그 없음.

1. `runOfficialAssetSlot` 한 호출 = `claimSlot` 1회 + `transport.generate` 1회.
2. `openAiOfficialImageTransport` → `callOpenAiImageEditWithSafetyFallback`.
3. 그 함수는 primary 1회, **인식된 safety rejection일 때만** strict safety fallback 1회. 성공이면 fallback 없음.
4. 따라서 **승인된 1회 실행의 POST 수는 1 또는 2**.
5. 1회 실행이 실패한 뒤 같은 슬롯을 다시 호출하면 추가 1–2 POST.
6. `ROFAN_V4_PRODUCTION_BATCH_CONFIG.maxAttemptsPerSlot=2` × `MAX_PROVIDER_ATTEMPTS=2` = **중첩 상한 4 POST**. 1장 승인 ≠ 4회 과금 승인.
7. Cluster B proof 배치 설정은 `maxAttemptsPerSlot=1`이라 그 배치를 쓰면 슬롯 재시도는 막히지만, safety fallback은 그대로라 **여전히 최대 2 POST**.
8. `upload_pending` 재시도는 spool replay라 provider POST를 추가하지 않는다.

**요청할 인가:** Wolfgang `rep`에 대해 `runOfficialAssetSlot` **1회**. 기존 safety fallback이 켜지면 2번째 POST는 그 owner의 동작이다. 슬롯 재시도·13장·라이브 플래그 ON은 별도 승인. 글로벌 retry rewrite 하지 않음.

기존 스크립트 주의:

- `official-supply:cluster-b-v4-style-proof` 는 01/02/09 **3명** representative.
- `official-supply:generate-rofan-v4-anchors` 는 `pilot-rf-v4-02`를 거부한다 (이미 proof key).
- `official-supply:quality-shot-qa` 는 루시안 sig4.

운영 DB에 `pilot-rf-02` / `pilot-rf-v4-02` row가 있는지는 SSH 불가라 미확인. POST 전에 운영자가 대상 draft key를 확인해야 한다.

## 비용 / 과금 불확실성

| 항목 | 값 | 의미 |
|---|---|---|
| exact provider USD | **null** | `calculateGptImage2CostUsd`는 POST 이후 usage 필요. sunburst도 같은 공식 |
| reserve | `$0.12` / image (`ROFAN_V4_PRODUCTION_BATCH_CONFIG`) | 내부 예약. provider hard cap 아님 |
| planning 2-POST | `$0.24` | reserve × `MAX_PROVIDER_ATTEMPTS`. hard cap 아님 |
| character cap | `$2.50` | 내부 배치 예산 |
| Cluster B proof reserve | `$1` / image, character `$1` | proof 배치를 쓸 때의 다른 내부 한도 |
| unknown cost | 가능 | `usage_absent` / 실패한 호출은 `hasUnknownAttemptCost` |
| closest observed | Lucian sig4 1-ref `$0.030653` | 다른 슬롯·3:2·1 identity. sunburst 대표 3-ref 견적 아님 |

한 POST가 실제로 얼마인지는 usage 전까지 알 수 없다. `$0.12`/`$0.24`/`$2.50`를 청구 상한으로 말하지 말 것.

## STOP

유료 POST 0. 픽셀 검수 없음. 운영 게시/머지 없음.

다음 승인 질문: **sunburst + hav.chat Cluster B 3장으로 `runOfficialAssetSlot` 1회(최대 2 POST, 슬롯 재시도 없음)를 허용하는가?**
