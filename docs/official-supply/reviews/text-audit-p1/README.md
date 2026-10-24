# 텍스트 품질 P1 — GPT 검수 패키지 (적용되지 않은 후보)

이 폴더는 **검수용 증거**입니다. 어떤 파일도 런타임·Text Lock·운영 DB·기존 공식 캐릭터(#50 루시안, #51 볼프강) 설정에 적용되지 않으며, 로더(`src/lib/officialSupply/pilot/`)가 읽지 않는 `docs/` 경로에만 있습니다. 병합 대상이 아닌 별도 브랜치(PR 없음)로 제공합니다.

## 공개 범위 확인

- 저장소는 공개입니다. 이 폴더의 원고·비밀은 모두 **허구 캐릭터의 설정**이며, 이미 저장소의 `src/lib/officialSupply/pilot/characters/pilot-rf-02.json`, `pilot-rf-03.json`에 공개되어 있는 내용입니다(기존 `reviews/` 문서와 같은 범위).
- 새 비공개 원고·운영 DB 내용·사용자 개인정보·인증 정보는 없습니다. RP 와이어는 격리된 임시 DB(`installIsolatedTestDatabase`)에서 공개 저장소 원고로 오프라인 생성했습니다(공급자 호출 없음).
- 운영 저장본(production DB)의 #50/#51 JSON과 실제 배포 와이어는 확인하지 않았습니다. 아래 ‘현재’는 **저장소 `main`의 pilot 원고**를 뜻합니다.

## 파일

| 파일 | 내용 |
| --- | --- |
| `CANDIDATES.md` | 두 캐릭터의 개선 후보 전체: 항목별 이유, 기존 canon 근거, BEFORE/AFTER 전문(인사말·크리에이터 코멘트 포함) |
| `METRICS.md` | 길이·토큰 추정·중복 횟수·Text Lock 영향 표, 게이트 결과 |
| `COMPILER_FIX_PROOF.md` | 공통 컴파일 버그의 원인·수정·전후 증거 |
| `BONDS_RECAP_PROPOSAL.md` | `buildPart1Recap` 최소 설계 제안(이번 PR 미반영) |
| `manuscripts/original-*.review.md` | 현행 원고 전체(공식 `official-supply:review-character` 출력: 공개 소개, 인사말, 시스템 프롬프트, 말투, 비밀 등) |
| `manuscripts/pilot-rf-0{2,3}.current.draft.json` | 현행 컴파일 드래프트 전체 |
| `candidates/*.candidate.{bible,draft}.json` | 후보 바이블·컴파일 드래프트 전체 |
| `wire/wire-*-current-main-old-compiler.txt` | **BEFORE**: `main`의 컴파일러 + 현행 원고의 최종 RP 와이어(`buildContext` 출력 + 비공개 말투 블록) |
| `wire/wire-*-current-fixed-compiler.txt` | 컴파일러 수정만 적용한 와이어(원고 동일) |
| `wire/wire-*-candidate-fixed-compiler.txt` | **AFTER**: 컴파일러 수정 + 후보 원고 와이어 |
| `wire/DIFF-*.diff` | 위 와이어 간 diff |

와이어 파일 끝의 `=== PRIVATE SPEECH CONTROL BLOCK ===` 절은 시스템 프롬프트 안에 이미 들어 있는 비공개 말투 블록을 가독용으로 다시 붙인 것입니다(공급자로 전송되는 내용이 아님).

## 읽는 순서

1. `COMPILER_FIX_PROOF.md` (원고와 무관한 공통 버그)
2. `CANDIDATES.md` (원고 후보 — GPT 문학 검수 대상)
3. `METRICS.md`, `BONDS_RECAP_PROPOSAL.md`

Cursor는 문학 점수를 매기지 않습니다. 게이트 통과는 형식·계약 검사일 뿐 문학적 승인이 아닙니다.
