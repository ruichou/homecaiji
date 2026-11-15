# homecaiji · 抖音链接采集

用真实登录态账号，以**拟人化只读行为**采集抖音视频/图文链接，按行业词过滤后推送到引潮的链接接收接口。

采集只负责"找链接"，评论、手机号、线索池由引潮那边处理。

---

## 目录结构

```
tools/
  lib.mjs              CDP 连接、搜索接口拦截、数据提取
  dy.mjs               手动单次采集（status / login / api / collect / probe / dump / shot）
  batch.mjs            按计划批量跑，支持断点续跑、熔断
  plan.mjs             生成 N 天采集计划
  push.mjs             过滤 + 分批推送链接到引潮接口
  merge.mjs            多批结果合并去重
  relevance.mjs        行业相关性过滤
  summary.mjs          采集结果汇总
  export_handoff.mjs   导出链接清单（文件交接用，旧流程）
  relcheck.mjs         相关性抽样检查（开发用）
  build_vocab_xlsx.py  从 keywords.json 生成桌面词表 Excel
  import_vocab.py      把桌面 Excel 词表读回 keywords.json
data/
  keywords.json        行业词表（唯一需要提交的数据文件）
  ingest.key           推送密钥（本地保存，不提交）
  pushed_ids.json      已推台账（不提交）
  其余                 采集结果、日志（不提交）
拟人采集方案.md         会话剧本、配额、劣化分级
方案设计.md             系统整体设计
```

---

## 环境要求

- Windows + Google Chrome
- Node.js 22+（用全局 `fetch` 和 `WebSocket`，无需 npm 依赖）
- Python 3.11+ 且带 openpyxl（只在维护词表 Excel 时需要）

---

## 快速开始

### 1. 起一个带调试端口的 Chrome

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9222 `
  --user-data-dir="D:\抖音auto\chrome-profile" `
  --no-first-run https://www.douyin.com/
```

首次需要扫码登录，登录态存在 `chrome-profile`，之后不用重复扫。

### 2. 单次采集

```powershell
node tools/dy.mjs status                     # 看登录状态
node tools/dy.mjs api "膜结构车棚" 60 综合     # 接口拦截，拿视频+图文
node tools/dy.mjs collect "膜结构" 60 视频     # DOM 兜底
```

结果写到 `data/`，CSV 可直接用 Excel 打开。

### 3. 推送

```powershell
# 把密钥写进 data/ingest.key（不要提交）
node tools/push.mjs --stats                  # 查服务端待处理
node tools/push.mjs data/xxx.json --dry       # 预览过滤结果
node tools/push.mjs data/xxx.json             # 正式推送，默认 100 条一批
```

`push.mjs` 会按 `data/keywords.json` 过滤：标题或作者必须命中收录词，命中排除词直接丢。
已推过的 ID 记在 `data/pushed_ids.json`，重复跑不会重推。

### 4. 词表维护

```powershell
python tools/build_vocab_xlsx.py    # 生成桌面「抖音词表.xlsx」
# 在 Excel 里增删改，保存
python tools/import_vocab.py        # 读回 data/keywords.json
```

Excel 有四个页：词表（收录词/排除词）、关键词记录、城市清单、说明。
不要改表头文字、工作表名，不要合并单元格。

---

## 关键设计

**只用只读行为。** 浏览、搜索、看评论、进直播间；不点赞、不关注、不评论、不私信。
真人感靠停留时长和滚动节奏，不靠互动。

**搜索只是入口之一。** 41 个城市全量硬搜会把账号打废，长期应转向同行主页轮询、
话题页、视频推荐流。搜索维持每周一次拓新即可。

**劣化要早停。** 每次采集算四个指标：行业词命中率、结果条数、与近 7 天重合率、
城市词命中率。低于阈值就冷却换号，而不是硬撑。

**词表比代码重要。** 「贴膜」「车衣」这种同形字靠排除词挡，加一条排除词
胜过加十条收录词。

---

## 注意

- `data/ingest.key` 是推送密钥，**不要提交**，`.gitignore` 已排除。
- `chrome-profile/` 是登录态，含 cookie，**不要提交**。
- 采集到的链接属于公开内容，但下游用于营销触达时需遵守《个人信息保护法》，
  只做公开信息采集、最小化存储、人工一对一触达，不做批量自动私信。
