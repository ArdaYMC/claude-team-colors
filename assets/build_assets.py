"""Build showcase SVGs and render their 2x PNGs. Writes only beside this file."""
from pathlib import Path
from html import escape
import re
import xml.etree.ElementTree as ET
import fitz
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen

OUT = Path(__file__).resolve().parent
SOURCE = (OUT.parent / 'hooks/register.tsx').read_text(encoding='utf-8')
COLORS = dict(Claude='#D97757', Opus='#8B6CEF', Sonnet='#3B82F6', Haiku='#65A30D', Fable='#E0A100', Diğer='#64748B', Codex='#14B8A6')
assert all(color in SOURCE for color in COLORS.values())
BG, PANEL, LINE, FG, MUTED = '#14171C', '#1B1F25', '#30353D', '#F1F0EC', '#A5ABB4'

def key(name, x, y, size=20, status='running'):
    # These fragments are read directly from keycapSvg, not redrawn.
    body = SOURCE.split('function keycapSvg(')[1].split('function statusWord(')[0]
    eyes = re.findall(r"\? '([^']+)'|: '([^']+)'", body)
    fragments = [a or b for a,b in eyes if '<' in (a or b)]
    eye = fragments[{'done':0, 'failed':1, 'running':2}[status]]
    rects = re.findall(r'[\x60\x27](<rect[^\n]+?/>)[\x60\x27]', body.split('return (')[1])
    geometry = ''.join(rects).replace('${color}', COLORS[name])
    assert len(rects) == 4
    opacity = '.55' if status == 'done' else '1'
    return f'<g transform="translate({x} {y}) scale({size/20})" opacity="{opacity}">{geometry}{eye}</g>'

def text(x,y,s,size=16,color=FG,weight=400,anchor='start'):
    return f'<text x="{x}" y="{y}" font-family="Segoe UI, sans-serif" font-size="{size}" font-weight="{weight}" fill="{color}" text-anchor="{anchor}">{escape(s)}</text>'

def rect(x,y,w,h,fill=PANEL,r=0,stroke=None):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}"'+(f' stroke="{stroke}"' if stroke else '')+'/>'

def line(x,y,x2,y2):
    return f'<path d="M{x} {y}H{x2}" stroke="{LINE}"/>' if y==y2 else f'<path d="M{x} {y}L{x2} {y2}" stroke="{LINE}"/>'

