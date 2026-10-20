| probe | targets before → after | block | chars | stmts | avg ms |
|---|---|---|---|---|---|
| L150-A4-stone | T4 INJECTED#3 → INJECTED#2 | reordered | 976 → 976 | 28 → 28 | 6.89 → 6.8 |
| L150-A5-injury | unchanged | reordered | 1081 → 1081 | 28 → 28 | 6.99 → 7.46 |
| L150-A6-milk-count | unchanged | same | 891 → 891 | 29 → 29 | 6.65 → 7.07 |
| L150-B3-seoyun | T57 DROPPED(max_facts) → DROPPED(max_chars); T64 DROPPED(max_chars) → INJECTED#2; T64 DROPPED(max_chars) → INJECTED#1 | +4/-5 lines | 1097 → 1086 | 31 → 31 | 8.65 → 8.62 |
| L150-C1-text | unchanged | same | 751 → 751 | 26 → 26 | 6.97 → 6.27 |
| L500-A4-stone | T4 INJECTED#3 → INJECTED#2 | reordered | 1036 → 1036 | 29 → 29 | 10.69 → 11.08 |
| L500-A5-injury | unchanged | reordered | 1081 → 1081 | 26 → 26 | 9.53 → 8.71 |
| L500-A6-milk-count | unchanged | same | 891 → 891 | 27 → 27 | 9.69 → 9.63 |
| L500-B3-seoyun | T64 CANDIDATE_MISS → INJECTED#2; T64 DROPPED(max_chars) → INJECTED#1 | +6/-6 lines | 1091 → 1081 | 27 → 30 | 11.88 → 12.4 |
| L500-C1-text | unchanged | same | 751 → 751 | 24 → 24 | 8.57 → 8.38 |
| T50-A2 | unchanged | same | 869 → 869 | 22 → 22 | 4.05 → 4.31 |
| T50-A3 | unchanged | same | 751 → 751 | 22 → 22 | 4.18 → 4.32 |
| T80-A4 | T4 INJECTED#3 → INJECTED#2 | reordered | 920 → 920 | 26 → 26 | 5.98 → 5.29 |
| T80-A5 | unchanged | reordered | 1081 → 1081 | 26 → 26 | 5.31 → 5.11 |
| T80-A6 | unchanged | same | 891 → 891 | 26 → 26 | 6.19 → 5.61 |
| T80-A7 | unchanged | same | 753 → 753 | 26 → 26 | 4.9 → 5.36 |
| T80-B3 | unchanged | +1/-1 lines | 1058 → 1059 | 26 → 26 | 6.04 → 5.92 |
| T80-C3 | T27 INJECTED#6 → INJECTED#5 | reordered | 1003 → 1003 | 26 → 26 | 5.47 → 5.9 |
| T90-A4 | T4 INJECTED#3 → INJECTED#2 | reordered | 920 → 920 | 26 → 26 | 5.35 → 6.37 |
| T90-B3 | unchanged | +1/-1 lines | 1058 → 1059 | 26 → 26 | 5.82 → 6.11 |
| X500-ankle-cause | unchanged | same | 830 → 830 | 24 → 24 | 7.7 → 7.86 |
| X500-current-injury | unchanged | same | 873 → 873 | 25 → 25 | 8.11 → 9.08 |
| X500-flank-current | unchanged | same | 980 → 980 | 24 → 24 | 7.28 → 8.58 |
| X500-measurement | T27 CANDIDATE_MISS → DROPPED(max_chars); T27 CANDIDATE_MISS → DROPPED(max_chars); T27 CANDIDATE_MISS → DROPPED(max_chars); T68 CANDIDATE_MISS → DROPPED(max_chars); T266 DROPPED(max_chars) → INJECTED#6; T304 INJECTED#6 → INJECTED#5; T319 INJECTED#5 → INJECTED#4; T379 INJECTED#4 → INJECTED#3; T402 INJECTED#3 → INJECTED#2; T447 INJECTED#2 → DROPPED(max_chars) | +1/-1 lines | 1074 → 1074 | 25 → 26 | 8.78 → 10.54 |
| X500-night-watch | unchanged | same | 1061 → 1061 | 28 → 28 | 9.15 → 9.91 |
| X500-yeom-occupation | T101 CANDIDATE_MISS → RECONCILED_OUT; T119 CANDIDATE_MISS → RECONCILED_OUT; T126 CANDIDATE_MISS → INJECTED#6; T161 CANDIDATE_MISS → RECONCILED_OUT; T246 CANDIDATE_MISS → RECONCILED_OUT; T260 CANDIDATE_MISS → RECONCILED_OUT; T267 CANDIDATE_MISS → INJECTED#5; T285 CANDIDATE_MISS → RECONCILED_OUT; T312 CANDIDATE_MISS → INJECTED#4; T313 CANDIDATE_MISS → DROPPED(duplicate_same_evidence); T313 CANDIDATE_MISS → INJECTED#3; T479 INJECTED#4 → INJECTED#2 | +4/-5 lines | 1060 → 1074 | 32 → 31 | 10.15 → 10.87 |
