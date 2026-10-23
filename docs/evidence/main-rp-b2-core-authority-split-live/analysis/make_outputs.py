import json, glob, os, random, re, sys
R = sys.argv[1]
OUT = sys.argv[2]
FX = 1700
SCENES = ["S1_false_past_probe", "S2_user_remark_emotion", "S3_npc_event_no_cue", "S4_temporal_state"]
MODELS = ["deepseek-v4.1-flash", "gemini-3.8-flash", "gpt-6.1-sol"]
rows = {}
for f in sorted(glob.glob(R + "/*.json")):
    d = json.load(open(f))
    m = re.match(r"g7_(S\d_[a-z_]+?)_(cur|cand)_(.+?)(?:_r(\d))?$", d["caseId"])
    scene, arm, model, rep = m.group(1), m.group(2), m.group(3), int(m.group(4) or 1)
    u = d.get("usage") or {}
    rows[(scene, model, rep, arm)] = dict(
        text=d["text"], chars=len(d["text"]), prompt=u.get("prompt_tokens"), completion=u.get("completion_tokens"),
        cached=(u.get("prompt_tokens_details") or {}).get("cached_tokens"), reported=u.get("cost"),
        budgetKrw=round(d["budgetedUsd"] * FX, 2), finish=d.get("finishReason"), aborted=d.get("aborted"),
        latency=d.get("latencyMs"), caseId=d["caseId"], resolved=d.get("resolvedModel"), http=d.get("httpStatus"), reasoningChars=d.get("reasoningChars"))
scene_msgs = json.load(open(OUT + "/../data/dump-cur.json"))["scenes"]
lines = ["# Raw outputs (labeled). Cursor assigns no quality score. N=3 for deepseek, N=1 for gemini and sol.\n"]
for sc in SCENES:
    lines.append(f"\n## {sc}\n\nUser input: {scene_msgs[sc]['userMessage']}\n")
    for md in MODELS:
        reps = sorted({k[2] for k in rows if k[0] == sc and k[1] == md})
        for rp in reps:
            for arm in ("cur", "cand"):
                r = rows[(sc, md, rp, arm)]
                lines.append(f"\n### {sc} / {md} / rep{rp} / {'CURRENT' if arm=='cur' else 'CANDIDATE'}\n")
                lines.append(f"`{r['caseId']}` chars={r['chars']} prompt_tokens={r['prompt']} completion_tokens={r['completion']} cached={r['cached']} finish={r['finish']} aborted={r['aborted']} budgetedKRW={r['budgetKrw']}\n")
                lines.append("```text\n" + r["text"] + "\n```\n")
open(OUT + "/outputs-labeled.md", "w", encoding="utf-8").write("\n".join(lines))
rnd = random.Random(7)
key = {}
bl = ["# Blinded pairs (X/Y assignment random; key in blinded-key.json). Same wire except memory-section structure.\n"]
for sc in SCENES:
    bl.append(f"\n## {sc}\n\nUser input: {scene_msgs[sc]['userMessage']}\n")
    for md in MODELS:
        reps = sorted({k[2] for k in rows if k[0] == sc and k[1] == md})
        for rp in reps:
            cid = f"{sc}|{md}|r{rp}"
            order = ["cur", "cand"]; rnd.shuffle(order)
            key[cid] = {"X": order[0], "Y": order[1]}
            bl.append(f"\n### {cid}\n")
            for lab, arm in zip(("X", "Y"), order):
                bl.append(f"\n**{lab}**\n\n```text\n{rows[(sc, md, rp, arm)]['text']}\n```\n")
open(OUT + "/blinded-packets.md", "w", encoding="utf-8").write("\n".join(bl))
json.dump(key, open(OUT + "/blinded-key.json", "w"), ensure_ascii=False, indent=1)

def mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None
tab = ["| scene | model | n | CUR chars | CAND chars | CUR in-tok | CAND in-tok | CUR out-tok | CAND out-tok | CUR KRW | CAND KRW |", "|---|---|---|---|---|---|---|---|---|---|---|"]
tot = {"cur": 0.0, "cand": 0.0}
tin = {"cur": 0, "cand": 0}; tout = {"cur": 0, "cand": 0}
for sc in SCENES:
    for md in MODELS:
        reps = sorted({k[2] for k in rows if k[0] == sc and k[1] == md})
        g = lambda arm, f: mean([rows[(sc, md, rp, arm)][f] for rp in reps])
        for arm in ("cur", "cand"):
            for rp in reps:
                tot[arm] += rows[(sc, md, rp, arm)]["budgetKrw"]; tin[arm] += rows[(sc, md, rp, arm)]["prompt"] or 0; tout[arm] += rows[(sc, md, rp, arm)]["completion"] or 0
        tab.append(f"| {sc} | {md} | {len(reps)} | {g('cur','chars'):.0f} | {g('cand','chars'):.0f} | {g('cur','prompt'):.0f} | {g('cand','prompt'):.0f} | {g('cur','completion'):.0f} | {g('cand','completion'):.0f} | {g('cur','budgetKrw'):.1f} | {g('cand','budgetKrw'):.1f} |")
tab.append(f"\nTotals (budgeted KRW, no cache discount): CURRENT={tot['cur']:.1f} CANDIDATE={tot['cand']:.1f} all={tot['cur']+tot['cand']:.1f}; prompt tokens CUR={tin['cur']} CAND={tin['cand']}; completion tokens CUR={tout['cur']} CAND={tout['cand']}")
open(OUT + "/cost-length-table.md", "w", encoding="utf-8").write("\n".join(tab))
print("\n".join(tab))

FLAGS = {
 "평생": r"평생", "우산": r"우산", "누나": r"누나", "아마추어": r"아마추어", "헤어/이별": r"헤어|이별", "연인": r"연인",
 "검 약속/취소": r"약속|취소", "서린": r"서린",
 "불확실표현": r"확실하지|잘 모르|모르겠|기억이 (?:안|나지)|정확히는|아마도|그랬던가|떠올리려",
 "기억/기록 메타언급": r"기록|기억에 따르면|적혀|요약",
}
ft = ["| scene | model | rep | arm | " + " | ".join(FLAGS) + " |", "|---|---|---|---|" + "---|" * len(FLAGS)]
for sc in SCENES:
    for md in MODELS:
        reps = sorted({k[2] for k in rows if k[0] == sc and k[1] == md})
        for rp in reps:
            for arm in ("cur", "cand"):
                t = rows[(sc, md, rp, arm)]["text"]
                ft.append(f"| {sc} | {md} | {rp} | {arm} | " + " | ".join(str(len(re.findall(p, t))) for p in FLAGS.values()) + " |")
open(OUT + "/lexical-flags.md", "w", encoding="utf-8").write("# Lexical navigation flags (counts of substrings; NOT a quality or safety score)\n\n" + "\n".join(ft))
json.dump({f"{k[0]}|{k[1]}|r{k[2]}|{k[3]}": {kk: vv for kk, vv in v.items() if kk != "text"} for k, v in rows.items()}, open(OUT + "/call-metrics.json", "w"), ensure_ascii=False, indent=1)
