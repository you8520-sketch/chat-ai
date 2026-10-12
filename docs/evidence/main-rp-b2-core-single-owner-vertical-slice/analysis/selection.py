"""Deterministic selection / role-split analysis (no provider call).

Inputs are stored outputs only: v2/v2b anchors, epi-base rows, Gate 2 dump, seal-A prose, generator sources.
Metric = lexical key-fact presence (same oracle as analysis/coverage.py in the architecture-feasibility evidence).
It is a proxy, not semantic recall.
"""
import json, re, sys, itertools
from collections import defaultdict

DATA = sys.argv[1]            # .../main-rp-b2-core-architecture-feasibility/data
G4 = sys.argv[3] if len(sys.argv) > 3 else DATA + '/../../main-rp-b2-core-luna-summary/data'
OUT = sys.argv[2]

cur = json.load(open(f'{G4}/seal-A.json'))
src = json.load(open(f'{G4}/sources.json'))
v2 = json.load(open(f'{DATA}/v2-anchors.json'))['windows']
v2b = json.load(open(f'{DATA}/v2b-anchors.json'))['windows']
base = json.load(open(f'{DATA}/epi-base.json'))['windows']
dump = json.load(open(f'{DATA}/dump-cur-real-luna.json'))

F = {
'N01_insult_emotion':[('Q','아마추어'),('E','입술.*깨물|시선.*(피|돌)|피했'),('Q','아직 부족')],
'N02_reconcile_sequence':[('R','사과'),('S','아침'),('R','받아들|용서|받아주')],
'N03_npc_arrival':[('S','의뢰'),('R','처음')],
'N04_char_backstory':[('S','스승'),('E','위로|놀라|조용히 듣|듣')],
'N05_user_relationship':[('R','연인'),('E','손.*(잡|맞잡)|맞잡'),('Q','나쁘지 않')],
'N06_user_ooc_shared_past':[('R','3년|삼 년'),('R','용병단'),('S','재회|오랜만')],
'N07_user_family':[('R','누나'),('S','항구')],
'N08_char_attributed_claim':[('R','누나'),('S','서린'),('E','의아|금시초문|몰랐|처음 듣')],
'N09_injury_care':[('S','붕대|상처'),('E','고맙|감사')],
'N10_promise_real':[('R','북문'),('R','새벽')],
'N11_jealousy':[('S','서린'),('E','퉁명|굳은')],
'N12_callback_in_window':[('Q','부러'),('Q','마음')],
'N13_journey_sequence':[('S','시장'),('S','돌아')],
'N14_night_watch':[('S','담요'),('E','어색|모른 척|모르는 척|무심')],
'N15_gift':[('S','검집'),('E','당황|조용히')],
'N16_duel':[('S','대련'),('E','손을 내|내밀|손')],
'N17_cancel_promise':[('R','약속'),('E','아쉬|어깨')],
'N18_hug':[('S','안아|안았|안긴|포옹|품'),('E','불안|숨')],
'N19_exact_quote':[('Q','돌아올 곳'),('E','먹먹|가슴')],
'N20_secret_reveal':[('R','쫓겨|추방'),('R','동료'),('E','곁에')],
'N21_user_friend_mention':[('R','도윤'),('S','편지')],
'N22_banter':[('S','농담'),('E','웃')],
}


def present(t, pat):
    return re.search(pat, t) is not None


def srctext(k):
    return ' '.join(t['user'] + ' ' + t['assistant'] for t in src[k]['turns'])


def norm(q):
    q = re.sub(r'\s+', ' ', q.strip())
    return re.sub(r'^[“"\']+|[”"\']+$', '', q)


def anchors(w, only=None):
    out = [a for a in w['anchors'] if a['accepted']]
    if only:
        out = [a for a in out if a['role'] == only]
    return out


def rows_quotes(k):
    return [r['metadata']['evidence'] for r in base[k]['rows'] if r.get('metadata', {}).get('evidence')]


