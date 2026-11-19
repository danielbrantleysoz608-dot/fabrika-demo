"""Ава v4_kover: Гоша по пояс на фоне ковра (формат «персонаж в кадре сериала»)."""
import os, cairosvg
from make_avatars import (INK, HAIR, SKIN, SHIRT, STAIN, SW, hair, face_base, stubble, pimple, girl)
OUT = os.path.join(os.path.dirname(__file__), '..')

def wall():
    s = '''<defs>
<pattern id="wp" width="120" height="120" patternUnits="userSpaceOnUse">
<rect width="120" height="120" fill="#ead3a2"/>
<g fill="#e7a99a" opacity=".55"><circle cx="30" cy="30" r="7"/><circle cx="22" cy="24" r="6"/><circle cx="38" cy="24" r="6"/><circle cx="24" cy="38" r="6"/><circle cx="36" cy="38" r="6"/></g>
<circle cx="30" cy="31" r="4" fill="#e9c46a"/>
<path d="M36,44 Q46,56 54,60" stroke="#9cbf8a" stroke-width="3" fill="none" opacity=".7"/>
<g transform="translate(60,60)" fill="#e7a99a" opacity=".55"><circle cx="30" cy="30" r="7"/><circle cx="22" cy="24" r="6"/><circle cx="38" cy="24" r="6"/><circle cx="24" cy="38" r="6"/><circle cx="36" cy="38" r="6"/></g>
<circle cx="90" cy="91" r="4" fill="#e9c46a"/>
</pattern>
<radialGradient id="vig" cx="50%" cy="45%" r="62%"><stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#3a1f10" stop-opacity=".45"/></radialGradient>
</defs><rect width="1080" height="1080" fill="url(#wp)"/>'''
    # ковёр
    x0, y0, x1, y1 = 200, 40, 880, 660
    s += f'<rect x="{x0}" y="{y0}" width="{x1-x0}" height="{y1-y0}" fill="#9b2226" stroke="{INK}" stroke-width="7"/>'
    s += f'<rect x="{x0+40}" y="{y0+40}" width="{x1-x0-80}" height="{y1-y0-80}" fill="#7a1a1d" stroke="#f3e3c0" stroke-width="5"/>'
    for i in range(14):  # белые ромбики по кайме
        for (cx, cy) in ((x0+30+i*(x1-x0-60)/13, y0+20), (x0+30+i*(x1-x0-60)/13, y1-20)):
            s += f'<path d="M{cx},{cy-9} l9,9 l-9,9 l-9,-9 Z" fill="#f3e3c0"/>'
    for i in range(12):
        for (cx, cy) in ((x0+20, y0+40+i*(y1-y0-80)/11), (x1-20, y0+40+i*(y1-y0-80)/11)):
            s += f'<path d="M{cx},{cy-9} l9,9 l-9,9 l-9,-9 Z" fill="#f3e3c0"/>'
    cx, cy = 540, 350
    for r, c in ((250, '#1f2a5a'), (200, '#e09a2d'), (150, '#f3e3c0'), (110, '#b5282c'), (60, '#1f2a5a'), (25, '#e09a2d')):
        s += f'<path d="M{cx},{cy-r} L{cx+r*1.15},{cy} L{cx},{cy+r} L{cx-r*1.15},{cy} Z" fill="{c}"/>'
    for sx in (300, 780):
        for sy in (130, 570):
            s += f'<path d="M{sx},{sy-38} l38,38 l-38,38 l-38,-38 Z" fill="#1f2a5a"/><path d="M{sx},{sy-18} l18,18 l-18,18 l-18,-18 Z" fill="#e09a2d"/>'
    return s

