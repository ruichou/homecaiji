# -*- coding: utf-8 -*-
"""生成桌面词表 Excel：行业词表 + 关键词记录 + 城市清单"""
import json
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation

OUT = r"C:\Users\34632\Desktop\抖音词表.xlsx"
SRC = r"D:\抖音auto\data\keywords.json"

with open(SRC, "r", encoding="utf-8") as f:
    tax = json.load(f)

HEAD_FILL = PatternFill("solid", fgColor="1F4E79")
HEAD_FONT = Font(bold=True, color="FFFFFF", size=11)
TITLE_FONT = Font(bold=True, size=14, color="1F4E79")
NOTE_FONT = Font(size=10, color="595959")
THIN = Side(style="thin", color="D9D9D9")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)

wb = Workbook()

# ---------- 1. 说明 ----------
ws = wb.active
ws.title = "说明"
ws.column_dimensions["A"].width = 4
ws.column_dimensions["B"].width = 100
ws["B2"] = "抖音采集 · 词表"
ws["B2"].font = TITLE_FONT

lines = [
    ("", ""),
    ("怎么用", "在「词表」页增删改，保存后告诉我一声，我重新读取生效。"),
    ("类型说明", "收录词：标题/作者命中就算这个行业。排除词：命中就丢弃（同形字陷阱，比如「贴膜」有「膜」字但不是膜结构）。"),
    ("启用", "填「是」或「否」。填「否」的整行不参与过滤，方便临时停用而不用删。"),
    ("行业", "目前四个：膜结构、地坪、冷库、推拉棚。后面加行业就新增行，行业名保持一致。"),
    ("关键词记录", "这个页是我采集时的台账，你可以看，也可以在「状态」里改成 paused 让我别再跑。"),
    ("城市", "这是江浙沪+山东的城市清单，后面按城市搜的时候从这里取。"),
    ("注意", "不要改表头文字，不要插入合并单元格，不要改工作表名。改这三样我就读不出来了。"),
]
for i, (k, v) in enumerate(lines, start=3):
    ws.cell(row=i, column=2, value=(f"{k}：{v}" if k else v)).font = NOTE_FONT
    ws.cell(row=i, column=2).alignment = Alignment(wrap_text=True, vertical="top")

# ---------- 2. 词表 ----------
ws = wb.create_sheet("词表")
headers = ["行业", "类型", "词语", "启用", "备注"]
ws.append(headers)

for ind_name, ind in tax["industries"].items():
    for t in ind.get("terms", []):
        ws.append([ind_name, "收录词", t, "是", ""])
    for t in ind.get("exclude", []):
        ws.append([ind_name, "排除词", t, "是", ""])

for c in ws[1]:
    c.fill = HEAD_FILL
    c.font = HEAD_FONT
    c.alignment = Alignment(horizontal="center", vertical="center")

widths = {"A": 12, "B": 10, "C": 22, "D": 8, "E": 40}
for col, w in widths.items():
    ws.column_dimensions[col].width = w

all_rows = ws.max_row
for row in ws.iter_rows(min_row=2, max_row=all_rows, max_col=5):
    for c in row:
        c.border = BORDER
        c.alignment = Alignment(vertical="center")

ws.freeze_panes = "A2"
ws.auto_filter.ref = f"A1:E{all_rows}"

dv_type = DataValidation(type="list", formula1='"收录词,排除词"', allow_blank=False)
dv_on = DataValidation(type="list", formula1='"是,否"', allow_blank=False)
ws.add_data_validation(dv_type)
ws.add_data_validation(dv_on)
dv_type.add(f"B2:B{max(all_rows + 200, 500)}")
dv_on.add(f"D2:D{max(all_rows + 200, 500)}")

# ---------- 3. 关键词记录 ----------
ws2 = wb.create_sheet("关键词记录")
h2 = ["关键词", "行业", "来源", "首次使用", "最后使用", "使用次数", "产出条数", "平均相关度", "状态", "备注"]
ws2.append(h2)
for k in tax.get("keywords", []):
    ws2.append([
        k.get("keyword"), k.get("industry"), k.get("source"),
        k.get("firstUsed"), k.get("lastUsed"),
        k.get("uses", 0), k.get("produced", 0), k.get("avgRelevance", 0),
        k.get("status", "active"), k.get("note", "")
    ])
for c in ws2[1]:
    c.fill = HEAD_FILL
    c.font = HEAD_FONT
    c.alignment = Alignment(horizontal="center", vertical="center")
for col, w in {"A": 20, "B": 12, "C": 8, "D": 12, "E": 12, "F": 10, "G": 10, "H": 12, "I": 10, "J": 30}.items():
    ws2.column_dimensions[col].width = w
ws2.freeze_panes = "A2"
ws2.auto_filter.ref = f"A1:J{max(ws2.max_row, 2)}"

dv_status = DataValidation(type="list", formula1='"active,paused,retired"', allow_blank=True)
ws2.add_data_validation(dv_status)
dv_status.add("I2:I500")

# ---------- 4. 城市 ----------
ws3 = wb.create_sheet("城市")
ws3.append(["省份", "城市", "启用", "备注"])
cities = {
    "上海": ["上海"],
    "江苏": ["南京", "苏州", "无锡", "常州", "南通", "扬州", "泰州", "镇江", "盐城", "淮安", "徐州", "连云港", "宿迁"],
    "浙江": ["杭州", "宁波", "温州", "嘉兴", "湖州", "绍兴", "金华", "台州", "丽水", "衢州", "舟山"],
    "山东": ["济南", "青岛", "烟台", "潍坊", "临沂", "淄博", "济宁", "泰安", "威海", "日照", "东营", "德州", "聊城", "滨州", "菏泽", "枣庄"],
}
for prov, lst in cities.items():
    for c in lst:
        ws3.append([prov, c, "是", ""])
for c in ws3[1]:
    c.fill = HEAD_FILL
    c.font = HEAD_FONT
    c.alignment = Alignment(horizontal="center", vertical="center")
for col, w in {"A": 10, "B": 12, "C": 8, "D": 30}.items():
    ws3.column_dimensions[col].width = w
ws3.freeze_panes = "A2"
ws3.auto_filter.ref = f"A1:D{ws3.max_row}"

wb.save(OUT)
print("saved:", OUT)
print("词表行数:", all_rows - 1)
print("关键词:", len(tax.get("keywords", [])))
