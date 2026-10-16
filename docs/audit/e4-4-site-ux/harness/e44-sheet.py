import sys
from PIL import Image, ImageDraw
root, label, width, suffix, out = sys.argv[1:6]
names = sys.argv[6:]
ims=[]
for n in names:
    im=Image.open(f"{root}/{label}/{width}/{n}{suffix}.png").convert("RGB")
    tw_=700 if "1440" in width else 390
    im=im.resize((tw_, int(im.height*tw_/im.width))) if im.width!=tw_ else im
    ims.append((n,im))
h=max(i.height for _,i in ims)
tw=sum(i.width for _,i in ims)+10*(len(ims)-1)
sheet=Image.new("RGB",(tw,h+24),(30,30,30))
d=ImageDraw.Draw(sheet)
x=0
for n,i in ims:
    sheet.paste(i,(x,24)); d.text((x+4,4),n,fill=(255,255,0)); x+=i.width+10
sheet.save(out)
print(sheet.size)