def body_full():
    s = f'''
<!-- штаны -->
<path d="M215,1425 Q540,1460 865,1425 L890,1700 L190,1700 Z" fill="#8f8e8b" stroke="{INK}" stroke-width="{SW}"/>
<!-- пузо из-под футболки -->
<path d="M232,1370 C245,1440 330,1462 540,1464 C750,1462 835,1440 848,1370 Z" fill="{SKIN}" stroke="{INK}" stroke-width="{SW}"/>
<path d="M215,1425 Q540,1460 865,1425 L868,1462 Q540,1497 212,1462 Z" fill="#8f8e8b" stroke="{INK}" stroke-width="{SW}"/>
<circle cx="540" cy="1418" r="9" fill="none" stroke="#d99a72" stroke-width="4"/>
<!-- шея и футболка -->
<path d="M395,780 L685,780 L700,880 L380,880 Z" fill="{SKIN}" stroke="{INK}" stroke-width="{SW}"/>
<path d="M330,858 C280,880 262,960 258,1100 C252,1220 238,1320 232,1392 Q540,1428 848,1392 C842,1320 828,1220 822,1100 C818,960 800,880 750,858
 C700,852 670,850 640,852 Q540,905 440,852 C410,850 380,852 330,858 Z" fill="{SHIRT}" stroke="{INK}" stroke-width="{SW}" stroke-linejoin="round"/>
<path d="M440,852 Q540,905 640,852" fill="none" stroke="{INK}" stroke-width="{SW}"/>
<!-- руки -->
<path d="M168,1080 L160,1350 L250,1350 L262,1090 Z" fill="{SKIN}" stroke="{INK}" stroke-width="{SW}" stroke-linejoin="round"/>
<path d="M912,1080 L920,1350 L830,1350 L818,1090 Z" fill="{SKIN}" stroke="{INK}" stroke-width="{SW}" stroke-linejoin="round"/>
<!-- рукава -->
<path d="M338,862 C250,872 182,935 172,1035 C168,1080 172,1110 180,1118 Q222,1128 268,1114 C258,1040 272,948 338,862 Z" fill="{SHIRT}" stroke="{INK}" stroke-width="{SW}" stroke-linejoin="round"/>
<path d="M742,862 C830,872 898,935 908,1035 C912,1080 908,1110 900,1118 Q858,1128 812,1114 C822,1040 808,948 742,862 Z" fill="{SHIRT}" stroke="{INK}" stroke-width="{SW}" stroke-linejoin="round"/>
<path d="M290,1180 Q330,1230 300,1300 M790,1180 Q750,1230 780,1300" fill="none" stroke="#d9c26a" stroke-width="5" stroke-linecap="round"/>
'''
    s += girl()
    s += f'''<g transform="translate(662,1262)">
<path d="M-38,6 C-46,-20 -12,-34 12,-26 C40,-16 44,12 26,26 C10,38 -28,32 -38,6 Z" fill="{STAIN}"/>
<circle cx="52" cy="-20" r="8" fill="{STAIN}"/><circle cx="-52" cy="34" r="7" fill="{STAIN}"/><circle cx="34" cy="46" r="7" fill="{STAIN}"/></g>
<g transform="translate(470,1300) rotate(-20)"><path d="M-14,-8 L14,-12 L10,10 L-12,8 Z" fill="#e9b949" stroke="{INK}" stroke-width="3"/></g>
<g transform="translate(600,1350) rotate(15)"><path d="M-12,-7 L12,-10 L9,9 L-10,7 Z" fill="#e9b949" stroke="{INK}" stroke-width="3"/></g>
<!-- энергетик в правой руке -->
<g stroke="{INK}" stroke-width="{SW}" stroke-linejoin="round">
<rect x="840" y="1205" width="82" height="150" rx="12" fill="#2f9e44"/>
<rect x="846" y="1196" width="70" height="16" rx="5" fill="#c9c9c9"/></g>
<path d="M888,1235 L866,1285 L884,1285 L872,1325 L902,1268 L884,1268 L896,1235 Z" fill="#ffe14d" stroke="{INK}" stroke-width="3" stroke-linejoin="round"/>
<!-- кулаки -->
<circle cx="205" cy="1365" r="54" fill="{SKIN}" stroke="{INK}" stroke-width="{SW}"/>
<path d="M188,1340 Q172,1365 188,1390" fill="none" stroke="#d99a72" stroke-width="4" stroke-linecap="round"/>
<circle cx="875" cy="1352" r="54" fill="{SKIN}" stroke="{INK}" stroke-width="{SW}"/>
<path d="M892,1327 Q908,1352 892,1377" fill="none" stroke="#d99a72" stroke-width="4" stroke-linecap="round"/>
'''
    return s

