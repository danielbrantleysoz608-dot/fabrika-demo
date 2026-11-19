"""Аватарки «Гоша: 45 дней до true adam» — рисуются кодом: SVG -> PNG (cairosvg).
Координаты головы/тела взяты с кадра ep01 (1080x1920), затем масштабируются в 1080x1080."""
import random, cairosvg, os
OUT = os.path.join(os.path.dirname(__file__), '..')

INK = '#3a2d28'; HAIR = '#362b24'; STRAND = '#77706a'
SKIN = '#f5ca9b'; NOSE = '#eab88c'; CHEEK = '#f2a093'
SHIRT = '#f1dd83'; STAIN = '#d0281f'; DOT = '#8a7a72'
SW = 6  # толщина обводки в координатах кадра

def bg(c1, c2):
    return f'''<defs><radialGradient id="bg" cx="50%" cy="42%" r="70%">
<stop offset="0" stop-color="{c1}"/><stop offset="1" stop-color="{c2}"/></radialGradient></defs>
<rect width="1080" height="1080" fill="url(#bg)"/>'''

def girl():
    s = ''
    s += f'''
<g stroke="{INK}" stroke-width="4" stroke-linejoin="round">
<path d="M418,930 L455,975 L425,995 Z" fill="#7ebbd7"/><path d="M662,930 L625,975 L655,995 Z" fill="#7ebbd7"/>
<path d="M430,1150 C405,1060 420,960 540,950 C660,960 675,1060 650,1150 Z" fill="#e882a5"/>
<ellipse cx="540" cy="1075" rx="82" ry="80" fill="#f7dabb"/>
<path d="M455,1050 C460,975 620,975 625,1050 L600,1030 L585,1052 L560,1015 L540,1048 L515,1012 L495,1050 L478,1028 Z" fill="#e882a5"/>
<ellipse cx="507" cy="1075" rx="16" ry="19" fill="#7a3ea0"/><ellipse cx="573" cy="1075" rx="16" ry="19" fill="#7a3ea0"/>
</g>
<circle cx="502" cy="1068" r="6" fill="#fff"/><circle cx="568" cy="1068" r="6" fill="#fff"/>
<path d="M530,1110 Q540,1118 550,1110" fill="none" stroke="#c8638f" stroke-width="4" stroke-linecap="round"/>
<path d="M395,1050 l8,-18 l8,18 l-8,18 Z" fill="#f2c94c"/><path d="M680,1050 l7,-15 l7,15 l-7,15 Z" fill="#f2c94c"/>
'''
    return s

def body():
    s = f'''
<path d="M395,780 L685,780 L700,880 L380,880 Z" fill="{SKIN}" stroke="{INK}" stroke-width="{SW}"/>
<path d="M120,1500 L150,1000 C165,905 230,870 330,858 C390,852 420,850 440,852 Q540,905 640,852 C660,850 690,852 750,858 C850,870 915,905 930,1000 L960,1500 Z"
 fill="{SHIRT}" stroke="{INK}" stroke-width="{SW}" stroke-linejoin="round"/>
<path d="M440,852 Q540,905 640,852" fill="none" stroke="{INK}" stroke-width="{SW}"/>
<path d="M262,880 C238,960 232,1050 244,1130" fill="none" stroke="{INK}" stroke-width="{SW-1}" stroke-linecap="round"/>
<path d="M818,880 C842,960 848,1050 836,1130" fill="none" stroke="{INK}" stroke-width="{SW-1}" stroke-linecap="round"/>
<path d="M300,960 Q290,1000 300,1040" fill="none" stroke="#d9c26a" stroke-width="4" stroke-linecap="round"/>
<path d="M780,960 Q790,1000 780,1040" fill="none" stroke="#d9c26a" stroke-width="4" stroke-linecap="round"/>
'''
    s += girl()
    # пятно
    s += f'''<g transform="translate(730,1005) scale(.85)">
<path d="M-32,6 C-40,-18 -10,-30 10,-22 C34,-14 38,10 22,22 C8,32 -24,28 -32,6 Z" fill="{STAIN}"/>
<circle cx="44" cy="-16" r="7" fill="{STAIN}"/><circle cx="-46" cy="26" r="6" fill="{STAIN}"/><circle cx="30" cy="38" r="6" fill="{STAIN}"/></g>'''
    return s

