'use strict';

/**
 * 数据校验脚本：npm run check
 * 检查 data/countries.json 的完整性（字段、重复、大洲统计等）。
 */
const countries = require('../data/countries.json');

const errors = [];
const warnings = [];
const seenNames = new Map();
const continents = {};

// 繁体字（简体中文导言中不应大量出现；官方名称括号内的形同字除外，仅作提示）
const TRAD_RE = /[國臺灣裡話說亞區東廣業與為個東島種離學關時問現職見開議員對說國語體廣]/;

for (const c of countries) {
  for (const field of ['name', 'en', 'capital', 'continent']) {
    if (!c[field] || typeof c[field] !== 'string') {
      errors.push(`${c.name || '?'}: 缺少字段 ${field}`);
    }
  }
  if (typeof c.population !== 'number' || c.population <= 0) {
    errors.push(`${c.name}: population 非法`);
  }
  if (typeof c.area !== 'number' || c.area <= 0) {
    errors.push(`${c.name}: area 非法`);
  }
  if (seenNames.has(c.name)) {
    errors.push(`重复的国名：${c.name}（${seenNames.get(c.name)} 与 ${c.en}）`);
  }
  seenNames.set(c.name, c.en);
  continents[c.continent] = (continents[c.continent] || 0) + 1;

  // 介绍（intro）质量检查
  const intro = c.intro || '';
  if (!intro.trim()) {
    errors.push(`${c.name}: 缺少 intro（维基导言）`);
  } else {
    if (intro.length < 40) warnings.push(`${c.name}: intro 过短（${intro.length} 字，疑似消歧义页/占位文本）`);
    const cjk = (intro.match(/[\u4e00-\u9fff]/g) || []).length;
    if (cjk < 15) warnings.push(`${c.name}: intro 中文占比过低（疑似英文兜底）`);
    if (/[……]+$/.test(intro)) warnings.push(`${c.name}: intro 以省略号结尾（疑似被 API 截断）`);
    const tradCount = (intro.match(TRAD_RE) || []).length;
    if (tradCount > 10) warnings.push(`${c.name}: intro 含 ${tradCount} 个繁体字（应为简体）`);
  }
}

if (errors.length) {
  console.error(`发现 ${errors.length} 个问题：`);
  errors.forEach((e) => console.error('  - ' + e));
  process.exit(1);
}

if (warnings.length) {
  console.warn(`发现 ${warnings.length} 条提示（不影响运行，建议修复）：`);
  warnings.forEach((w) => console.warn('  - ' + w));
}

console.log(`数据校验通过：共 ${countries.length} 个国家。`);
console.log('各大洲数量：');
Object.entries(continents).forEach(([c, n]) => console.log(`  ${c}: ${n}`));
console.log('\n提示：中国官方承认的主权国家通常为 193 个联合国会员国 + 巴勒斯坦、梵蒂冈、库克群岛、纽埃，共 197 个。');
