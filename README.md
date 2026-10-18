# dsh-smart-models — 智能模型聚合选择器 + 渠道积分 HUD

> 专为 DeepSeek Harness (DSH) 打造的独立规范级 Cordis 插件，同时解决两个痛点：
> **① 模型选择器中渠道过多、模型分散、翻找繁琐；② 看不到各免费渠道的实时积分余额与单轮消耗。**

- **仓库名**：`dsh-smart-models-hud`
- **包名（package.json `name`）**：`dsh-smart-models`
  > 两者不同是刻意为之：保持包名不变可让已有本地 profile 依赖与软链接零改动。

---

## 📥 安装

### 方式 A：从 Release 下载（推荐）

1. 打开 [Releases](https://github.com/mlgbz523/dsh-smart-models-hud/releases) 下载 `dsh-smart-models-0.1.0.tgz`；
2. 解压到 `~/.dsh/profiles/desktop/node_modules/dsh-smart-models/`；
3. 在 `~/.dsh/profiles/desktop/package.json` 的 `dependencies` 加入：
   ```json
   "dsh-smart-models": "file:node_modules/dsh-smart-models"
   ```
4. 在 `dsh.profile.bundles` 数组末尾加入 `"dsh-smart-models"`；
5. **完整重启 DSH**（宿主层改动，`Ctrl+R` 不够）。

### 方式 B：clone 后软链接

```powershell
git clone https://github.com/mlgbz523/dsh-smart-models-hud.git
cmd /c mklink /J "%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-smart-models" "<clone路径>"
```

之后同方式 A 的第 3–5 步。

---

## 🌟 核心特性

### 一、模型聚合选择器

1. **以模型为中心（Model-centric 聚类）**：
   - 告别按渠道拆分的冗余模型列表。同名模型（如 `DeepSeek-V4.1-Flash`、`Gemini 3.8 Flash`、`DeepSeek-R1`）整齐聚类为单一行。
   - 右侧直观展现该模型在各供应商渠道的药丸徽章及精准计费倍率（精确到两位小数，如 `x0.00`、`x0.50`、`x1.00`）。

2. **左侧模型列表 + 右侧动态伴随渠道卡片**：
   - 左侧单行高度锁定 32px，零布局跳动（Zero Layout Shift）。
   - 鼠标滑过模型行，右侧伴随卡片跟随 Y 轴动态对齐，自动避让屏幕边缘。
   - 搜索模式下依然遵循默认折叠规则。

3. **星标（★/☆）独立收藏与默认渠道设置**：
   - **模型级收藏**：模型名前隐藏式星标，激活时显示实心金星，未激活时鼠标悬停显示空心开关。
   - **渠道级星标**：将该渠道设为该模型的永久首选渠道。
   - 星标操作为纯收藏记忆，**绝不改变当前会话的即时模型**，防误触。

4. **智能最低消耗推荐与点击直连**：
   - 为每个模型自动计算积分/倍率最低的渠道（免算力通道 > 每日签到积分 > 网页端额度 > API 按量扣费）。
   - 直接点击模型行即可一键使用该默认渠道。

5. **本地磁盘双重持久化**：
   - 偏好设置通过 `/api/smart-models/preferences` 同步到 `~/.dsh/smart-models-preferences.json`，清缓存也不丢。

### 二、渠道积分 HUD（输入框左侧常驻胶囊）

6. **自动跟随当前渠道展示余额**：
   - 切到 `CodeArts` / `WorkBuddy` / `TRAE` / `LobsterAI` / `Qoder` 等积分渠道，自动显示该渠道所有账号的**积分总余额**（如 `🅲 CodeArts 1,360 分`）。
   - 点击胶囊可强制刷新。

7. **区分「积分型」与「配额型」两种语义**（重要）：
   - **积分型**（codearts/buddy/trae/lobsterai/qoder/minimax/zcode…）：跨账号累加，显示总积分。
   - **配额型**（`Gemini` 5小时/周窗口、`Antigravity agy` 5小时/周窗口）：**取最低剩余窗口百分比**，不累加（百分比相加无意义），并按健康度着色（≤10% 红、≤30% 琥珀）。
   - 悬停胶囊可查看各窗口分别剩余与重置时间。

8. **任务结束自动结算消耗**：
   - 任务开始时快照余额，结束后强制重查并计算差值，胶囊短暂显示 `⚡ -X 余 Y`，8 秒后回落。

9. **数据来源只读解耦**：
   - 积分型与 Gemini 走 `dsh-our-free-model` 的 `channel-pack` RPC（`credits.balances`）；
   - agy 走本插件宿主路由 `/api/smart-models/agy-quota`（读取 `~/.dsh/agy-accounts/pool.json`）；
   - **不修改、不侵入上述插件的任何源码与状态**。

---

## 📦 插件架构与规范

- **Cordis 微内核架构**：零侵入，注册两个槽位：
  - `conversation.input.model`（模型选择器，并自动禁用原生选择器）
  - `conversation.input.left`（积分 HUD）
- **纯前端 + 轻量宿主路由**：复用宿主 React runtime 与 CSS 变量；宿主端仅提供三个同源只读路由：
  - `/api/smart-models/preferences`（偏好读写）
  - `/api/smart-models/channel-status`（签到状态）
  - `/api/smart-models/agy-quota`（agy 窗口额度）
- **无外部二进制、无重量构建依赖**。

---

## ⚠️ 已知限制

- **多账号渠道首次查询较慢**：上游 `credits.balances` 是串行逐账号查询，单账号超时 30 秒。3 个账号的渠道最坏需 90 秒。已通过 60 秒结果缓存缓解（切换回来秒开），强制刷新仍会等待。
- **部分渠道无积分概念**：如 `Siliconflow`、官方 API 等按量扣费渠道，HUD 会自动隐藏或显示 `—`。

---

## 📄 License

MIT