def hair():
    random.seed(4)
    pts = []; x = 735; down = True
    while x > 372:
        pts.append((x, 600 + random.randint(-4, 4) if down else 572 + random.randint(-5, 5)))
        x -= 23 + random.randint(-3, 3); down = not down
    pts.append((372, 602))
    zig = ' '.join(f'L{a},{b}' for a, b in pts)
    s = f'''<path d="M318,648 C292,540 330,440 420,414 C480,396 600,396 662,414 C752,440 792,540 766,650
 C758,664 744,660 740,640 {zig} L345,640 C340,660 322,662 318,648 Z" fill="{HAIR}" stroke="{INK}" stroke-width="{SW}" stroke-linejoin="round"/>'''
    for d in ['M425,470 Q408,525 405,566', 'M470,455 Q458,520 456,566', 'M520,450 Q516,520 518,566',
              'M575,450 Q585,520 588,566', 'M625,460 Q642,520 650,566', 'M680,480 Q700,530 706,566']:
        s += f'<path d="{d}" fill="none" stroke="{STRAND}" stroke-width="4" stroke-linecap="round"/>'
    s += f'<path d="M445,438 Q520,418 588,432" fill="none" stroke="{STRAND}" stroke-width="7" stroke-linecap="round"/>'
    s += f'<path d="M622,440 Q660,448 682,468" fill="none" stroke="{STRAND}" stroke-width="7" stroke-linecap="round"/>'
    return s

def face_base(chin_jut=False):
    chin = ('C410,835 480,846 540,852 C600,846 670,835 715,805' if chin_jut
            else 'C410,835 470,838 540,838 C610,838 670,835 715,805')
    s = f'''<circle cx="324" cy="690" r="24" fill="{SKIN}" stroke="{INK}" stroke-width="{SW}"/>
<circle cx="756" cy="690" r="24" fill="{SKIN}" stroke="{INK}" stroke-width="{SW}"/>
<path d="M326,590 C300,700 320,770 365,805 {chin} C760,770 778,700 754,590 Q540,500 326,590 Z" fill="{SKIN}" stroke="{INK}" stroke-width="{SW}"/>
<ellipse cx="420" cy="712" rx="46" ry="22" fill="{CHEEK}" opacity=".75"/>
<ellipse cx="660" cy="712" rx="46" ry="22" fill="{CHEEK}" opacity=".75"/>
<circle cx="540" cy="692" r="22" fill="{NOSE}" stroke="{INK}" stroke-width="{SW-1}"/>'''
    return s

def stubble(open_mouth=False):
    s = ''
    dl = [(432,745),(438,760),(447,774),(458,787)] ; dr = [(655,738),(650,753),(642,768),(633,781)]
    chin = [(492,792),(508,800),(526,804),(544,805),(560,802),(512,812),(532,816),(552,815)]
    up = [(508,742),(522,738),(558,738),(572,742)]
    if open_mouth: chin = [(p[0], p[1]+14) for p in chin]
    for x, y in dl + dr + chin + up:
        s += f'<circle cx="{x}" cy="{y}" r="3.2" fill="{DOT}"/>'
    return s

def pimple(x, y, r=8):
    return f'<circle cx="{x}" cy="{y}" r="{r}" fill="#e2433a" stroke="#b8302a" stroke-width="2"/><circle cx="{x}" cy="{y}" r="{r*0.38}" fill="#ffd9d0"/>'

