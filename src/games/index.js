'use strict';

/**
 * 玩法注册表。
 * 新增玩法只需在 games/ 下新建一个文件并在这里注册，
 * 然后通过 --game <name> 启动。详见 EXTENDING.md。
 */
const registry = {
  country: require('./country.js'),
};

function listGames() {
  return Object.keys(registry);
}

function create(name, config) {
  const mod = registry[name];
  if (!mod) {
    throw new Error(`未知玩法 “${name}”，可用玩法：${listGames().join(', ')}`);
  }
  return mod.createCountryGame ? mod.createCountryGame(config) : mod.create(config);
}

module.exports = { registry, listGames, create };
