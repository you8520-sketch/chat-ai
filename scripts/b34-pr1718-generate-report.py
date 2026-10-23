#!/usr/bin/env python3
"""Generate docs/evidence/b34-pr1718/REPORT.md from live-runs-detailed.jsonl."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EV = ROOT / "docs/evidence/b34-pr1718"
RUNS = EV / "live-runs-detailed.jsonl"
OUT = EV / "REPORT.md"

TARGETS = [
    ("user_refusal", "나는 내 진술을 황실 감찰관에게 전달하는 데 동의하지 않았어."),
    (
        "user_review_first",
        "먼저 기록을 내가 직접 확인하겠어. 누구에게 전달할지는 그다음에 정하겠다.",
    ),
    ("wolfgang_forward_ban", "이 진술은 감찰관에게 전달하지 마라."),
]


def hit(f: dict) -> list[str]:
    q = f.get("source_quote") or ""
    t = f.get("fact_text") or ""
    found = []
    for tid, needle in TARGETS:
        if needle in q or needle in t:
            found.append(tid)
    return found


def main() -> None:
    runs = [json.loads(line) for line in RUNS.read_text(encoding="utf-8").splitlines() if line.strip()]
    old = [r for r in runs if r["path"] == "OLD_shared_status_on"]
    new = [r for r in runs if r["path"] == "NEW_independent_episodic"]
    cost = json.loads((EV / "cost-summary.json").read_text(encoding="utf-8"))
    cond = json.loads((EV / "execution-conditions.json").read_text(encoding="utf-8"))

    lines: list[str] = []
    lines.append("# B34 PR #1718 — Luna live quality evidence (렌/볼프강 SAFE)\n")
    lines.append(f"Code HEAD: `{cond['codeHead']}`. Machine-readable runs: [`live-runs-detailed.jsonl`](./live-runs-detailed.jsonl) (includes full `providerText` per call).\n")
    lines.append("## Execution conditions\n")
    for k, v in cond.items():
        lines.append(f"- **{k}**: `{v}`\n")
    lines.append(
        f"\nThis capture re-ran **5× OLD Shared (status ON, episodic in schema)** + **5× NEW independent episodic** "
        f"because the earlier PR run (`/opt/cursor/artifacts/b34/live-runs.jsonl`) kept summaries only, not provider JSON.\n"
    )
    lines.append(
        f"**Total API spend this capture:** ${cost['totalUsd']:.6f} (≈ ₩{cost['totalKrw']:.2f} at {cost['fxEffectiveKrwPerUsd']:.2f}/USD).\n"
    )

    def section(title: str, rows: list[dict]) -> None:
        lines.append(f"## {title}\n")
        for r in rows:
            lines.append(f"### Run {r['run']}\n")
            lines.append(
                f"- Tokens: in={r.get('inputTokens')} out={r.get('outputTokens')} · "
                f"cost=${r.get('usd', 0):.6f} · transportOk={r.get('transportOk', 'n/a')}\n"
            )
            lines.append(
                f"- Counts: raw={r.get('rawFactCount')} · parse-valid={r.get('parseValidFactCount')} · "
                f"persist-insertable={r.get('persistInsertableCount')} · "
                f"skipped={r.get('persistSkippedReasons', [])}\n"
            )
            if r.get("storedRowCount") is not None:
                lines.append(f"- Stored rows after real owners: **{r['storedRowCount']}**\n")
            lines.append(
                f"- Provider JSON: see `live-runs-detailed.jsonl` entry path={r['path']} run={r['run']} (`providerText` field).\n"
            )
            lines.append("| source_quote | fact_text | parse_valid | persist_stage | persist_detail | stored | target_events |\n")
            lines.append("|---|---|:---:|:---|:---|:---:|:---|\n")
            for f in r.get("facts", []):
                targets = ", ".join(hit(f)) or "—"
                sq = (f.get("source_quote") or "").replace("|", "\\|")
                ft = (f.get("fact_text") or "").replace("|", "\\|")
                lines.append(
                    f"| {sq} | {ft} | {f.get('parse_valid')} | {f.get('persist_stage')} | "
                    f"{f.get('persist_detail') or '—'} | {f.get('stored', '—')} | {targets} |\n"
                )
            lines.append("")

    section("OLD — Shared status ON (widget + suggestions + relationship + episodic)", old)
    section("NEW — Independent episodic-only (post-#1718 path)", new)

    lines.append("## `relationship_ledger_owned` drops (NEW path only)\n")
    lines.append(
        "Filter owner: `detectRelationshipLedgerOwnedFact` in `src/lib/episodicMemoryFacts.ts`. "
        "It blocks facts whose **attribute** matches relationship-ledger promise/item patterns, "
        "or whose **category** is `relationship`/`item` and text matches item-transfer lexicon.\n"
    )
    for r in new:
        for f in r.get("facts", []):
            if f.get("persist_stage") == "relationship_ledger_owned":
                lines.append(
                    f"- **Run {r['run']}** — attribute `{f.get('attribute')}` · detail `{f.get('persist_detail')}` · "
                    f"quote: “{f.get('source_quote')}” · fact_text: {f.get('fact_text')}\n"
                )
    lines.append(
        "\n**Evidence read (no code change):** Both drops use attributes ending in `_transfer` "
        "(`consent_to_statement_transfer`, `refused_statement_transfer`), which match "
        "`RELATIONSHIP_LEDGER_ITEM_ATTRIBUTE` (`…|transfer|transferred|…`). "
        "The blocked content is the USER **refusal to forward the statement**, not a possession/ledger item transfer. "
        "The same USER quote was stored in other runs when the model used attributes without `transfer` "
        "(e.g. `statement_consent`, `record_review_decision`). "
        "This is consistent with **keyword-based owner separation**, but **can misclassify important USER consent/refusal facts** when the model names the attribute with `_transfer`.\n"
    )

    lines.append("## Target event coverage (parse-valid facts with verbatim quote match)\n")
    for label, rows in [("OLD", old), ("NEW", new)]:
        counts = {tid: 0 for tid, _ in TARGETS}
        for r in rows:
            for f in r.get("facts", []):
                if not f.get("parse_valid"):
                    continue
                for tid in hit(f):
                    counts[tid] += 1
        lines.append(f"- **{label}** (5 runs): " + ", ".join(f"{k}={counts[k]}/5" for k, _ in TARGETS) + "\n")

    OUT.write_text("".join(lines), encoding="utf-8")
    print("Wrote", OUT)


if __name__ == "__main__":
    main()
