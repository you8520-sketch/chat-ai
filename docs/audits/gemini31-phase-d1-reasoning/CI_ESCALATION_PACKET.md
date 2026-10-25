# CI Escalation Packet (Phase D.3 — handoff ready)

**Status:** frozen for provider support. **No prompt bodies. No API keys. No raw reasoning.**

## Handoff index

| Document | Location |
|----------|----------|
| Evidence table | `docs/audits/gemini31-phase-d3-escalation/EVIDENCE_TABLE.md` |
| Support message (send) | `docs/audits/gemini31-phase-d3-escalation/SUPPORT_MESSAGE.md` |
| Provider response log | `docs/audits/gemini31-phase-d3-escalation/PROVIDER_RESPONSE_PLACEHOLDER.md` |
| Machine-readable evidence | `docs/audits/gemini31-phase-d3-escalation/evidence.json` |
| D.3 report | `docs/audits/gemini31-phase-d3-escalation/REPORT.md` |

Rebuild evidence (no inference): `node --conditions=react-server --import tsx scripts/gemini31-phase-d3-build-escalation-evidence.ts`

---

## Questions (unchanged — see SUPPORT_MESSAGE.md)

1. Does CI normalize `reasoning_effort: "low"` to native Gemini LOW?
2. If forwarded, do all eligible Gemini routes interpret identically?
3. Upstream route/provider + LOW confirmation for supplied UUIDs?
4. Why ~2× reasoning tokens and +6.4 s first-visible vs OR→Google on paired hashes?
5. Does `cache_read_input_tokens = 0` mean explicit no prefix-cache read?

---

## Primary UUIDs (EXACT_UUID_JOIN)

| UUID | Use |
|------|-----|
| `9f0a998e-02f7-4f27-a194-112e668786bc` | Normal CI LOW |
| `d4d9bd40-dd5e-441b-ae22-8fbf249e7ec9` | Slower CI LOW (~p75) |
| `2c3191ad-5d4b-4162-a2d8-e6fbfcbf81f6` | `reasoning={effort:low}` on CI |
| `16c2cfb1-211f-48fe-8bd0-01d0391023b5` | Omitted control |

Secondary (TOKEN_FINGERPRINT_JOIN — not exact): `868fc5bf-f3a2-4cf7-82c4-e1a574733e73`, `a75fb36a-7f41-4176-9fb8-403936d30844`

---

## Evidence summary (do not overstate)

**Allowed:**

- CI behavior differs materially from reference LOW path (OR→Google)
- CI LOW mapping is **not independently verified**
- Cache read was **recorded as zero** in usage history

**Forbidden until provider confirms:**

- "CI ignores LOW" / "CI cache broken" / "CI routing incorrectly" / "Google is slow"

---

## Aggregate metrics (D.1 parity, frozen)

| Metric | CI | OR |
|--------|-----|-----|
| Reasoning P50 | 1159 | 536 (2.02×) |
| First-visible P50 | 13301 ms | 6166 ms (+6437 ms) |
| Production wire | `reasoning_effort=low` | `reasoning.effort=low` |

---

## Phase gate

```text
PHASE_E_READY: NO
NEXT: SEND_CI_ESCALATION_AND_WAIT_FOR_PROVIDER_RESPONSE
```

Historical D.1/D.2 detail: `gemini31-phase-d1-reasoning/REPORT.md`, `gemini31-phase-d2-reasoning/REPORT.md`
