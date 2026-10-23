import json, re, sys
G5='/opt/cursor/artifacts/gate5'
cur=json.load(open('/opt/cursor/artifacts/gate4/seal-A.json'))
src=json.load(open('/opt/cursor/artifacts/gate4/sources.json'))
v2=json.load(open(f'{G5}/v2-anchors.json'))['windows']
v2b=json.load(open(f'{G5}/v2b-anchors.json'))['windows']
base=json.load(open(f'{G5}/epi-base.json'))['windows']
wide=json.load(open(f'{G5}/epi-widen.json'))['windows']

# key facts decided from the generator specs BEFORE looking at candidate outputs.
# type: Q=exact user/char quote, R=relationship/state, E=emotion/reaction, S=scene/NPC event
F={
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
def present(text, pat): return re.search(pat,text) is not None
def srctext(k): return ' '.join(t['user']+' '+t['assistant'] for t in src[k]['turns'])
def rowsq(w):
    return ' '.join(r['metadata']['evidence']['quote'] for r in w['rows'] if r.get('metadata',{}).get('evidence'))
def rowsft(w):
    return ' '.join(p_f.get('fact_text','') for p in w['perTurn'] for p_f in p.get('rawFacts',[]))
def anch(w): return ' '.join(a['quote'] for a in w['anchors'] if a['accepted'])
def tags(w): return ' '.join(f"{t['who']} {t['state']}" for t in w.get('tags',[]))
arms={}
tot=0; testable=0
res={a:{'Q':[0,0],'R':[0,0],'E':[0,0],'S':[0,0],'all':[0,0]} for a in ['OLDproxy_factText','CUR_prose','B_base_quotes','B_widen_quotes','C_anchors','C_anchors+freetags','C_anchors+B_base','C2_anchors_cap12']}
miss={a:[] for a in res}
for k,fs in F.items():
    st=srctext(k)
    texts={
     'OLDproxy_factText':rowsft(base[k]),
     'CUR_prose':cur[k]['persisted'],
     'B_base_quotes':rowsq(base[k]),
     'B_widen_quotes':rowsq(wide[k]),
     'C_anchors':anch(v2[k]),
     'C_anchors+freetags':anch(v2[k])+' '+tags(v2[k]),
     'C_anchors+B_base':anch(v2[k])+' '+rowsq(base[k]),
     'C2_anchors_cap12':anch(v2b[k]),
    }
    for typ,pat in fs:
        if not present(st,pat): continue
        for a,t in texts.items():
            hit=present(t,pat)
            res[a][typ][1]+=1; res[a]['all'][1]+=1
            if hit: res[a][typ][0]+=1; res[a]['all'][0]+=1
            else: miss[a].append((k,typ,pat))
summary={a:{t:f"{v[0]}/{v[1]}" for t,v in r.items()} for a,r in res.items()}
json.dump({'summary':summary,'miss':{a:m for a,m in miss.items()}},open(f'{G5}/analysis/coverage-N.json','w'),ensure_ascii=False,indent=1)
print(json.dumps(summary,ensure_ascii=False,indent=1))
for a in ['CUR_prose','B_base_quotes','C_anchors','C2_anchors_cap12']:
    print(a,'MISS',[(m[0][:3],m[1]) for m in miss[a]])
# size
import statistics
def L(f): return statistics.mean(len(f(k)) for k in F)
print('v2b avg chars',L(lambda k:anch(v2b[k])),'avg anchors',statistics.mean(sum(a['accepted'] for a in v2b[k]['anchors']) for k in F),'rej',sum(not a['accepted'] for k in F for a in v2b[k]['anchors']),'tot',sum(len(v2b[k]['anchors']) for k in F))
print('avg chars per 5-turn window: CUR',L(lambda k:cur[k]['persisted']),'B_base',L(lambda k:rowsq(base[k])),'B_widen',L(lambda k:rowsq(wide[k])),'C_anch',L(lambda k:anch(v2[k])),'tags',L(lambda k:tags(v2[k])))
# extractor stats
for name,W in (('base',base),('widen',wide)):
    n=sum(len(w['rows']) for w in W.values()); 
    raw=sum(len(p['rawFacts']) for w in W.values() for p in w['perTurn'])
    print(name,'rawFacts',raw,'rowsInserted',n,'windows with 0 rows',sum(1 for w in W.values() if not w['rows']))