# ---------------------------------------------------------------- A. role split
arms = {
    'CUR_prose (A)': lambda k: cur[k]['persisted'],
    'user_raw_200 (deterministic, no LLM)': lambda k: ' '.join(t['user'][:200] for t in src[k]['turns']),
    'user_anchors_only (v2b, role=user)': lambda k: ' '.join(a['quote'] for a in anchors(v2b[k], 'user')),
    'assistant_anchors_only (v2b, role=assistant)': lambda k: ' '.join(a['quote'] for a in anchors(v2b[k], 'assistant')),
    'verified_rows (B base)': lambda k: ' '.join(e['quote'] for e in rows_quotes(k)),
    'rows + user_anchors': lambda k: ' '.join(e['quote'] for e in rows_quotes(k)) + ' ' + ' '.join(a['quote'] for a in anchors(v2b[k], 'user')),
    'all_anchors (C2)': lambda k: ' '.join(a['quote'] for a in anchors(v2b[k])),
    'rows + all_anchors': lambda k: ' '.join(e['quote'] for e in rows_quotes(k)) + ' ' + ' '.join(a['quote'] for a in anchors(v2b[k])),
}
types = ['Q', 'R', 'E', 'S']
roleSplit = {}
for name, fn in arms.items():
    tally = {t: [0, 0] for t in types}
    allc = [0, 0]
    chars = 0
    for k, fs in F.items():
        txt = fn(k)
        chars += len(txt)
        st = srctext(k)
        for typ, pat in fs:
            if not present(st, pat):
                continue
            tally[typ][1] += 1
            allc[1] += 1
            if present(txt, pat):
                tally[typ][0] += 1
                allc[0] += 1
    roleSplit[name] = {'all': f'{allc[0]}/{allc[1]}', **{t: f'{v[0]}/{v[1]}' for t, v in tally.items()}, 'avgCharsPerWindow': round(chars / len(F))}

# which facts need an assistant-authored span (not coverable by any user-role arm)
needAI = []
for k, fs in F.items():
    st = srctext(k)
    userTxt = ' '.join(t['user'] for t in src[k]['turns'])
    for typ, pat in fs:
        if present(st, pat) and not present(userTxt, pat):
            needAI.append((k, typ, pat))
nTest = sum(1 for k, fs in F.items() for typ, pat in fs if present(srctext(k), pat))
roleSplit['_facts_whose_stem_occurs_only_in_assistant_text'] = f'{len(needAI)}/{nTest}'
byType = defaultdict(lambda: [0, 0])
for k, fs in F.items():
    st = srctext(k)
    userTxt = ' '.join(t['user'] for t in src[k]['turns'])
    for typ, pat in fs:
        if present(st, pat):
            byType[typ][1] += 1
            if not present(userTxt, pat):
                byType[typ][0] += 1
roleSplit['_assistant_only_by_type'] = {t: f'{v[0]}/{v[1]}' for t, v in byType.items()}

# ---------------------------------------------------------------- B. near-duplicate clustering


def masked_shingles(q, n=3):
    s = re.sub(r'\d+', '#', norm(q))
    s = re.sub(r'\s+', '', s)
    return {s[i:i + n] for i in range(max(1, len(s) - n + 1))}


def jacc(a, b):
    return len(a & b) / max(1, len(a | b))


def cluster(items, thr):
    cl = []
    for it in items:
        sh = masked_shingles(it['q'])
        for c in cl:
            if c['role'] == it['role'] and jacc(sh, c['sh']) >= thr:
                c['members'].append(it)
                break
        else:
            cl.append({'role': it['role'], 'sh': sh, 'members': [it]})
    return cl


# false-merge check over every accepted anchor of the 22 normal windows (each window as its own turn range)
normalItems = []
for k in F:
    for a in anchors(v2b[k]):
        normalItems.append({'win': k, 'turn': a['turn'], 'role': a['role'], 'q': a['quote']})
falseMerge = {}
for thr in (0.5, 0.6, 0.7, 0.8):
    cl = cluster(normalItems, thr)
    merged = [c for c in cl if len(c['members']) > 1]
    falseMerge[str(thr)] = {
        'anchors': len(normalItems),
        'clusters': len(cl),
        'multiMemberClusters': len(merged),
        'examples': [[m['win'][:3] + ':' + m['q'][:28] for m in c['members']] for c in merged[:6]],
    }

# G2 80-turn fixture: pool = v2 anchors (accepted) + real episodic rows, dedupe by (role, normalized quote)
g2pool = []
for k, w in v2.items():
    m = re.match(r'^G2_(\d+)_(\d+)$', k)
    if not m:
        continue
    start = int(m.group(1))
    for a in anchors(w):
        g2pool.append({'src': 'anchor', 'turn': start + a['turn'] - 1, 'role': a['role'], 'q': a['quote']})
