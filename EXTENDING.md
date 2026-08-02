# 玩法扩展指南

本项目把「通用猜谜引擎」与「具体玩法」完全解耦。想加一个新玩法（猜城市、猜电影、猜球星……）只需要做两件事：

1. 在 `src/games/` 下新建一个玩法文件；
2. 在 `src/games/index.js` 的注册表里登记一行。

## 架构回顾

- `src/engine.js` 里的 `GuessingGame` 是玩法无关的引擎，只关心五件事：
  - `dataset`：数据集（任意对象数组）
  - `pickTarget`：随机抽取目标
  - `judge`：裁判函数（大模型 / 启发式，由你决定）
  - `makeHints`：生成提示
  - `describe`：揭晓时的介绍
- `src/llm.js` 提供开箱即用的 **裁判** 与 **介绍** 大模型能力。
- `src/judge.js` 提供离线启发式裁判模板。

## 步骤 1：新建玩法文件

以「猜城市」为例，新建 `src/games/city.js`：

```js
'use strict';

const { GuessingGame } = require('../engine');
const { judgeWithLlm, introduceByPrompt, isLlmConfigured } = require('../llm');

// 1) 准备数据集：任意数组，元素含 name 等字段即可
const cities = [
  { name: '北京', country: '中国', population: 21890000, note: '中国的首都' },
  { name: '巴黎', country: '法国', population: 11000000, note: '塞纳河穿城而过' },
  // ... 更多城市
];

// 2) 复用通用裁判（它会把“秘密目标：X”写进 System Prompt）
const INTRO_PROMPT = (target) => [
  `请用中文介绍“${target.name}”这座城市的特色：地理位置、代表性景点、饮食文化、历史趣闻等。`,
  '输出 3~5 条要点，每条以“- ”开头。',
].join('\n');

function createCityGame(config) {
  const useLlm = config.judgeMode !== 'heuristic' && isLlmConfigured(config);

  const game = new GuessingGame({
    name: 'city',
    title: '城市海龟汤',
    dataset: cities,
    pickTarget: () => cities[Math.floor(Math.random() * cities.length)],
    judge: async (target, question) => {
      if (useLlm) return judgeWithLlm(config, target, question);
      return { type: 'invalid', reason: '请配置大模型以使用城市玩法' };
    },
    makeHints: (target) => [`这座城市位于${target.country}`, `这里的人口约 ${target.population}`],
    describe: async (target) => ({
      facts: `城市：${target.name}\n所在国家：${target.country}`,
      llmIntro: useLlm ? await introduceByPrompt(config, INTRO_PROMPT(target)) : '',
    }),
  });

  return { game, useLlm, datasetCount: cities.length };
}

module.exports = { createCityGame };
```

> 通用裁判把「秘密目标」写进 System Prompt，与玩法无关，直接复用即可。`judgeWithLlm` 已处理 `是/不是/无效/<WIN>` 的全部解析。

## 步骤 2：注册玩法

编辑 `src/games/index.js`：

```js
const registry = {
  country: require('./country.js'),
  city: require('./city.js'),   // 新增
};
```

## 步骤 3：启动

```bash
node src/index.js --game city
# 或写入配置
# config.json 中设置 "game": "city"
```

## 更深的定制

- **自定义数据集**：数据可以放在 `data/*.json`，用 `require('../../data/cities.json')` 引入。
- **自定义裁判**：若玩法有特殊判定逻辑（例如猜扑克牌需要比对点数），自己写一个 `judge` 函数即可，不用改引擎。
- **自定义提示**：若默认 4 条提示不够，扩展 `makeHints` 返回更多条目。
- **自定义介绍**：`describe` 可返回任意结构，CLI 会展示 `facts` 与 `llmIntro` 两个字段；如需更多字段，同步修改 `src/index.js` 的 `reveal()` 渲染部分。

## 清单（新玩法自查）

- [ ] `src/games/<name>.js`：导出 `create<Name>Game(config)`，返回 `{ game, useLlm, datasetCount }`
- [ ] 在 `src/games/index.js` 注册
- [ ] `config.json` 或命令行 `--game <name>` 启动验证
