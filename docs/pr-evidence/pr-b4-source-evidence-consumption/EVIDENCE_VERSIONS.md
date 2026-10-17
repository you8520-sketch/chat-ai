# Evidence versions

| Evidence | Code version | User excerpt label on the wire |
|---|---|---|
| `rp-eval/A-b3-main-output.txt` | PR #1641 | `유저가 직접 쓴 원문` |
| `rp-eval/A-before-output.txt`, `rp-eval/B-before-output.txt` | main `f85f00bb` | `유저가 직접 쓴 원문` |
| `rp-eval/A-after-output.txt`, `rp-eval/B-after-output.txt`, `rp-eval/C-after-output.txt` | `a4ff36e4` | `유저 발언 발췌` |
| `rp-eval/A-final-output.txt`, `rp-eval/B-final-output.txt` | `fb781523` | `유저 발언 발췌` |
| `logs/wire-final-scenes-A-C.log`, `logs/wire-final-scene-B.log` | label fix commit (no model call) | `유저 입력 발췌` |
| `logs/test-after-label-fix.log` | label fix commit | `유저 입력 발췌` |

The real-model outputs were generated before the label was renamed to `유저 입력 발췌`; they are not re-run. The only wire difference between them and the final code is that label word.
