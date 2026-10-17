# B7 replay probes, same session: 8124ca8f (round 3 code) vs 492a1273 (round 4), 50-call average
probe | statements 8124ca8f | statements 492a1273 | avg ms 8124ca8f | avg ms 492a1273
L150-A4-stone | 27 | 28 | 5.83 | 6.29
L150-A5-injury | 27 | 28 | 5.80 | 6.59
L150-A6-milk-count | 28 | 29 | 5.77 | 6.23
L150-B3-seoyun | 31 | 31 | 7.61 | 8.12
L150-C1-text | 26 | 26 | 5.59 | 5.90
L500-A4-stone | 30 | 30 | 8.88 | 9.35
L500-A5-injury | 27 | 27 | 7.73 | 8.22
L500-A6-milk-count | 28 | 28 | 7.86 | 8.35
L500-B3-seoyun | 28 | 28 | 10.24 | 10.66
L500-C1-text | 26 | 25 | 7.80 | 8.22
T50-A2 | 24 | 23 | 3.92 | 3.76
T50-A3 | 24 | 23 | 3.90 | 4.05
T80-A4 | 29 | 27 | 5.17 | 5.17
T80-A5 | 29 | 27 | 4.95 | 4.86
T80-A6 | 29 | 27 | 4.89 | 4.94
T80-A7 | 29 | 27 | 4.69 | 4.71
T80-B3 | 29 | 27 | 5.51 | 5.38
T80-C3 | 29 | 27 | 5.24 | 5.12
T90-A4 | 30 | 27 | 5.08 | 5.18
T90-B3 | 30 | 27 | 5.44 | 5.51
X500-ankle-cause | 25 | 25 | 6.55 | 8.43
X500-current-injury | 26 | 26 | 7.23 | 7.85
X500-flank-current | 25 | 25 | 6.59 | 7.02
X500-measurement | 26 | 26 | 7.72 | 8.47
X500-night-watch | 26 | 26 | 7.17 | 7.89
X500-yeom-occupation | 31 | 32 | 7.95 | 8.84
mean | 27.65 | 27.00 | 6.35 | 6.74

# Boundary probe (synthetic, real save path), 20-call average
scenario | horizon | rows | ok 8124ca8f | ok 492a1273 | statements 8124ca8f | statements 492a1273 | avg ms 8124ca8f | avg ms 492a1273
chain-1 | 500 | 480 | True | True | 6 | 6 | 6.14 | 5.5
chain-1 | 1000 | 980 | True | True | 6 | 6 | 7.74 | 7.42
chain-3 | 500 | 442 | True | True | 6 | 6 | 4.98 | 4.77
chain-3 | 1000 | 942 | True | True | 6 | 6 | 7.44 | 7.29
chain-4 | 500 | 423 | False | True | 7 | 6 | 5.79 | 4.56
chain-4 | 1000 | 923 | False | True | 7 | 6 | 7.98 | 7.09
chain-10 | 500 | 309 | False | True | 7 | 6 | 4.74 | 4.04
chain-10 | 1000 | 809 | False | True | 7 | 6 | 7.29 | 6.35
one-correction-then-210-others | 500 | 709 | False | True | 8 | 6 | 8.84 | 5.82
one-correction-then-210-others | 1000 | 1209 | False | True | 8 | 6 | 11.89 | 8.61
large-chat-chain-10-plus-300-others | 3000 | 10600 | False | True | 8 | 6 | 56.43 | 50.89
