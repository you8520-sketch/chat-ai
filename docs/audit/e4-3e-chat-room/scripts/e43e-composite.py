from PIL import Image, ImageDraw, ImageFont
import sys
base='/opt/cursor/artifacts/e43e'; out=f'{base}/composite'
SHA=dict(before='BEFORE main 8b85f97f',a='Candidate A (quiet reading)',b='Candidate B (cinematic dialogue)')
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',22)
def lab(im,t):
    c=Image.new('RGB',(im.width,im.height+34),(8,8,12)); c.paste(im,(0,34)); ImageDraw.Draw(c).text((10,5),t,fill=(255,255,255),font=font); return c
def load(tag,name,scale=1.0,max_h=None,crop=None):
    im=Image.open(f'{base}/{tag}/{name}.png').convert('RGB')
    if crop: im=im.crop(crop)
    if max_h and im.height>max_h: im=im.crop((0,0,im.width,max_h))
    if scale!=1.0: im=im.resize((int(im.width*scale),int(im.height*scale)),Image.LANCZOS)
    return im
def hrow(name,fn,**kw):
    ims=[lab(load(t,fn(t) if callable(fn) else fn,**kw),SHA[t]) for t in ('before','a','b')]
    W=sum(i.width for i in ims)+20*2; H=max(i.height for i in ims)
    c=Image.new('RGB',(W,H),(8,8,12)); x=0
    for i in ims: c.paste(i,(x,0)); x+=i.width+20
    c.save(f'{out}/{name}.webp',quality=84); print(name,c.size)
def vstack(name,fn,scale=0.7,**kw):
    ims=[lab(load(t,fn,scale=scale,**kw),SHA[t]) for t in ('before','a','b')]
    W=max(i.width for i in ims); H=sum(i.height for i in ims)+16*2
    c=Image.new('RGB',(W,H),(8,8,12)); y=0
    for i in ims: c.paste(i,(0,y)); y+=i.height+16
    c.save(f'{out}/{name}.webp',quality=84); print(name,c.size)
# mobile full chat
hrow('mobile-c3200-390-read','c3200-390-read')
hrow('mobile-c3200-390-bottom','c3200-390-bottom')
hrow('mobile-c5200-360-read','c5200-360-read')
hrow('mobile-rich-390-read','rich-390-read')
hrow('mobile-table-390-bottom','table-390-bottom')
hrow('mobile-failed-390-bottom','failed-390-bottom')
hrow('mobile-short-390-bottom','short-390-bottom')
hrow('mobile-new-390-bottom','new-390-bottom')
# tablet / pc
for w in (576,768,1024):
    vstack(f'pc-c3200-{w}-read',f'c3200-{w}-read',scale=0.6 if w>576 else 0.8)
vstack('pc-c3200-1440-read','c3200-1440-read',scale=0.62)
vstack('pc-c5200-1440-read','c5200-1440-read',scale=0.62)
vstack('pc-short-1440-bottom','short-1440-bottom',scale=0.5)
hrow('tablet-short-576-bottom','short-576-bottom',scale=0.7)
# enlarged input boxes
def dockstack(name,widths,scale=2.0,shown='shown'):
    rows=[]
    for w in widths:
        for t in ('before','a','b'):
            im=load(t,f'dock-{shown}-{w}')
            s=scale if w<700 else scale*0.75
            im=im.resize((int(im.width*s),int(im.height*s)),Image.LANCZOS)
            rows.append(lab(im,f'{SHA[t]} — {w}px, estimate {shown}'))
    W=max(r.width for r in rows); H=sum(r.height for r in rows)+10*(len(rows)-1)
    c=Image.new('RGB',(W,H),(8,8,12)); y=0
    for r in rows: c.paste(r,(0,y)); y+=r.height+10
    c.save(f'{out}/{name}.webp',quality=86); print(name,c.size)
dockstack('input-dock-360-390','360 390'.split() and [360,390])
dockstack('input-dock-576-768',[576,768],scale=1.5)
dockstack('input-dock-1440',[1440],scale=1.3)
dockstack('input-dock-hidden-390',[390],shown='hidden')
# locked
for w in (390,1440):
    rows=[]
    for t in ('before','a','b'):
        r=load(t,f'dock-ready-{w}',scale=1.6 if w<700 else 1.0); k=load(t,f'dock-locked-{w}',scale=1.6 if w<700 else 1.0)
        c=Image.new('RGB',(r.width+k.width+20,max(r.height,k.height)),(8,8,12)); c.paste(r,(0,0)); c.paste(k,(r.width+20,0)); rows.append(lab(c,f'{SHA[t]} — ready (left) / generating (right)'))
    W=max(r.width for r in rows); H=sum(r.height for r in rows)+10*2
    c=Image.new('RGB',(W,H),(8,8,12)); y=0
    for r in rows: c.paste(r,(0,y)); y+=r.height+10
    c.save(f'{out}/input-locked-{w}.webp',quality=86); print('locked',w,c.size)
# time-ordered streams
for w,sc in ((390,0.55),(1440,0.3)):
    for t in ('before','a','b'):
        names=[f'stream-{w}-t500',f'stream-{w}-t1500',f'stream-{w}-t3000',f'stream-{w}-t6000',f'stream-{w}-detached']
        ims=[lab(load(t,n,scale=sc),n.split('-')[-1]) for n in names]
        W=sum(i.width for i in ims)+10*4; H=max(i.height for i in ims)
        c=Image.new('RGB',(W,H+34),(8,8,12)); x=0
        for i in ims: c.paste(i,(x,34)); x+=i.width+10
        ImageDraw.Draw(c).text((10,5),f'{SHA[t]} — streaming timeline {w}px (500ms, 1.5s, 3s, 6s, manual-detach)',fill=(255,255,255),font=font)
        c.save(f'{out}/stream-{w}-{t}.webp',quality=82); print('stream',w,t,c.size)
# keyboard
for sc in ('short','c5200'):
    rows=[]
    for t in ('before','a','b'):
        ims=[load(t,f'kb-closed-{sc}',scale=0.6),load(t,f'kb-open-{sc}',scale=0.6)]
        c=Image.new('RGB',(sum(i.width for i in ims)+20,max(i.height for i in ims)),(8,8,12)); x=0
        for i in ims: c.paste(i,(x,0)); x+=i.width+20
        rows.append(lab(c,f'{SHA[t]} — keyboard closed / open (390px, emulated)'))
    W=sum(r.width for r in rows)+20*2; H=max(r.height for r in rows)
    c=Image.new('RGB',(W,H),(8,8,12)); x=0
    for r in rows: c.paste(r,(x,0)); x+=r.width+20
    c.save(f'{out}/keyboard-{sc}.webp',quality=84); print('kb',sc,c.size)
# bg opacity
for op in (0.5,0.8,1):
    hrow(f'mobile-bg-text-390-{op}',f'bg-text-390-{op}')
hrow('mobile-bg-text-390-0.22','bg-text-390-0.22')
# fonts
for w,sc in ((390,1.0),(1440,0.5)):
    for f in ('small','xlarge'):
        hrow(f'font-{f}-{w}',f'font-{f}-{w}',scale=sc)
# modes
for mode in ('left','inline','off'):
    hrow(f'mode-{mode}-390',f'mode-{mode}-390',scale=0.8)
hrow('adult-adult-390','adult-adult-390',scale=0.8)
hrow('adult-blocked-390','adult-blocked-390',scale=0.8)
