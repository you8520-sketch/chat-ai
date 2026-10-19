| probe | targets main → branch | block | chars | stmts | avg ms |
|---|---|---|---|---|---|
| L150-A4-stone | T4 INJECTED#3 → INJECTED#2 | reordered | 976 → 976 | 28 → 28 | 7.4 → 6.16 |
| L150-A5-injury | T48 INJECTED#4 → INJECTED#6; T55 INJECTED#3 → INJECTED#5 | reordered | 1081 → 1081 | 28 → 28 | 6.33 → 6.36 |
| L150-A6-milk-count | unchanged | same | 891 → 891 | 29 → 29 | 6.47 → 6.84 |
| L150-B3-seoyun | T57 DROPPED(max_facts) → DROPPED(max_chars); T64 DROPPED(max_chars) → INJECTED#2; T64 DROPPED(max_chars) → INJECTED#1 | +4/-5 lines | 1097 → 1086 | 31 → 31 | 7.97 → 8.38 |
| L150-C1-text | unchanged | same | 751 → 751 | 26 → 26 | 6.08 → 5.9 |
| L500-A4-stone | T4 INJECTED#3 → INJECTED#2 | +2/-1 lines | 1036 → 1086 | 29 → 29 | 9.69 → 9.21 |
| L500-A5-injury | T48 INJECTED#4 → INJECTED#6; T55 INJECTED#3 → INJECTED#5 | reordered | 1081 → 1081 | 26 → 26 | 8.35 → 8.06 |
| L500-A6-milk-count | unchanged | same | 891 → 891 | 27 → 27 | 8.53 → 10.48 |
| L500-B3-seoyun | T64 CANDIDATE_MISS → INJECTED#3; T64 DROPPED(max_chars) → INJECTED#1 | +6/-6 lines | 1091 → 1081 | 27 → 27 | 10.77 → 12.08 |
| L500-C1-text | unchanged | same | 751 → 751 | 24 → 24 | 8.29 → 7.86 |
| T50-A2 | unchanged | same | 869 → 869 | 22 → 22 | 3.7 → 3.84 |
| T50-A3 | unchanged | same | 751 → 751 | 22 → 22 | 3.78 → 3.85 |
| T80-A4 | T4 INJECTED#3 → INJECTED#2 | reordered | 920 → 920 | 26 → 26 | 5.22 → 4.88 |
| T80-A5 | T48 INJECTED#4 → INJECTED#6; T55 INJECTED#3 → INJECTED#5 | reordered | 1081 → 1081 | 26 → 26 | 5.13 → 4.79 |
| T80-A6 | unchanged | same | 891 → 891 | 26 → 26 | 5.1 → 4.8 |
| T80-A7 | unchanged | same | 753 → 753 | 26 → 26 | 4.78 → 4.74 |
| T80-B3 | unchanged | reordered | 1058 → 1058 | 26 → 26 | 5.37 → 5.17 |
| T80-C3 | T59 INJECTED#4 → INJECTED#5; T68 INJECTED#3 → INJECTED#4 | reordered | 1003 → 1003 | 26 → 26 | 5.11 → 5.01 |
| T90-A4 | T4 INJECTED#3 → INJECTED#2 | reordered | 920 → 920 | 26 → 26 | 5.19 → 5.24 |
| T90-B3 | unchanged | reordered | 1058 → 1058 | 26 → 26 | 5.56 → 5.21 |
| X500-ankle-cause | unchanged | same | 830 → 830 | 24 → 24 | 7.26 → 7.2 |
| X500-current-injury | T312 INJECTED#2 → INJECTED#3; T312 INJECTED#1 → INJECTED#2 | reordered | 873 → 873 | 25 → 25 | 7.87 → 7.77 |
| X500-flank-current | unchanged | same | 980 → 980 | 24 → 24 | 7.24 → 7.32 |
| X500-measurement | T27 CANDIDATE_MISS → DROPPED(max_chars); T27 CANDIDATE_MISS → DROPPED(max_chars); T27 CANDIDATE_MISS → DROPPED(max_chars); T68 CANDIDATE_MISS → DROPPED(max_chars); T266 DROPPED(max_chars) → INJECTED#6; T304 INJECTED#6 → INJECTED#5; T319 INJECTED#5 → INJECTED#4; T379 INJECTED#4 → INJECTED#3; T402 INJECTED#3 → INJECTED#2; T447 INJECTED#2 → DROPPED(max_chars) | +1/-1 lines | 1074 → 1074 | 25 → 26 | 8.37 → 9.61 |
| X500-night-watch | T348 INJECTED#7 → DROPPED(max_chars); T416 INJECTED#5 → INJECTED#6 | +1/-1 lines | 1061 → 1071 | 28 → 28 | 8.51 → 8.65 |
| X500-yeom-occupation | T101 CANDIDATE_MISS → RECONCILED_OUT; T119 CANDIDATE_MISS → RECONCILED_OUT; T126 CANDIDATE_MISS → DROPPED(max_chars); T161 CANDIDATE_MISS → RECONCILED_OUT; T246 CANDIDATE_MISS → RECONCILED_OUT; T260 CANDIDATE_MISS → RECONCILED_OUT; T267 CANDIDATE_MISS → INJECTED#6; T285 CANDIDATE_MISS → RECONCILED_OUT; T292 INJECTED#1 → INJECTED#2; T312 CANDIDATE_MISS → INJECTED#5; T313 CANDIDATE_MISS → DROPPED(duplicate_same_evidence); T313 CANDIDATE_MISS → INJECTED#4; T479 INJECTED#4 → INJECTED#3 | +4/-5 lines | 1060 → 1066 | 32 → 28 | 9.4 → 8.66 |
