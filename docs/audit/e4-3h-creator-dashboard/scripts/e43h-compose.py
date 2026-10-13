import os, sys
from PIL import Image, ImageDraw, ImageFont
SRC='/tmp/e43h-out'; DST='/tmp/e43h-ev/docs/audit/e4-3h-creator-dashboard'
labels=[('before','BEFORE (main)'),('a','A Quiet'),('b','B Command Center')]
names=sorted(f[:-4] for f in os.listdir(f'{SRC}/before/raw') if f.endswith('.png'))
for l,_ in labels:
    os.makedirs(f'{DST}/raw/{l}',exist_ok=True)
os.makedirs(f'{DST}/compare',exist_ok=True)
try: font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',22)
except: font=ImageFont.load_default()
order=['full','top','inactive','tier','earnings','share','exchange','withdraw','profile','notice','comments','keyboard']
def key(n):
    for i,o in enumerate(order):
        if n.startswith(o): return (i,n)
    return (99,n)
names.sort(key=key)
MAXH=9000
for idx,n in enumerate(names,1):
    ims=[]
    for l,_ in labels:
        im=Image.open(f'{SRC}/{l}/raw/{n}.png').convert('RGB')
        im.save(f'{DST}/raw/{l}/{n}.webp',quality=82,method=4)
        ims.append(im)
    # normalise each to the same scale (device-scale-factor may be 2 for mobile)
    h=max(i.height for i in ims)
    scale=min(1.0,MAXH/h)
    ims=[i.resize((int(i.width*scale),int(i.height*scale)),Image.LANCZOS) if scale<1 else i for i in ims]
    H=max(i.height for i in ims); gap=16; bar=40
    W=sum(i.width for i in ims)+gap*(len(ims)-1)
    c=Image.new('RGB',(W,H+bar),(18,18,24)); d=ImageDraw.Draw(c); x=0
    for (l,t),i in zip(labels,ims):
        d.text((x+8,8),t,fill=(240,240,245),font=font)
        c.paste(i,(x,bar)); x+=i.width+gap
    c.save(f'{DST}/compare/{idx:02d}-{n}.webp',quality=80,method=4)
print(len(names))