epiRows = []
for r in dump['episodicRows']:
    ev = (json.loads(r['metadata']) if isinstance(r.get('metadata'), str) else r.get('metadata', {})).get('evidence') if r.get('metadata') else None
    if ev:
        epiRows.append({'src': 'episodic', 'turn': r.get('source_turn'), 'role': ev['role'], 'q': ev['quote']})
seen = {}
dups = []
unified = []
for it in sorted(epiRows + g2pool, key=lambda x: (x['src'] != 'episodic', x['turn'] or 0)):
    key = (it['role'], norm(it['q']))
    if key in seen:
        dups.append((seen[key]['src'], it['src'], it['turn'], it['q'][:30]))
        continue
    seen[key] = it
    unified.append(it)
unified.sort(key=lambda x: x['turn'])
important = [it for it in unified if '장작' not in it['q']]
falseLines = [render_ for render_ in []]
firewood = [it for it in unified if '장작' in it['q']]

IMPORTANT_STEMS = ['아마추어', '입술', '약속이야', '연인', '취소', '문을 열고', '헤어지', '손을 맞잡']
FALSE_STEMS = ['널 알아봤', '렌은 라이크의 손을 잡고']  # G2 negatives: AI-authored sister claim (T24) and AI-authored user handhold (T33)


def render(it):
    return f"[T{it['turn']}] {it['q']}"


def fill(order, budget):
    out, used = [], 0
    for it in order:
        c = len(render(it)) + 1
        if used + c > budget:
            continue
        out.append(it)
        used += c
    return out


def keep_stats(sel):
    txt = ' '.join(x['q'] for x in sel)
    return {
        'lines': len(sel),
        'chars': sum(len(render(x)) + 1 for x in sel),
        'importantStemsKept': f"{sum(1 for s in IMPORTANT_STEMS if s in txt)}/{len(IMPORTANT_STEMS)}",
        'falseG2LinesPresent': sum(1 for s in FALSE_STEMS if s in txt),
        'firewoodLines': sum(1 for x in sel if '장작' in x['q']),
        'user_lines': sum(1 for x in sel if x['role'] == 'user'),
    }


def strat_recency(pool):
    return sorted(pool, key=lambda x: -x['turn'])


def strat_user_first(pool):
    return sorted(pool, key=lambda x: (x['role'] != 'user', -x['turn']))


def strat_collapse_then_user_first(pool, thr=0.6):
    cl = cluster(sorted(pool, key=lambda x: x['turn']), thr)
    reps = []
    for c in cl:
        first = c['members'][0]
        reps.append({**first, 'q': first['q'] + (f" (유사 {len(c['members'])}회)" if len(c['members']) > 1 else '')})
    return sorted(reps, key=lambda x: (x['role'] != 'user', -x['turn']))