def save(name,w,h,parts,desc):
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img" aria-labelledby="title desc">
<title id="title">{escape(name.replace('-', ' '))}</title><desc id="desc">{escape(desc)}</desc>
<style>text {{font-family:'Segoe UI',sans-serif; font-variant-numeric:tabular-nums}}</style>
{rect(0,0,w,h,BG)}{''.join(parts)}</svg>'''
    (OUT / (name+'.svg')).write_text(svg,encoding='utf-8')
    return name,w,h

def hero(social=False):
    w,h = (1200,630) if social else (1280,640)
    p = [text(72,140,'Claude team colors',64,weight=600),
         text(76,198,'See who is working: Claude, subagents and Codex,',25,MUTED),
         text(76,233,'each in its own colour.',25,MUTED)]
    for i,n in enumerate(['Claude','Opus','Sonnet','Haiku','Codex']):
        x = 76 + i*208
        p += [key(n,x,307,112),text(x+56,462,n,21,COLORS[n],600,'middle')]
    p += [line(76,523,w-76,523)]
    if social:
        p += [text(76,570,'github.com/ArdaYMC/claude-team-colors',22),text(w-76,570,'/ekip',20,MUTED,anchor='end')]
    else:
        p += [text(76,570,'/ekip',20,FG,600),text(152,570,'Ekip: Claude · 2 alt ajan · Codex',19,MUTED),text(w-76,570,'ekip-renkleri',19,MUTED,anchor='end')]
    return save('social-card' if social else 'hero',w,h,p,'Claude team colors. See who is working: Claude, subagents and Codex, each in its own colour. Five source-exact keycap avatars in orange, violet, blue, green and teal.')

def pane():
    p = [rect(20,18,840,584,PANEL,12,LINE),text(44,56,'Ekip',22,weight=600),text(830,54,'/ekip',16,MUTED,anchor='end'),line(20,74,860,74)]
    for i,n in enumerate(['Claude','Opus','Sonnet','Haiku','Codex']):
        x=44+i*119
        p += [key(n,x,85,18),text(x+25,100,n,13,COLORS[n],600)]
    p += [text(44,134,'Şimdi',17,weight=600)]
    def row(n,y,label,meta,status='running'):
        return [key(n,44,y,28,status),text(87,y+14,n,16,COLORS[n],600),text(163,y+14,label,16),text(87,y+36,meta,14,MUTED)]
    p += row('Claude',151,'ana oturum','çalışıyor · 2 dk · 14 araç · görevleri koordine ediyor')
    p += row('Opus',207,'Thock kod modu aşama 1-2','çalışıyor · 38 dk · 171 araç · bileşenleri düzenliyor')
    p += row('Codex',263,'Thock logo kiti','arka planda · 6 dk · SVG varyantları hazırlanıyor')
    p += [line(44,319,836,319),text(44,346,'Bitenler',17,weight=600)]
    p += row('Haiku',362,'İsim adaylarının çakışma araştırması','bitti · 4 dk · 12 araç','done')
    p += [line(44,414,836,414),text(44,441,'Akış',17,weight=600)]
    feed=[('6 dk','Codex','başladı: Thock logo kiti'),('5 dk','Opus','araç: bileşenleri düzenliyor'),('4 dk','Haiku','başladı: İsim adaylarının çakışma araştırması'),('2 dk','Claude','araç: görevleri koordine ediyor'),('1 dk','Codex','arka planda sürüyor'),('şimdi','Haiku','bitti (4 dk)')]
    for i,(t,n,event) in enumerate(feed):
        y=466+i*21
        p += [text(44,y,t,13,MUTED),text(106,y,n,13,COLORS[n],600),text(173,y,event,13)]
    p += [text(44,591,'Ekip: Claude · 1 alt ajan · Codex',12,MUTED),text(836,591,'Illustration',11,MUTED,anchor='end')]
    return save('pane-mockup',880,620,p,'Temsili /ekip paneli. Şimdi: Claude, Opus ve arka planda çalışan Codex. Bitenler: Haiku. Altı olaydan oluşan renkli Akış. Gerçek uygulamanın ekran görüntüsü değildir.')

def band():
    p=[text(24,31,'Çalışıyor:',14,MUTED)]
    chips=[('Opus',100,256,'Thock kod modu…'),('Codex',366,248,'Thock logo kiti…'),('Haiku',624,232,'İsim adayları…')]
    for n,x,w,label in chips:
        p += [rect(x,10,w,32,PANEL,6,LINE),key(n,x+8,16,20),text(x+34,31,n,14,COLORS[n],600),text(x+91,31,label,13,MUTED)]
    p += [rect(24,55,832,41,PANEL,7,LINE),text(39,81,'›',22,MUTED),text(62,80,'Bir görev yazın…',14,MUTED),text(856,114,'Illustration',10,MUTED,anchor='end')]
    return save('band-mockup',880,120,p,'Temsili komut kutusu ve Çalışıyor bandı. Opus, Codex ve Haiku için avatar, model adı ve görev etiketi. Gerçek uygulamanın ekran görüntüsü değildir.')

def avatars():
    p=[text(28,33,'Bir renk, bir ekip üyesi.',21,weight=600)]
    for i,n in enumerate(['Claude','Opus','Sonnet','Haiku','Fable','Diğer','Codex']):
        x=28+i*119
        p += [key(n,x,55,48),text(x+24,126,n,16,COLORS[n],600,'middle'),text(x+24,148,COLORS[n],12,MUTED,anchor='middle')]
    p += [line(28,171,852,171),text(28,210,'Durumlar',14,MUTED)]
    for x,status,label in [(180,'running','çalışıyor'),(411,'done','bitti'),(642,'failed','hata')]:
        p += [key('Claude',x,187,38,status),text(x+52,212,label,16)]
    p += [text(28,245,'Avatar geometrisi ve renkler: hooks/register.tsx · keycapSvg',11,MUTED)]
    return save('avatars',880,260,p,'Yedi kaynak rengi: Claude, Opus, Sonnet, Haiku, Fable, Diğer ve Codex. Çalışıyor: dikey gözler. Bitti: yatay gözler ve yüzde 55 opaklık. Hata: çarpı gözler.')

if __name__ == '__main__':
    specs=[hero(),pane(),band(),avatars(),hero(True)]
    # Outline an in-memory rendering copy so MuPDF uses the exact installed
    # Segoe UI glyphs, including Turkish, instead of a fallback font. Public
    # SVGs retain editable text; no font file is copied or distributed.
    fonts={400:TTFont('C:/Windows/Fonts/segoeui.ttf'),600:TTFont('C:/Windows/Fonts/segoeuib.ttf')}
    ns='{http://www.w3.org/2000/svg}'
    for name,w,h in specs:
        root=ET.fromstring((OUT/(name+'.svg')).read_text(encoding='utf-8'))
        for t in list(root.findall(ns+'text')):
            font=fonts[int(t.get('font-weight'))]
            glyphs=font.getGlyphSet(); cmap=font.getBestCmap()
            size=float(t.get('font-size')); scale=size/font['head'].unitsPerEm
            names=[cmap[ord(c)] for c in t.text]
            width=sum(glyphs[n].width for n in names)*scale
            x=float(t.get('x')); y=float(t.get('y'))
            anchor=t.get('text-anchor')
            if anchor=='middle': x-=width/2
            elif anchor=='end': x-=width
            assert x>=0 and x+width<=w,(name,t.text,x,width)
            group=ET.Element(ns+'g',{'transform':f'translate({x} {y}) scale({scale} {-scale})','fill':t.get('fill')})
            advance=0
            for n in names:
                pen=SVGPathPen(glyphs); glyphs[n].draw(pen)
                ET.SubElement(group,ns+'path',{'d':pen.getCommands(),'transform':f'translate({advance} 0)'})
                advance+=glyphs[n].width
            root.insert(list(root).index(t),group); root.remove(t)
        doc=fitz.open(stream=ET.tostring(root),filetype='svg')
        pix=doc[0].get_pixmap(matrix=fitz.Matrix(2,2))
        pix.save(str(OUT/(name+('@2x' if name=='social-card' else '')+'.png')))
        if name=='social-card':
            doc[0].get_pixmap().save(str(OUT/'social-card.png'))
        print(f'{name}: {w}x{h} SVG; {pix.width}x{pix.height} PNG; text bounds OK')
