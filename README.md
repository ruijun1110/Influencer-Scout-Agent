# Influencer Scout

一个 AI Agent Skills 包，帮助营销团队在 TikTok 上更快速发掘 KOL/达人，提取联系方式，找到相似创作者，并批量发送建联/合作邀约邮件。

支持场景： **Claude Code**、**Cursor**、**Codex** 。

---

## 准备工作

在开始前，你需要准备以下内容：

| 所需项                      | 用途             | 获取方式                                |
| ------------------------ | -------------- | ----------------------------------- |
| TikHub API Key           | 搜索 TikTok 达人数据 | [tikhub.io](https://tikhub.io) 注册获取 |
| Gmail `credentials.json` | 自动发送达人建联邮件     | 联系Raymond获取                         |

---

## 安装

### 第一步：克隆项目

```bash
git clone https://github.com/ruijun1110/Influencer-Scout-Agent.git
cd Influencer-Scout-Agent
```

### 第二步：配置 Gmail（仅需要自动化发送合作邀约时需要）

将收到的 `credentials.json` 文件放到 `.agent/credentials/credentials.json`，然后运行 
```bash
./setup.sh
```

脚本会自动完成环境配置，过程中会自动弹出浏览器进行 Google 账号授权，完成一次即可，之后无需重复操作。完成后按提示操作。
### 第三步：填入 TikHub API Key

环境配置过程中也会打开`.env` 文件，需要在里面填入你的 Key：

```
TIKHUB_API_KEY=填入你的Key
SENDER_EMAIL=你的Gmail地址     # 仅发邮件时需要
```

### 第四步：创建你的投放项目

每个营销投放项目对应一个"Campaign"（投放项目）。复制`_example`文件夹，将文件夹名称改为新项目名称，便可开始配置：

```bash
cp -r context/campaigns/_example context/campaigns/我的项目名称
```

项目文件夹内有三个配置文件，逐一编辑：

---

**`campaign.md`** — 达人画像与筛选标准

```yaml
persona: "面向东南亚市场、关注护肤和美妆的 Gen Z 用户" # 目标观众画像描述
view_threshold: 10000        # 视频最低播放量，低于此值不纳入候选
min_video_views: 20000       # 达人近期作品的最低播放量门槛
recent_video_count: 10       # 评估达人时参考的最近作品数量
max_candidates_per_keyword: 5  # 每个关键词最多收录的候选达人数
```

---

**`keywords.md`** — 关键词追踪表

AI会优先处理列表中所有待搜索的关键词。列表支持手动添加，如果没有带搜索的关键词，AI 也会根据你的达人画像自动补充建议关键词进行搜索。

```markdown
| keyword          | status  | source | date       |
|------------------|---------|--------|------------|
| skincare routine | pending | manual | 2026-03-10 |
```

`status` 说明：
- `pending` — 待搜索
- `searched` — 已完成搜索

---

**`outreach.md`** — 合作邀约邮件模板

```
Subject: 标题

Hi {{recipient_name}}，

【内容】
```

`{{recipient_name}}` 会自动替换为达人的账号名，其余内容直接使用你填写的文案。

如需在邮件中附加文件（如媒体资料包、产品介绍 PDF），在文件开头添加 YAML frontmatter，并将附件文件放入 `attachments/` 子文件夹：

```
---
attachments:
  - attachments/media_kit.pdf
  - attachments/product_brief.pdf
---

Subject: 标题

Hi {{recipient_name}}，

【内容】
```

项目结构示例：

```
context/campaigns/我的项目/
├── campaign.md
├── keywords.md
├── outreach.md          ← 在此声明附件
└── attachments/
    ├── media_kit.pdf
    └── product_brief.pdf
```

不需要附件时，直接省略 frontmatter 即可，格式与之前完全兼容。

---

## 日常使用

打开 Claude Code 或 Cursor，在对话框中直接输入以下指令：

### 探索达人 `/scout`

```
/scout 我的项目名称 
```

AI 会自动搜索 TikTok 视频，筛选符合播放量门槛的达人，提取 bio、主页链接和联系邮箱，并写入结果表格。

如果你想指定搜索某个关键词：

```
/scout 我的项目名称 "护肤日常"
```

- **不指定关键词**：处理 `keywords.md` 中所有 `pending` 状态的关键词
- **指定关键词**：仅搜索该词，不自动生成新关键词

### 发现相似达人 `/lookup`

```
/lookup @达人账号
/lookup https://www.tiktok.com/@达人账号
```

根据一个达人找到风格相近的其他创作者，提取联系信息，保存到"Similar Users"表。适合以一个头部达人为基准，批量扩充候选池。

### 发送合作邀约 `/outreach`

```
/outreach 我的项目名称
```

AI 会先展示每一封邮件的预览，**你确认后才会正式发送**。

建议先用测试模式，将所有邮件发到你自己的邮箱验证效果：

```bash
uv run .agent/skills/scout/scripts/cli.py outreach 我的项目名称 --test-email 你的邮箱 --dry-run
```

如需单独给某位达人发送邀约：

```bash
uv run .agent/skills/scout/scripts/cli.py outreach 我的项目名称 --handle 达人账号
```

---

## 查看结果

所有数据保存在 `data/influencers.xlsx`，包含以下几个 Sheet：

| Sheet 名称 | 内容 |
|---|---|
| **Influencers** | 通过筛选的达人，含联系邮箱 |
| **Candidates** | 候选达人池及审核状态 |
| **Search Log** | 关键词搜索记录 |
| **Similar Users** | `/lookup` 发现的相似达人 |
| **Outreach** | 邮件发送记录 |

同时会生成 `data/dashboard.html`，用浏览器打开可按项目和关键词筛选查看。

---

## 进阶指令（直接运行脚本）

如需更精细的操作，可直接运行底层命令：

```bash
# 单独审核某位达人是否符合项目门槛
uv run .agent/skills/scout/scripts/cli.py audit @达人账号 项目名称

# 将 Similar Users 中的达人提升为正式候选（审核 + 提取联系方式）
uv run .agent/skills/scout/scripts/cli.py promote @达人账号 项目名称

# 单独提取某位达人的联系信息（仅展示，不写入表格）
uv run .agent/skills/scout/scripts/cli.py enrich @达人账号

# 刷新 dashboard
uv run .agent/skills/scout/scripts/cli.py dashboard 项目名称
```
