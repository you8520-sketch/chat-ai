# H1S-R — provider failure triage + exact H1S revalidation

Does not change PR #573 production source. H1S owner remains 725 chars.

- Original R1/R2/R3 HTTP 500s are not quality or length samples.
- Request envelope vs H1R is compared before any new provider call.
- Probe ladder: P0 tiny → H1R frozen control → exact H1S (only if prior steps are HTTP 200).
