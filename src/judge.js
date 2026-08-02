'use strict';

/**
 * 离线启发式裁判。
 * 在未配置大模型（或大模型不可用）时兜底，让游戏开箱即玩。
 * 能力有限：仅支持「猜国名 / 大洲 / 首都」这几类问题的判定，
 * 其余问题会返回 invalid 并提示配置大模型以获得完整体验。
 */

const CONTINENTS = ['亚洲', '非洲', '欧洲', '北美洲', '南美洲', '大洋洲'];

const GUESS_RE = /^(?:是不是|答案是|就是|这个国家是|应该是|会不会是|难道是|我猜是)\s*([^?？。!！吗]*)\s*[?？。!！吗]*$/;

function findNameContains(countries, candidate) {
  let best = null;
  let bestLen = 0;
  for (const c of countries) {
    if (candidate.includes(c.name) && c.name.length > bestLen) {
      best = c;
      bestLen = c.name.length;
    }
  }
  return best;
}

/** 根据国家数据库构建一个启发式裁判 */
function buildHeuristicJudge(countries) {
  const capitals = new Set(countries.map((c) => c.capital));
  const nameMap = new Map();
  for (const c of countries) {
    nameMap.set(c.name, c);
    nameMap.set(c.en.toLowerCase(), c);
  }

  return function heuristicJudge(target, question) {
    const q = (question || '').trim();
    if (!q) return { type: 'invalid', reason: '问题不能为空' };

    // 1) 明显的猜测句式："答案是X吗？"
    const m = q.match(GUESS_RE);
    if (m && m[1] && m[1].trim()) {
      const cand = m[1].trim();
      const hit = nameMap.get(cand) || nameMap.get(cand.toLowerCase()) || findNameContains(countries, cand);
      if (hit) {
        return hit.name === target.name ? { type: 'win' } : { type: 'no' };
      }
      return { type: 'invalid', reason: '离线模式无法识别你猜的国家名' };
    }

    // 2) 直接输入国名
    const exact = nameMap.get(q) || nameMap.get(q.replace(/[?？。.!！\s]/g, '').toLowerCase());
    if (exact) {
      return exact.name === target.name ? { type: 'win' } : { type: 'no' };
    }

    // 3) 大洲
    for (const c of CONTINENTS) {
      if (q.includes(c)) return { type: target.continent === c ? 'yes' : 'no' };
    }

    // 4) 首都
    if (q.includes('首都')) {
      for (const city of capitals) {
        if (q.includes(city)) return { type: target.capital === city ? 'yes' : 'no' };
      }
      return { type: 'invalid', reason: '离线模式：无法识别的城市名' };
    }

    // 5) 其他问题离线模式回答不了
    return { type: 'invalid', reason: '离线启发式裁判无法判断该问题，请配置大模型获得完整体验' };
  };
}

module.exports = { buildHeuristicJudge, CONTINENTS };
