import json
def L(tag,kind): return json.load(open(f'/tmp/e43e-metrics-{kind}-{tag}.json'))
tags=['before','a','b']
S={t:L(t,'shots') for t in tags}; T={t:L(t,'states') for t in tags}
rows=[]
def g(d,k,f,default='-'):
    v=d.get(k)
    if not v: return default
    try: r=f(v)
    except Exception: return default
    return r
print('### Scenario matrix (bottom view) — hOverflow / dock bottom==viewport / send h / toolbar min / chars-per-line')
print('| scenario@width | variant | hOverflow | dock h | dock bottom gap | send h | toolbar min h | chars/line | last msg gap to dock |')
print('|---|---|---|---|---|---|---|---|---|')
issues={t:[] for t in tags}
for key in S['before']:
    if key.endswith('-read'): continue
    for t in tags:
        m=S[t].get(key)
        if not m: continue
        dock=m.get('dock') or {}
        gap=round(m['vh']-dock['b'],1) if dock else None
        tb=min([b['h'] for b in m.get('toolbarBtns',[])] or [None]) if m.get('toolbarBtns') else None
        if m['hOverflow'] or m['rightOverflowEls']: issues[t].append((key,'overflow'))
        if dock and abs(gap)>1: issues[t].append((key,f'dock-gap {gap}'))
        print(f"| {key} | {t} | {m['hOverflow']} | {dock.get('h')} | {gap} | {(m.get('send') or {}).get('h')} | {tb} | {m.get('charsPerLineEst')} | {m.get('lastArtBottomVsDockTop')} |")
print()
for t in tags: print(t,'issues:',issues[t])
json.dump({'issues':issues},open('/tmp/e43e-summary-issues.json','w'),ensure_ascii=False,indent=1)
print()
print('### States')
for key in T['before']:
    for t in tags:
        m=T[t].get(key)
        if not m or 'vh' not in m: continue
        dock=m.get('dock') or {}
        print(f"{key} | {t} | ovf={m['hOverflow']} | dockH={dock.get('h')} | sendH={(m.get('send') or {}).get('h')} | selTrunc={m.get('selectTruncated')} | gapToDock={m.get('lastArtBottomVsDockTop')}")
print()
for w in (390,1440):
    for t in tags:
        s=T[t].get(f'stream-{w}')
        print('stream',w,t,json.dumps(s['manualDetach']),[ (f['t'],f['attr']['follow'],round(f['lastGap'] or 0)) for f in s['frames']])