def eye_round(cx, cy, r=26, pr=11):
    return (f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="#fbf4e4" stroke="{INK}" stroke-width="{SW}"/>'
            f'<circle cx="{cx}" cy="{cy}" r="{pr}" fill="{INK}"/><circle cx="{cx-pr*0.35}" cy="{cy-pr*0.35}" r="{max(2.5,pr*0.3)}" fill="#fff"/>')

def head_group(variant):
    s = face_base(chin_jut=(variant == 1)) + hair()
    if variant == 1:  # мьюинг: прищур, сжатые губы, подбородок вперёд
        for cx, sgn in ((472, 1), (608, -1)):
            s += f'''<clipPath id="sq{cx}"><path d="M{cx-34},{646-8*sgn} L{cx+34},{646+8*sgn} L{cx+34},680 L{cx-34},680 Z"/></clipPath>
<ellipse cx="{cx}" cy="652" rx="27" ry="20" fill="#fbf4e4" clip-path="url(#sq{cx})"/>
<circle cx="{cx+4*sgn}" cy="655" r="10" fill="{INK}" clip-path="url(#sq{cx})"/>
<path d="M{cx-27},{652+0} A27,20 0 0 0 {cx+27},652" fill="none" stroke="{INK}" stroke-width="{SW-1}" clip-path="url(#sq{cx})"/>
<path d="M{cx-33},{646-8*sgn} L{cx+33},{646+8*sgn}" stroke="{INK}" stroke-width="9" stroke-linecap="round"/>'''
        s += f'<path d="M436,600 L506,618" stroke="{INK}" stroke-width="9" stroke-linecap="round"/>'
        s += f'<path d="M644,600 L574,618" stroke="{INK}" stroke-width="9" stroke-linecap="round"/>'
        s += f'<path d="M506,772 Q540,767 574,772" fill="none" stroke="{INK}" stroke-width="7" stroke-linecap="round"/>'
        s += f'<path d="M499,769 Q503,773 501,778 M581,769 Q577,773 579,778" fill="none" stroke="{INK}" stroke-width="4" stroke-linecap="round"/>'
        s += f'<path d="M508,834 Q540,846 572,834" fill="none" stroke="#c99b74" stroke-width="5" stroke-linecap="round"/>'
        s += f'<path d="M378,790 Q420,825 470,838" fill="none" stroke="#d9a77d" stroke-width="5" stroke-linecap="round"/>'
        s += f'<path d="M702,790 Q660,825 610,838" fill="none" stroke="#d9a77d" stroke-width="5" stroke-linecap="round"/>'
        s += stubble() + pimple(470, 612) + pimple(642, 714) + pimple(574, 790)
    elif variant == 2:  # шок
        s += eye_round(470, 646, r=33, pr=7) + eye_round(610, 646, r=33, pr=7)
        s += f'<path d="M432,603 Q462,588 500,598" fill="none" stroke="{INK}" stroke-width="7" stroke-linecap="round"/>'
        s += f'<path d="M648,603 Q618,588 580,598" fill="none" stroke="{INK}" stroke-width="7" stroke-linecap="round"/>'
        s += f'''<ellipse cx="540" cy="780" rx="27" ry="34" fill="#6b2a26" stroke="{INK}" stroke-width="{SW}"/>
<path d="M520,800 Q540,784 560,800 Q556,812 540,813 Q524,812 520,800 Z" fill="#e8767a"/>'''
        s += stubble(open_mouth=True) + pimple(458, 614) + pimple(642, 714) + pimple(585, 800)
        s += f'<path d="M790,600 C782,615 776,626 776,634 A14,14 0 0 0 804,634 C804,626 798,615 790,600 Z" fill="#8fd3f4" stroke="{INK}" stroke-width="4"/>'
    else:  # довольный
        s += f'<path d="M444,650 Q472,618 500,650" fill="none" stroke="{INK}" stroke-width="9" stroke-linecap="round"/>'
        s += f'<path d="M580,650 Q608,618 636,650" fill="none" stroke="{INK}" stroke-width="9" stroke-linecap="round"/>'
        s += f'<path d="M440,596 L505,596 M575,596 L640,596" stroke="{INK}" stroke-width="7" stroke-linecap="round"/>'
        s += f'''<path d="M488,752 Q540,760 592,752 Q585,812 540,814 Q495,812 488,752 Z" fill="#fff" stroke="{INK}" stroke-width="{SW}" stroke-linejoin="round"/>
<path d="M500,790 Q540,800 580,790 Q570,812 540,813 Q510,812 500,790 Z" fill="#e8767a"/>
<path d="M488,752 Q540,760 592,752 Q585,812 540,814 Q495,812 488,752 Z" fill="none" stroke="{INK}" stroke-width="{SW}" stroke-linejoin="round"/>'''
        s += stubble(open_mouth=True) + pimple(462, 612) + pimple(642, 716) + pimple(596, 806)
    return s

