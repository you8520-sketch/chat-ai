import json,glob,collections,sys
from math import comb
def fisher(a,n1,b,n2):
    K=a+b;N=n1+n2
    p=lambda x: comb(n1,x)*comb(n2,K-x)/comb(N,K)
    p0=p(a); return sum(p(x) for x in range(max(0,K-n2),min(n1,K)+1) if p(x)<=p0+1e-12)
arms=['main','pr','cand']
cases=['CTL_char_claim','FX06_proposal_only','CTL_explicit_accept','CTL_emotion_npc','CTL_scene_lead','CTL_user_promise','CTL_door','CTL_reconcile','CTL_disclosure','CTL_shared_past_direct','CTL_direction','CTL_lead_follow']
D=collections.defaultdict(list)
for f in glob.glob('/tmp/ep2/raw/*__*.json'):
    d=json.load(open(f)); D[(d['arm'],d['case']['id'])].append(d)
def m(d):
    st=d['stored']; w=d['wire']
    return {
     'ok':d['transportOk'],
     'any_row':len(st)>0,
     'claim_row':any((s['evidence'] or {}).get('authority')=='CHARACTER_CLAIM' for s in st),
     'claim_in_wire':'[캐릭터 발언(미확정 주장)]' in w,
     'lovers':any(s['value']=='lovers' for s in st),
     'agreement_gloss':any('합의' in s['fact_text'] for s in st),
     'proposal_row':any(s['attribute']=='relationship_proposal' or ('제안' in s['fact_text'] and s['category']=='relationship') for s in st),
     'accept_quote_in_wire':'연인이다' in w,
     'accepted_row':any(s['attribute']=='relationship_response' or '수락' in s['fact_text'] for s in st),
     'scene_row':any((s['evidence'] or {}).get('authority')=='CURRENT_SCENE' for s in st),
     'user_row':any((s['evidence'] or {}).get('authority')=='USER_EXPLICIT' for s in st),
     'enoch_leak':any(s['subject'].startswith('enoch') for s in d['emitted'] and [] ) or any(str(e.get('subject','')).startswith('enoch') for e in d['emitted']),
     'promise_row':any('약속' in s['fact_text'] for s in st),
     'reconcileErr':d['reconcileErr'] is not None,
    }
res={}
for c in cases:
    print('==',c)
    for a in arms:
        ds=D.get((a,c),[])
        if not ds: continue
        ms=[m(d) for d in ds]; n=len(ms)
        cnt={k:sum(1 for x in ms if x[k]) for k in ms[0]}
        print(f'  {a:5s} n={n}',{k:v for k,v in cnt.items() if v and k!='ok'}, 'transport_fail',n-cnt['ok'])
        res[(a,c)]=(n,cnt)
for c,k in [('CTL_char_claim','claim_row'),('CTL_scene_lead','scene_row'),('CTL_explicit_accept','accepted_row'),('CTL_emotion_npc','any_row'),('CTL_door','any_row'),('CTL_reconcile','any_row'),('CTL_disclosure','any_row')]:
    for x,y in [('main','pr'),('cand','pr'),('main','cand')]:
        if (x,c) in res and (y,c) in res:
            n1,c1=res[(x,c)];n2,c2=res[(y,c)]
            print(c,k,x,c1[k],'/',n1,'vs',y,c2[k],'/',n2,'p=',round(fisher(c1[k],n1,c2[k],n2),4))
# usage
for a in arms:
    ins=outs=0;usd=0;n=0
    for (aa,c),ds in D.items():
        if aa!=a: continue
        for d in ds:
            u=d['usage'] or {};ins+=u.get('inputTokens',0) or 0;outs+=u.get('outputTokens',0) or 0;usd+=d['billed'] or 0;n+=1
    print(a,'calls',n,'in',ins,'out',outs,'usd',round(usd,5),'in/call',round(ins/n,1),'out/call',round(outs/n,1))
