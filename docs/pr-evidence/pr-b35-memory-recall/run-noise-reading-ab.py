"""B35 D reading-stage A/B: same captured Main RP wire, only the episodic block differs.

ARM_NOISE: the episodic block the current retrieval injects for a name-only query
           (lines taken from long-horizon-recall-baseline.json, scenario C-no-evidence-no-invention).
ARM_GATED: the episodic block the D candidate would inject (none).
Two queries x 2 arms x N reps, non-streaming, Main RP model, SAFE wire from wires/20-RECALL-memory-ON.json.
"""
import copy, json, os, re, sys, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPS = int(os.environ.get("B35_READ_REPS", "3"))
CAP_USD = float(os.environ.get("B35_READ_CAP_USD", "0.15"))
KEY = os.environ["RP_QUALITY_PAID_OPENROUTER_KEY"].strip()

wire = json.load(open(os.path.join(HERE, "wires/20-RECALL-memory-ON.json"), encoding="utf8"))
long_run = json.load(open(os.path.join(HERE, "long-horizon-recall-baseline.json"), encoding="utf8"))
noise_lines = next(r for r in long_run["reports"] if r["scenario"] == "C-no-evidence-no-invention")["injectedLines"]
noise_lines = [re.sub(r"^- \[T\d+\]", f"- [T{i + 1}]", line) for i, line in enumerate(noise_lines)]

QUERIES = {
    "Q1-no-evidence-silver-sword": "내가 예전에 당신에게 선물했던 은색 검에 대해 기억나는 대로 말해 주세요. 기억나지 않으면 모른다고 해도 됩니다.",
    "Q2-name-plus-unrelated": "볼프강, 오늘 저녁에는 따뜻한 수프가 있으면 좋겠군요.",
}


def build(query: str, arm: str) -> dict:
    body = copy.deepcopy(wire)
    body["stream"] = False
    body.pop("stream_options", None)
    body["usage"] = {"include": True}
    text = body["messages"][0]["content"][2]["text"]
    start = text.index("[EPISODIC MEMORY - RETRIEVED FACTS]")
    first_bullet = text.index("\n- [T", start) + 1
    end = text.index("\n\n[OUTPUT LAYOUT]", start)
    if arm == "NOISE":
        text = text[:first_bullet] + "\n".join(noise_lines) + text[end:]
    else:
        text = text[:start].rstrip("\n") + text[end:]
    body["messages"][0]["content"][2]["text"] = text
    user = body["messages"][9]["content"]
    user = re.sub(r"(\[유저 대사\]\n).*?(\n\[HISTORICAL TRUTH CHECK\])", lambda m: m.group(1) + query + m.group(2), user, flags=re.S)
    body["messages"][9]["content"] = user
    return body


def call(body: dict) -> dict:
    req = urllib.request.Request(
        "https://openrouter.ai/api/v1/chat/completions",
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"},
    )
    started = time.time()
    with urllib.request.urlopen(req, timeout=180) as resp:
        out = json.load(resp)
    out["_latency_s"] = round(time.time() - started, 2)
    return out


spent = 0.0
rows = []
for qid, query in QUERIES.items():
    for arm in ("NOISE", "GATED"):
        for rep in range(1, REPS + 1):
            if spent > CAP_USD:
                sys.exit(f"cost cap exceeded {spent}")
            body = build(query, arm)
            out = call(body)
            usage = out.get("usage", {})
            cost = float(usage.get("cost", 0) or 0)
            spent += cost
            text = out["choices"][0]["message"]["content"] or ""
            rows.append({
                "query_id": qid, "query": query, "arm": arm, "rep": rep,
                "prompt_tokens": usage.get("prompt_tokens"), "completion_tokens": usage.get("completion_tokens"),
                "cost_usd": cost, "latency_s": out["_latency_s"], "finish_reason": out["choices"][0].get("finish_reason"),
                "episodic_lines_in_wire": len(noise_lines) if arm == "NOISE" else 0,
                "output": text,
            })
            print(qid, arm, rep, usage.get("prompt_tokens"), usage.get("completion_tokens"), cost, flush=True)

with open(os.path.join(HERE, "noise-reading-ab.jsonl"), "w", encoding="utf8") as fh:
    for row in rows:
        fh.write(json.dumps(row, ensure_ascii=False) + "\n")
print(json.dumps({"calls": len(rows), "spent_usd": round(spent, 5)}))