def head_tired():
    s = face_base() + hair()
    for cx in (472, 608):
        s += f'''<clipPath id="lid{cx}"><rect x="{cx-40}" y="642" width="80" height="40"/></clipPath>
<circle cx="{cx}" cy="648" r="27" fill="#fbf4e4"/>
<circle cx="{cx}" cy="654" r="11" fill="{INK}" clip-path="url(#lid{cx})"/><circle cx="{cx-4}" cy="650" r="3" fill="#fff" clip-path="url(#lid{cx})"/>
<path d="M{cx-27},648 A27,27 0 0 1 {cx+27},648 Z" fill="#efbd8e"/>
<circle cx="{cx}" cy="648" r="27" fill="none" stroke="{INK}" stroke-width="{SW}"/>
<path d="M{cx-29},645 L{cx+29},645" stroke="{INK}" stroke-width="7" stroke-linecap="round"/>
<path d="M{cx-24},684 Q{cx},698 {cx+24},684" fill="none" stroke="#a98fa8" stroke-width="5" stroke-linecap="round"/>
<path d="M{cx-18},694 Q{cx},704 {cx+18},694" fill="none" stroke="#c4aac0" stroke-width="4" stroke-linecap="round"/>'''
    s += f'<path d="M440,604 L505,606 M575,606 L640,604" stroke="{INK}" stroke-width="7" stroke-linecap="round"/>'
    s += f'<path d="M515,770 Q540,766 565,770" fill="none" stroke="{INK}" stroke-width="6" stroke-linecap="round"/>'
    s += stubble() + pimple(462, 612) + pimple(642, 716) + pimple(574, 792) + pimple(395, 745, 7) + pimple(612, 615, 6)
    return s

def fly(x, y, s=1.0):
    return f'''<g transform="translate({x},{y}) scale({s})">
<ellipse cx="-9" cy="-12" rx="10" ry="13" fill="#fff" stroke="{INK}" stroke-width="3" transform="rotate(-25 -9 -12)"/>
<ellipse cx="9" cy="-12" rx="10" ry="13" fill="#fff" stroke="{INK}" stroke-width="3" transform="rotate(25 9 -12)"/>
<ellipse cx="0" cy="2" rx="12" ry="14" fill="#222"/></g>'''

def svg():
    s = '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">' + wall()
    t = 'translate(540,130) scale(0.86) translate(-540,400)'
    s += f'<g transform="translate(540,112) scale(0.92) translate(-540,-400)">{body_full()}{head_tired()}</g>'
    # мухи
    s += f'<path d="M240,250 q40,-60 90,-20 q50,40 100,-30" fill="none" stroke="{INK}" stroke-width="4" stroke-dasharray="4 12" stroke-linecap="round" opacity=".7"/>'
    s += fly(225, 268, 1.25) + fly(640, 130, 1.0) + fly(820, 470, 1.1)
    for x0 in (150, 196, 860, 906):
        s += f'<path d="M{x0},760 q-18,-25 0,-50 q18,-25 0,-50 q-18,-25 0,-50" fill="none" stroke="#6a9a3a" stroke-width="7" stroke-linecap="round" opacity=".85"/>'
    s += '<rect width="1080" height="1080" fill="url(#vig)"/>'
    return s + '</svg>'

if __name__ == '__main__':
    cairosvg.svg2png(bytestring=svg().encode(), write_to=os.path.join(OUT, 'v4_kover.png'), output_width=1080, output_height=1080)
    print('v4_kover')
