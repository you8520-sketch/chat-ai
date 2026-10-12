import json, sys
from PIL import Image
tag = sys.argv[1]
m = json.load(open(f'/tmp/e43e-metrics-states-{tag}.json'))
def lin(c):
    c/=255
    return c/12.92 if c<=0.03928 else ((c+0.055)/1.055)**2.4
def L(rgb): return 0.2126*lin(rgb[0])+0.7152*lin(rgb[1])+0.0722*lin(rgb[2])
def cr(a,b):
    la,lb=L(a),L(b); hi,lo=max(la,lb),min(la,lb); return (hi+0.05)/(lo+0.05)
def parse(s):
    import re
    n=[float(x) for x in re.findall(r'[\d.]+',s)][:3]; return n
out={}
for w,op in ((360,0.22),(390,0.22),(390,0.5),(390,0.8),(390,1)):
    im=Image.open(f'/opt/cursor/artifacts/e43e/{tag}/bg-notext-{w}-{op}.png').convert('RGB')
    scale=im.width/w
    res=[]
    for r in m[f'bg-{w}-{op}']['rects']:
        x0,y0,x1,y1=[int(v*scale) for v in (r['x'],r['y'],r['x']+r['w'],r['y']+r['h'])]
        if x1<=x0 or y1<=y0: continue
        crop=im.crop((x0,y0,x1,y1)).resize((max(1,(x1-x0)//4),max(1,(y1-y0)//4)))
        px=list(crop.getdata())
        px.sort(key=L)
        # worst case = brightest 5% of background pixels vs text colour
        worst=px[int(len(px)*0.95)]
        mean=[sum(p[i] for p in px)/len(px) for i in range(3)]
        tc=parse(r['color'])
        res.append({'dlg':r['dlg'],'text':tc,'worstBg':worst,'cr95':round(cr(tc,worst),2),'crMean':round(cr(tc,mean),2)})
    out[f'{w}@{op}']={'n':len(res),'min_cr95':min(x['cr95'] for x in res) if res else None,'min_dlg_cr95':min([x['cr95'] for x in res if x['dlg']] or [None]),'min_nar_cr95':min([x['cr95'] for x in res if not x['dlg']] or [None]),'min_crMean':min(x['crMean'] for x in res) if res else None}
print(json.dumps(out,ensure_ascii=False))
json.dump(out,open(f'/tmp/e43e-bgcontrast-{tag}.json','w'))