def scaled(inner, cx=540, cy=452, s=1.22, rot=0):
    return f'<g transform="translate({cx},{cy}) rotate({rot}) scale({s}) translate(-540,-615)">{inner}</g>'

def svg(variant):
    colors = {1: ('#5ff0de', '#13a89e'), 2: ('#ffe45c', '#ffb703'), 3: ('#b48cff', '#6a2fd6')}[variant]
    s = f'<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">' + bg(*colors)
    s += f'<ellipse cx="540" cy="1040" rx="420" ry="40" fill="#000" opacity=".08"/>'
    rot = -4 if variant == 1 else 0
    s += scaled(body(), rot=0)
    if variant == 3:
        s += f'''<g stroke="{INK}" stroke-width="6" stroke-linejoin="round">
<path d="M395,722 L465,722 L560,830 L505,860 Z" fill="#3b7be0"/>
<path d="M685,722 L615,722 L520,830 L575,860 Z" fill="#e0322d"/>
<circle cx="540" cy="905" r="132" fill="#f6b91d"/></g>
<circle cx="540" cy="905" r="106" fill="#ffd95a" stroke="#e0a312" stroke-width="6"/>
<path d="M462,845 Q500,812 560,810" fill="none" stroke="#fff3c4" stroke-width="10" stroke-linecap="round" opacity=".8"/>
<g font-family="Inter" font-weight="900" fill="{INK}" text-anchor="middle">
<text x="540" y="895" font-size="52">ЗНАЛ</text><text x="540" y="953" font-size="52">ГОШУ</text></g>'''
    s += scaled(head_group(variant), rot=rot)
    if variant == 2:
        s += f'''<g transform="translate(812,232) rotate(8)">
<rect x="-118" y="-50" width="236" height="100" rx="16" fill="#e5322d" stroke="{INK}" stroke-width="7"/>
<text x="0" y="22" font-family="Inter" font-weight="900" font-size="64" fill="#fff" text-anchor="middle">SUB 3</text></g>
<g stroke="{INK}" stroke-width="9" stroke-linecap="round"><path d="M175,320 L222,350"/><path d="M152,405 L210,410"/><path d="M212,248 L244,292"/></g>'''
    if variant == 1:
        s += f'<g fill="#fff"><path d="M800,720 l10,-26 l10,26 l26,10 l-26,10 l-10,26 l-10,-26 l-26,-10 Z"/><path d="M262,735 l6,-15 l6,15 l15,6 l-15,6 l-6,15 l-6,-15 l-15,-6 Z"/></g>'
    return s + '</svg>'

if __name__ == '__main__':
    for v, name in ((1, 'v1_myuing'), (2, 'v2_shok'), (3, 'v3_medal')):
        cairosvg.svg2png(bytestring=svg(v).encode(), write_to=os.path.join(OUT, name + '.png'),
                         output_width=1080, output_height=1080)
        print(name)
