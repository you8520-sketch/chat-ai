# PR620 quality verification — review packet index

Complete assistant **visible prose** for GPT/user review. **New provider calls during correction: 0.**

Authoritative style tags: [`STYLE_OCCURRENCE_MATRIX.json`](STYLE_OCCURRENCE_MATRIX.json)  
Legacy regex (non-authoritative): [`OCCURRENCE_MATRIX.json`](OCCURRENCE_MATRIX.json)

## Snapshot A (T1)

| Sample | Raw | Meta | Visible chars (observation only) | Style summary |
|--------|-----|------|----------------------------------|---------------|
| DeepSeek r1 | [r1.txt](raw/SNAPSHOT_A_T1/deepseek-v4-pro-0813/r1.txt) | [r1.json](meta/SNAPSHOT_A_T1/deepseek-v4-pro-0813/r1.json) | 2752 | Strong voice + kitchen progression; mild open narrator summary |
| DeepSeek r2 | [r2.txt](raw/SNAPSHOT_A_T1/deepseek-v4-pro-0813/r2.txt) | [r2.json](meta/SNAPSHOT_A_T1/deepseek-v4-pro-0813/r2.json) | 1219 | Ramen/shower branch; dialogue-forward |
| DeepSeek r3 | [r3.txt](raw/SNAPSHOT_A_T1/deepseek-v4-pro-0813/r3.txt) | [r3.json](meta/SNAPSHOT_A_T1/deepseek-v4-pro-0813/r3.json) | 1823 | Chicken + proximity; strong relationship banter |
| Gemini 3.7 r1 | [r1.txt](raw/SNAPSHOT_A_T1/gemini-3.7-flash/r1.txt) | [r1.json](meta/SNAPSHOT_A_T1/gemini-3.7-flash/r1.json) | 2710 | Ornate setup; voice in dialogue |
| Gemini 3.7 r2 | [r2.txt](raw/SNAPSHOT_A_T1/gemini-3.7-flash/r2.txt) | [r2.json](meta/SNAPSHOT_A_T1/gemini-3.7-flash/r2.json) | 3420 | Long narrator intros; cooking banter |
| Gemini 3.7 r3 | [r3.txt](raw/SNAPSHOT_A_T1/gemini-3.7-flash/r3.txt) | [r3.json](meta/SNAPSHOT_A_T1/gemini-3.7-flash/r3.json) | 2591 | Sentinel-trait essay mid-scene |

## Snapshot B (T2)

| Sample | Raw | Meta | Visible chars (observation only) | Style summary |
|--------|-----|------|----------------------------------|---------------|
| DeepSeek r1 | [r1.txt](raw/SNAPSHOT_B_T2/deepseek-v4-pro-0813/r1.txt) | [r1.json](meta/SNAPSHOT_B_T2/deepseek-v4-pro-0813/r1.json) | 2645 | Post-kiss inner gloss; micro-action stall |
| DeepSeek r2 | [r2.txt](raw/SNAPSHOT_B_T2/deepseek-v4-pro-0813/r2.txt) | [r2.json](meta/SNAPSHOT_B_T2/deepseek-v4-pro-0813/r2.json) | 2567 | Dialogue answer; advances to next beat |
| DeepSeek r3 | [r3.txt](raw/SNAPSHOT_B_T2/deepseek-v4-pro-0813/r3.txt) | [r3.json](meta/SNAPSHOT_B_T2/deepseek-v4-pro-0813/r3.json) | 3309 | Opening recap loop; explain-after-show |
| Gemini 3.7 r1 | [r1.txt](raw/SNAPSHOT_B_T2/gemini-3.7-flash/r1.txt) | [r1.json](meta/SNAPSHOT_B_T2/gemini-3.7-flash/r1.json) | 2850 | Clinical sensory blocks; strong voice |
| Gemini 3.7 r2 | [r2.txt](raw/SNAPSHOT_B_T2/gemini-3.7-flash/r2.txt) | [r2.json](meta/SNAPSHOT_B_T2/gemini-3.7-flash/r2.json) | 3222 | Ornate open then physical progression |
| Gemini 3.7 r3 | [r3.txt](raw/SNAPSHOT_B_T2/gemini-3.7-flash/r3.txt) | [r3.json](meta/SNAPSHOT_B_T2/gemini-3.7-flash/r3.json) | 2806 | Guidespeak + dialogue; less action loop |

## Supporting files

- [`raw-output-index.json`](raw-output-index.json) — all 12 rows + token/latency metadata
- [`REAL_CAPSULE_SOURCE_MAP.json`](REAL_CAPSULE_SOURCE_MAP.json)
- [`CURRENT_OWNER_MAP.json`](CURRENT_OWNER_MAP.json)
- [`input-parity.json`](input-parity.json)
- [`CLASSIFICATION.json`](CLASSIFICATION.json)
