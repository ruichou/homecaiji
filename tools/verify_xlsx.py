# -*- coding: utf-8 -*-
import sys
from openpyxl import load_workbook

p = r"C:\Users\34632\Desktop\抖音词表.xlsx"
wb = load_workbook(p)
print("文件:", p)
print("工作表:", wb.sheetnames)
for name in wb.sheetnames:
    ws = wb[name]
    print(f"  {name}: {ws.max_row} 行 x {ws.max_column} 列 | 冻结 {ws.freeze_panes} | 筛选 {ws.auto_filter.ref}")
print()
ws = wb["词表"]
print("词表表头:", [c.value for c in ws[1]])
print("前 5 行:")
for r in ws.iter_rows(min_row=2, max_row=6, values_only=True):
    print("   ", r)
print()
ws2 = wb["关键词记录"]
print("关键词表头:", [c.value for c in ws2[1]])
for r in ws2.iter_rows(min_row=2, values_only=True):
    print("   ", r)
print()
ws3 = wb["城市"]
print("城市:", ws3.max_row - 1, "个, 前 3:", [c.value for c in ws3[2]][:3] if ws3.max_row > 1 else None)
print("数据验证条数:", len(ws.data_validations.dataValidation))
