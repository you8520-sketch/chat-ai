"""Render the final-wire excerpts from data/slice-results.json into wires.md (memory-bearing sections only)."""
import json, re, sys
d = json.load(open(sys.argv[1]))
out = []
KEEP = ('current-memory', 'episodic-memory-retrieved-facts', 'relationship-meta')


def sections(text):
    parts = re.split(r'(?m)^<<([^>]+)>>\n', text)
    res = {}
    for i in range(1, len(parts), 2):
        res[parts[i]] = parts[i + 1].rstrip()
    return res


def block(title, text):
    s = sections(text)
    out.append(f'#### {title}\n')
    shown = False
    for k in KEEP:
        if k in s:
            body = s[k]
            if k == 'episodic-memory-retrieved-facts':
                body = '\n'.join(l for l in body.split('\n') if l.startswith('- [') or l.startswith('[EPISODIC'))
            out.append(f'`<<{k}>>`\n```\n{body}\n```\n')
            shown = True
    if not shown:
        out.append('(no memory-bearing section on the wire)\n')


out.append('# Final-wire excerpts (real `buildContext`; probe `probes/zz-slice.test.ts.txt`)\n')
out.append('Only the memory-bearing sections are shown; every other system section is unchanged. Provider POST 0.\n')
out.append('## 1. Live gate, same 12 assistant/user turns, bait query, honest (H) vs evasive (M2) extractor labels\n')
out.append('Bait query: ' + '`' + json.dumps('라이크가 평생 지키겠다고 약속했었지? 누나가 나를 알아봤다던데... (all negative and positive cues)', ensure_ascii=False) + '`. Retrieval is capped at 8 facts.\n')
for v, title in (('H', 'H: extractor labels are honest'), ('M2', 'M2: extractor labels are evasive (scene label, non-user subject, gloss avoids user)')):
    block(title, d['liveGateWire'][v]['memoryWire'])
    out.append('Insert results: ' + ', '.join(f"{x['case'][:3]}={x['inserted']}" for x in d['liveGateWire'][v]['stats']) + '\n')
out.append('## 2. Ledger on current main (fake promise and invented item, rendered inside the Absolute Facts wrapper)\n')
w = d['wire']['currentMainLedgerWire']
out.append('```\n' + w['wrapperExcerpt'].strip() + '\n```\n')
out.append('## 3. Ledger-leg prototype (probe only): authority from the role of the message containing the quote; gloss never rendered\n')
lp = d['ledgerPrototype']
out.append('Quote decisions: ' + json.dumps(lp['decisions'], ensure_ascii=False) + '\n')
block('verified lines only', lp['wireVerifiedOnly']['text'])
block('verified lines + legacy entry demoted', lp['wireVerifiedPlusLegacyDemoted']['text'])
block('current main with the same legacy entry as-is', lp['wireCurrentMainLegacyAsIs']['text'])
out.append('## 4. Real windows (stored real-Luna prose + real extractor rows + stored anchors): CURRENT vs rows+anchors\n')
for k, v in d['windowWires'].items():
    out.append(f'### {k}\n')
    block(f"CURRENT ({v['current']['chars']} chars, {v['current']['tokens']} tokens)", v['current']['memoryWire'])
    out.append('Placement in the system prompt: ' + json.dumps(v['current']['placement']) + ' (inside `<LONG_TERM_MEMORY>` = under the Absolute Facts preamble)\n')
    r = v['rowsPlusAnchorsDeduped']
    block(f"rows + anchors, prose off ({r['chars']} chars, {r['tokens']} tokens, exact-dedupe dropped {r['duplicatesDroppedAcrossRowsAndAnchors']})", r['memoryWire'])
open(sys.argv[2], 'w').write('\n'.join(out))
