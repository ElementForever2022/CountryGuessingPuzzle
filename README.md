# 国家海龟汤（Country Puzzle）

一款基于 Node.js + Electron 的 AI 猜谜桌面应用：程序随机抽取一个**中国官方承认的主权国家**，你通过不断问“是/不是”的问题缩小范围、最终猜出它。猜出或放弃后，应用会为你介绍这个国家的特征，边玩边学地理知识。

> “海龟汤”（Situation Puzzle）指一种通过提问逐步还原谜底的推理游戏；本项目把它和国家地理结合在了一起。

---

## 功能特性

- **Electron 桌面 GUI**：聊天式界面，底部输入框直接提问；右上角齿轮图标进入设置。
- **197 个主权国家数据库**：内置中国官方承认的 193 个联合国会员国 + 巴勒斯坦、梵蒂冈、库克群岛、纽埃，含中文名、英文名、首都、大洲、人口、面积。
- **随机出题**：每局从数据库中随机抽取一个国家。
- **大模型裁判**：大模型只回答 `是` / `不是` / `无效`，严格不泄露答案；模糊问题（如“同时横跨南北半球”）按事实如实回答；非法问题会被指出并提示原因。
- **兼容推理（thinking）模型**：自动剥离模型的 `<think>…</think>` 思考块与 `<answer>…</answer>` 结构标签，只解析最终答案，思考过程绝不展示（避免泄露题目），`reasoning_content` 也不会被打印。
- **免费 + 付费双接口**：内置多个 Provider，既有免费方案（本地 Ollama、智谱 GLM-4-Flash、硅基流动免费模型），也有付费方案（DeepSeek、OpenAI、Kimi 等），还可自定义任意 OpenAI 兼容网关；设置里可直接“测试连接”。
- **离线兜底**：不配置任何 API 也能玩——内置启发式裁判，可判定“国名猜测 / 大洲 / 首都”类问题。
- **揭晓科普**：猜中或放弃后展示国家档案卡 + 历史提问记录 + 国旗/首都/地标图片，并可让大模型生成趣味介绍。
- **保留 CLI**：`npm run start:cli` 仍可运行原来的命令行版本。
- **可扩展架构**：通用游戏引擎与具体玩法解耦，可轻松新增“猜城市 / 猜电影 / 猜球星”等新玩法（见 [EXTENDING.md](EXTENDING.md)）。

---

## 快速开始

要求：**Node.js >= 18**。

```bash
# 1) 安装依赖（会安装 Electron）
npm install

# 2) 启动 GUI（自动打开游戏窗口）
npm start
```

> 首次运行会打开“国家海龟汤”窗口。未配置任何 API 时自动进入离线启发式裁判模式，开箱即玩。

### 演示

```
┌──────────────────────────────────────────────────────────┐
│  国家海龟汤          裁判：zhipu / glm-4.7-flash     [⚙]   │
├──────────────────────────────────────────────────────────┤
│  欢迎来到国家海龟汤！程序已从 197 个主权国家中随机抽取…   │
│                                                          │
│  [你] 这个国家在亚洲吗？                                  │
│  [裁判] 不是                                              │
│  [你] 这个国家在欧洲吗？                                  │
│  [裁判] 是                                                │
│  [你] 答案是法国吗？                                      │
│  [裁判] 是！你猜对了！                                    │
├──────────────────────────────────────────────────────────┤
│  [提示] [放弃] [新一局]  [ 输入问题…            ] [发送] │
└──────────────────────────────────────────────────────────┘
```

### GUI 操作

| 操作 | 说明 |
| --- | --- |
| 底部输入框 | 提出“是/不是”判断题，或直接猜“答案是法国吗？”，回车或点“发送” |
| 提示 | 获取一条关于神秘国家的提示（最多 4 条） |
| 放弃 | 结束本局并揭晓答案 |
| 新一局 | 重新随机抽取一个国家 |
| 齿轮图标 ⚙ | 打开设置：接口服务（选择题）、API Key、接口地址（默认/自定义）、模型（选择题或自定义）、裁判模式、配色主题，并可测试连接 |

---

## 配置方式（config.json）

项目**只使用 `config.json` 一个配置文件**（位于项目根目录，含 API Key，已被 `.gitignore` 排除）。GUI 的设置弹窗保存时即写入该文件。

- 模板见 [config.example.json](config.example.json)，可复制为 `config.json` 后手动填写。
- 配置优先级（从高到低）：**命令行参数 > config.json > 默认值**，每个键取第一个非空值。
- 配置在 GUI 中保存后立即生效，并自动重开一局。

```bash
# 复制模板开始配置
copy config.example.json config.json
```

### 配置项

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `game` | `country` | 当前玩法 |
| `provider` | `ollama` | 大模型接口，见下表 |
| `apiKey` | 空 | 付费/免费在线接口的 Key |
| `apiBase` | 空 | 覆盖接口地址（如自定义网关） |
| `model` | 空 | 覆盖模型名 |
| `judgeMode` | `auto` | `auto`：有 API 用大模型，否则离线；`llm`：强制大模型；`heuristic`：强制离线 |
| `theme` | `default` | 配色主题：`default`（深海蓝）/`forest`（森林绿）/`sakura`（樱花粉）/`aurora`（极光紫）/`dawn`（晨曦） |
| `temperature` | `0` | 裁判输出温度（建议保持 0） |
| `maxTokens` | `512` | 单次输出上限 |
| `timeoutMs` | `60000` | 请求超时（毫秒） |

### Provider 一览

