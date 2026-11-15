# -*- coding: utf-8 -*-
"""把桌面 Excel 词表读回 data/keywords.json"""
import json
import shutil
from datetime import datetime
from openpyxl import load_workbook

XLSX = r"C:\Users\34632\Desktop\抖音词表.xlsx"
OUT = r"D:\抖音auto\data\keywords.json"

wb = load_workbook(XLSX, data_only=True)

# ---------- 词表 ----------
ws = wb["词表"]
header = [c.value for c in ws[1]]
need = ["行业", "类型", "词语", "启用"]
missing = [h for h in need if h not in header]
if missing:
    raise SystemExit(f"词表表头缺列: {missing}，实际表头: {header}")

idx = {h: header.index(h) for h in need}
industries = {}
skipped = []
row_count = 0

for row in ws.iter_rows(min_row=2, values_only=True):
    if row is None:
        continue
    ind = row[idx["行业"]]
    typ = row[idx["类型"]]
    word = row[idx["词语"]]
    on = row[idx["启用"]]
    if not ind or not typ or not word:
        continue
    row_count += 1
    if str(on).strip() != "是":
        skipped.append(f"{ind}/{word}")
        continue
    ind = str(ind).strip()
    word = str(word).strip()
    typ = str(typ).strip()
    industries.setdefault(ind, {"active": True, "terms": [], "exclude": []})
    if typ == "收录词":
        if word not in industries[ind]["terms"]:
            industries[ind]["terms"].append(word)
    elif typ == "排除词":
        if word not in industries[ind]["exclude"]:
            industries[ind]["exclude"].append(word)
    else:
        print(f"  [跳过] 未知类型 {typ!r}: {word}")

# 标记当前行业（第一个有词条的）
for name in industries:
    industries[name]["active"] = True

# ---------- 关键词记录 ----------
keywords = []
if "关键词记录" in wb.sheetnames:
    ws2 = wb["关键词记录"]
    h2 = [c.value for c in ws2[1]]
    for row in ws2.iter_rows(min_row=2, values_only=True):
        if not row or not row[0]:
            continue
        rec = dict(zip(h2, row))
        keywords.append({
            "keyword": rec.get("关键词"),
            "industry": rec.get("行业") or next(iter(industries), ""),
            "source": rec.get("来源") or "user",
            "firstUsed": str(rec.get("首次使用") or ""),
            "lastUsed": str(rec.get("最后使用") or ""),
            "uses": int(rec.get("使用次数") or 0),
            "produced": int(rec.get("产出条数") or 0),
            "avgRelevance": int(rec.get("平均相关度") or 0),
            "status": rec.get("状态") or "active",
            **({"note": rec.get("备注")} if rec.get("备注") else {})
        })

data = {"industries": industries, "keywords": keywords}

# 备份后写入
try:
    shutil.copy2(OUT, OUT + ".bak")
except FileNotFoundError:
    pass
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print(f"读入 {row_count} 行词条，跳过(未启用) {len(skipped)} 行")
if skipped:
    print("  未启用:", ", ".join(skipped[:10]) + (" ..." if len(skipped) > 10 else ""))
print()
for name, d in industries.items():
    print(f"  {name}: 收录 {len(d['terms'])} 个 / 排除 {len(d['exclude'])} 个")
print(f"\n关键词 {len(keywords)} 个")
print("已写入:", OUT, "（旧文件备份为 keywords.json.bak）")