def strat_collapse_chrono_cap(pool, thr=0.6, per_win=2):
    cl = cluster(sorted(pool, key=lambda x: x['turn']), thr)
    reps = []
    for c in cl:
        first = c['members'][0]
        reps.append({**first, 'q': first['q'] + (f" (유사 {len(c['members'])}회)" if len(c['members']) > 1 else '')})
    byw = defaultdict(list)
    for r in reps:
        byw[(r['turn'] - 1) // 5].append(r)
    flat = []
    for w, lst in byw.items():
        lst.sort(key=lambda x: (x['role'] != 'user', x['turn']))
        flat.extend(lst[:per_win])
    return sorted(flat, key=lambda x: (x['role'] != 'user', -x['turn']))


selection = {}
for budget in (300, 450, 600, 900, 1500):
    selection[str(budget)] = {
        'S0_newest_first': keep_stats(fill(strat_recency(unified), budget)),
        'S1_user_first_newest': keep_stats(fill(strat_user_first(unified), budget)),
        'S2_neardup_collapse_then_user_first': keep_stats(fill(strat_collapse_then_user_first(unified), budget)),
        'S3_collapse_perwindow_cap2_user_first': keep_stats(fill(strat_collapse_chrono_cap(unified), budget)),
    }

# extended 300-turn stress: tile the 5 firewood windows to 60 windows (synthetic), keep the important turns at T1-T40
ext = [it for it in unified if '장작' not in it['q']]
for w in range(9, 60):
    for i in range(1, 6):
        n = w * 5 + i
        ext.append({'src': 'synthetic', 'turn': n, 'role': 'assistant', 'q': f'라이크는 {n}번째 장작을 쌓았다.'})
extSel = {}
for budget in (600, 900, 1500):
    extSel[str(budget)] = {
        'S0_newest_first': keep_stats(fill(strat_recency(ext), budget)),
        'S1_user_first_newest': keep_stats(fill(strat_user_first(ext), budget)),
        'S2_neardup_collapse_then_user_first': keep_stats(fill(strat_collapse_then_user_first(ext), budget)),
        'S3_collapse_perwindow_cap2_user_first': keep_stats(fill(strat_collapse_chrono_cap(ext), budget)),
    }

result = {
    'roleSplitCoverage': roleSplit,
    'falseMergeCheck_normalWindows': falseMerge,
    'g2Unified': {
        'episodicRows': len(epiRows),
        'anchorLines': len(g2pool),
        'duplicatesAcrossEpisodicAndAnchors': dups,
        'unifiedLines': len(unified),
        'importantLines': len(important),
        'firewoodLines': len(firewood),
        'unifiedLinesText': [render(x) for x in unified],
        'charsUnifiedAll': sum(len(render(x)) + 1 for x in unified),
        'charsImportantOnly': sum(len(render(x)) + 1 for x in important),
    },
    'selection80turn': selection,
    'selection300turnSyntheticFirewood': extSel,
}
json.dump(result, open(OUT, 'w'), ensure_ascii=False, indent=1)
print(json.dumps({k: result[k] for k in ['roleSplitCoverage', 'falseMergeCheck_normalWindows']}, ensure_ascii=False, indent=1))
print(json.dumps({k: v for k, v in result['g2Unified'].items() if k != 'unifiedLinesText'}, ensure_ascii=False, indent=1))
print(json.dumps(selection, ensure_ascii=False, indent=1))
print(json.dumps(extSel, ensure_ascii=False, indent=1))

# ---------------------------------------------------------------- C. claim amplification (adversarial windows)
amp = {}
for k in ['A01_fake_acquaintance', 'A02_fake_sister_friend', 'A03_fake_promise', 'A04_fake_childhood_npc']:
    items = []
    for e in rows_quotes(k):
        items.append({'turn': 0, 'role': e['role'], 'q': e['quote']})
    for a in anchors(v2b[k]):
        items.append({'turn': a['turn'], 'role': a['role'], 'q': a['quote']})
    seenq = set()
    uniq = []
    for it in items:
        key = (it['role'], norm(it['q']))
        if key in seenq:
            continue
        seenq.add(key)
        uniq.append(it)
    claimWords = {'A01_fake_acquaintance': '알던 사이', 'A02_fake_sister_friend': '친구였', 'A03_fake_promise': '약속', 'A04_fake_childhood_npc': '분명히 봤'}[k]
    claimLines = [it for it in uniq if it['role'] == 'assistant' and claimWords in it['q']]
    perThr = {}
    for thr in (0.2, 0.3, 0.4, 0.5):
        cl = cluster(claimLines, thr)
        perThr[str(thr)] = {'clustersFromClaimLines': len(cl), 'claimLinesBefore': len(claimLines)}
    amp[k] = {'uniqueLinesAfterExactDedupe': len(uniq), 'claimLinesAfterExactDedupe': len(claimLines), 'claimLines': [c['q'] for c in claimLines], 'byThreshold': perThr}
fm = {}
for thr in (0.2, 0.3, 0.4):
    cl = cluster(normalItems, thr)
    merged = [c for c in cl if len(c['members']) > 1]
    fm[str(thr)] = {'anchors': len(normalItems), 'multiMemberClusters': len(merged), 'examples': [[m['win'][:3] + ':' + m['q'][:26] for m in c['members']] for c in merged[:8]]}
amp['falseMergeOnNormalWindowsAtLowThreshold'] = fm
res2 = json.load(open(OUT))
res2['claimAmplification'] = amp
json.dump(res2, open(OUT, 'w'), ensure_ascii=False, indent=1)
print(json.dumps(amp, ensure_ascii=False, indent=1))
