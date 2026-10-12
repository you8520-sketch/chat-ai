import difflib
import json

def text_of(c):
    if isinstance(c, str):
        return c
    return "\n".join(p.get("text", "") for p in c if isinstance(p, dict))

out = ["# Final wire diff (CURRENT -> CANDIDATE), system message only\n",
       "Messages after the system message (chat history + user tail) are byte-identical between arms unless listed below.\n"]
for model in ["deepseek-v4.1-flash", "gemini-3.8-flash", "gpt-6.1-sol"]:
    for sc in ["S1_false_past_probe", "S2_user_remark_emotion", "S3_npc_event_no_cue", "S4_temporal_state"]:
        a = json.load(open(f"wire/g7_{sc}_cur_{model}.json"))["requestBody"]["messages"]
        b = json.load(open(f"wire/g7_{sc}_cand_{model}.json"))["requestBody"]["messages"]
        tail_equal = [text_of(m["content"]) for m in a[1:]] == [text_of(m["content"]) for m in b[1:]]
        d = list(difflib.unified_diff(text_of(a[0]["content"]).splitlines(), text_of(b[0]["content"]).splitlines(), "CURRENT", "CANDIDATE", lineterm="", n=1))
        out.append(f"\n## {sc} / {model}  (non-system messages identical: {tail_equal})\n```diff")
        out.extend(d)
        out.append("```")
open("analysis/wire-diff.md", "w", encoding="utf-8", newline="\n").write("\n".join(out) + "\n")