| provider | 接口类型 | 是否免费 | 说明 |
| --- | --- | --- | --- |
| `ollama` | 本地模型 | 免费 | 无需 Key，需本地安装并启动 [Ollama](https://ollama.com)，如 `qwen2.5:7b`（默认） |
| `zhipu` | 智谱开放平台 | 免费 | `glm-4.7-flash` 免费，[注册获取 Key](https://open.bigmodel.cn/) |
| `siliconflow` | 硅基流动 | 部分免费 | 有免费模型（如 `Qwen/Qwen2.5-7B-Instruct`），[注册获取 Key](https://siliconflow.cn/) |
| `deepseek` | DeepSeek 官方 | 付费（低价） | `deepseek-v4-flash` / `deepseek-v4-pro`，[获取 Key](https://platform.deepseek.com/) |
| `openai` | OpenAI | 付费 | 如 `gpt-4o-mini` |
| `moonshot` | 月之暗面 Kimi | 付费 | 如 `moonshot-v1-8k` |
| `custom` | 自定义 | 视你的网关 | 任意 OpenAI 兼容接口（支持中转/代理/内网模型） |

> 免费模型列表会变动，请以各平台官网最新信息为准。

### 配置示例

`config.json`：

```json
{
  "provider": "zhipu",
  "apiKey": "your-key",
  "model": "glm-4.7-flash",
  "judgeMode": "auto",
  "theme": "default"
}
```

> GUI 设置弹窗中，接口服务、模型、地址、主题均为**选择题**（模型与地址也支持“自定义”输入），API Key 手动填写；以上字段即改即用。

### 连通性自检

```bash
npm run test:llm
# 或带参数
node scripts/testLlm.js --provider deepseek --api-key sk-xxxx --model deepseek-v4-flash
```

---

## 第三方依赖说明

本项目引入的第三方依赖：

| 依赖 | 类型 | 用途 |
| --- | --- | --- |
| `electron` | devDependencies | 桌面 GUI 运行环境（唯一第三方运行时依赖） |

其余全部为 Node.js 内置能力（`fetch` / `http` / `readline` / `fs` 等），核心游戏逻辑零依赖、可在纯 Node 下独立运行。

---

## 项目结构

```
CountryLTP/
├── package.json
├── README.md
├── EXTENDING.md          # 玩法扩展指南
├── config.example.json   # 配置文件模板（复制为 config.json）
├── data/
│   └── countries.json    # 197 个主权国家数据库
├── scripts/
│   ├── checkData.js      # 数据校验：npm run check
│   └── testLlm.js        # 大模型连通性测试：npm run test:llm
└── src/
    ├── gui/              # Electron GUI
    │   ├── main.js       # 主进程：窗口 + IPC（游戏/配置/连接测试）
    │   ├── preload.js    # 安全桥接，暴露 window.api
    │   └── renderer/
    │       ├── index.html
    │       ├── styles.css
    │       └── app.js    # 聊天界面 + 设置弹窗逻辑
    ├── index.js          # CLI 入口（npm run start:cli）
    ├── config.js         # 配置加载与保存（仅 config.json）
    ├── engine.js         # 通用猜谜引擎（玩法无关，可复用）
    ├── llm.js            # 大模型客户端（多 Provider / 裁判 / 介绍）
    ├── judge.js          # 离线启发式裁判（兜底）
    └── games/
        ├── index.js      # 玩法注册表
        └── country.js    # “国家海龟汤”具体玩法
```

---

## 设计原理

1. **数据库**：`data/countries.json` 内置中国官方承认的主权国家（193 个联合国会员国 + 巴勒斯坦、梵蒂冈、库克群岛、纽埃，共 197 个），带基础地理数据。
2. **随机出题**：`pickTarget` 用 `Math.random()` 从数据库随机抽取一个目标。
3. **大模型判定**：`judgeWithLlm` 用系统提示词约束模型——目标国家写死在 System Prompt 中，模型只允许输出 `是` / `不是` / `无效：原因`，猜测类问题猜中时输出 `是<WIN>`，且严禁泄露国名。解析器（`parseJudgeReply`）将回复结构化。
4. **非法问题**：模型被要求把“多问合一、表述含糊、与地理无关、开放性提问”判为 `无效` 并说明原因。
5. **揭晓科普**：结束后展示国家档案卡（首都/大洲/人口/面积，来自本地数据，无需 API）、国旗/首都/地标图片（来自 `assets/images/`，已随项目内置），并可调用大模型生成趣味介绍。若缺少某张图片，揭晓卡会自动隐藏对应位置，不影响游玩。
6. **GUI 通信**：渲染进程通过 `preload.js` 暴露的 `window.api`（contextIsolation 安全桥接）调用主进程 IPC，主进程复用同一套引擎与 LLM 逻辑，配置保存即写 `config.json` 并重建玩法实例。

---

## 其他

- **数据校验**：`npm run check`（或 `node scripts/checkData.js`）检查国家数据库完整性。
- **重新下载图片**：`npm run download:images`（或 `node scripts/downloadImages.js`）可重新/续传 `assets/images/` 下的国旗、首都、地标图片（国旗来自 flagcdn，首都/地标来自维基百科缩略图），并回写 `data/countries.json` 的 `image` 字段；支持 `--only flag|capital|landmark`、`--start/--limit` 分批、`--sync` 按已有文件回写等参数。
- **扩展新玩法**：见 [EXTENDING.md](EXTENDING.md)（猜城市 / 猜电影 / 猜球星……几分钟搞定）。
- **数据说明**：人口与面积均为近似值，仅用于游戏与科普，不构成权威数据。

---

## License

[MIT](LICENSE)
