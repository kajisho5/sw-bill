#!/usr/bin/env python3
"""Goodtimes の必要な文字だけを輪郭にして src/shared/glyphs.ts を作る（フォント自体はリポに入れない）。
使い方: python3 -I scripts/make-glyphs.py <goodtimes.ttf>
"""
import sys
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

f = TTFont(sys.argv[1])
gs, cmap, hmtx = f.getGlyphSet(), f.getBestCmap(), f["hmtx"]
cap = f["OS/2"].sCapHeight or 700
out = ["// scripts/make-glyphs.py が作るファイル。手で直さない。", f"export const GT_CAP = {cap};",
       "export const GT: Record<string, { d: string; adv: number }> = {"]
for ch in sorted(set("SEVENTHWELLINVOICEQUOTATIONDELIVERYBILL")):
    g = cmap[ord(ch)]
    pen = SVGPathPen(gs, ntos=lambda v: str(int(round(v))))
    gs[g].draw(TransformPen(pen, (1, 0, 0, -1, 0, 0)))
    out.append(f'  {ch}: {{ d: "{pen.getCommands()}", adv: {hmtx[g][0]} }},')
out.append("};")
open("src/shared/glyphs.ts", "w").write("\n".join(out) + "\n")
