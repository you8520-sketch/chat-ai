import difflib
import json

def text_of(c):
    if isinstance(c, str):
        return c
    return "\n".join(p.get("text", "") for p in c if isinstance(p, dict))

out = ["# Final wire diff (CURRENT -> K2), system message only\n",
       "Messages after the system message (chat history + user tail) are byte-identical between arms unless listed below.\n"]
for model in ["deepseek-v4.1-flash", "gemini-3.8-flash", "gpt-6.1-sol"]:
    for sc in ["P1_open_promises", "P2_relationship_state", "P3_cancelled_promise", "P4_false_lifelong"]:
        a = json.load(open(f"wire/g8_{sc}_cur_{model}.json"))["requestBody"]["messages"]
        b = json.load(open(f"wire/g8_{sc}_k2_{model}.json"))["requestBody"]["messages"]
        tail_equal = [text_of(m["content"]) for m in a[1:]] == [text_of(m["content"]) for m in b[1:]]
        d = list(difflib.unified_diff(text_of(a[0]["content"]).splitlines(), text_of(b[0]["content"]).splitlines(), "CURRENT", "K2", lineterm="", n=1))
        out.append(f"\n## {sc} / {model}  (non-system messages identical: {tail_equal})\n```diff")
        out.extend(d)
        out.append("```")
open("analysis/wire-diff.md", "w", encoding="utf-8", newline="\n").write("\n".join(out) + "\n")
