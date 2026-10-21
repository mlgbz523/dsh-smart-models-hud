/**
 * 渲染烟测：用一个极小的 hooks 运行时把「上行自检」设置页真正渲染出来。
 *
 * 这不是浏览器验收，但能挡住「一进页面就白屏 / 明细表渲染不出来」这类低级错误：
 * 它执行组件函数、跑 effect、等异步 load 完成、再重渲染，最后对渲染出的文本断言。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const file = 'D:/documents/deepseek-harness/default-workspace/dsh-smart-models/client.js';
const source = fs.readFileSync(file, 'utf8');

// ── 最小 hooks 运行时 ─────────────────────────────────────────────────────
let hookSlots = [];
let hookCursor = 0;
let dirty = false;
let pendingEffects = [];

const h = (type, props, ...children) => {
  const flat = children.flat(Infinity).filter(c => c !== null && c !== undefined && c !== false);
  return { type, props: props || {}, children: flat };
};

const React = {
  createElement: h,
  useState: (init) => {
    const i = hookCursor++;
    if (hookSlots.length <= i) hookSlots.push(typeof init === 'function' ? init() : init);
    return [hookSlots[i], (next) => {
      const value = typeof next === 'function' ? next(hookSlots[i]) : next;
      if (value !== hookSlots[i]) { hookSlots[i] = value; dirty = true; }
    }];
  },
  useEffect: (fn, deps) => {
    const i = hookCursor++;
    const prev = hookSlots[i];
    const changed = !prev || !deps || !prev.deps || deps.some((d, k) => d !== prev.deps[k]);
    if (changed) {
      hookSlots[i] = { deps };
      pendingEffects.push(fn);
    }
  },
  // ⚠️ 真实 React 的 useMemo 会占用一个 hook 槽位；替身若只是 `(fn) => fn()`，
  //    组件里每多一个 useMemo，它之后的所有 useState/useCallback 槽位就整体错位，
  //    读到别人的状态（表现为「明明该展开却是折叠」这类幽灵 bug）。
  useMemo: (fn, deps) => {
    const i = hookCursor++;
    const prev = hookSlots[i];
    if (!prev || !deps || !prev.deps || deps.length !== prev.deps.length || deps.some((d, k) => d !== prev.deps[k])) {
      hookSlots[i] = { value: fn(), deps };
      return hookSlots[i].value;
    }
    return prev.value;
  },
  useRef: (init) => {
    const i = hookCursor++;
    if (hookSlots.length <= i) hookSlots.push({ current: init });
    return hookSlots[i];
  },
  // 必须按 deps 记忆：否则每次渲染都返回新函数，依赖它的 useEffect 会无限重跑
  // （真实 React 不会，这是假运行时最容易骗自己的地方）。
  useCallback: (fn, deps) => {
    const i = hookCursor++;
    const prev = hookSlots[i];
    if (!prev || !deps || !prev.deps || deps.length !== prev.deps.length || deps.some((d, k) => d !== prev.deps[k])) {
      hookSlots[i] = { fn, deps };
      return fn;
    }
    return prev.fn;
  },
  Component: class {
    constructor(props) { this.props = props; this.state = {}; }
    setState(next) { this.state = { ...this.state, ...(typeof next === 'function' ? next(this.state) : next) }; }
  },
};

// ── 真实形状的自检数据（取自本机实测） ────────────────────────────────────
const realData = {
  ok: true,
  checkedAt: Date.now(),
  providers: {
    workbuddy: {
      accounts: 5, enabledAccounts: 5, modelCount: 4, blockedPairs: 1,
      deadModels: 0, disabledModels: 0, requests: 2810, errors: 19, errorRate: 19 / 2810,
      models: {
        'deepseek-v4.1-flash': {
          accounts: 5, enabledAccounts: 5, blockedAccounts: 1, allBlocked: false,
          earliestResetAt: Date.now() + 16 * 3600_000, dead: null, disabled: false,
          requests: 2810, errors: 19, level: 'degraded',
          reason: '1/5 个账号受限 · 最早 16 小时 37 分后恢复',
        },
      },
    },
    codearts: {
      accounts: 2, enabledAccounts: 2, modelCount: 3, blockedPairs: 0,
      deadModels: 0, disabledModels: 0, requests: 96, errors: 15, errorRate: 15 / 96,
      models: {
        'deepseek-v4-pro': {
          accounts: 2, enabledAccounts: 2, blockedAccounts: 0, allBlocked: false,
          earliestResetAt: null, dead: null, disabled: false,
          requests: 3, errors: 3, level: 'degraded', reason: '失败率 100%（3/3）',
        },
        'deepseek-v4.1-flash': {
          accounts: 2, enabledAccounts: 2, blockedAccounts: 0, allBlocked: false,
          earliestResetAt: null, dead: null, disabled: false,
          requests: 93, errors: 12, level: 'ok', reason: '',
        },
      },
    },
  },
  checkin: { enabled: true, lastDate: '2026-10-19', lastAt: Date.now(), isToday: false, result: '8 个渠道：10 个账号领取成功（+3100积分）' },
};

const fetchCalls = [];
const fakeFetch = async (url) => {
  fetchCalls.push(String(url));
  return {
    ok: true,
    status: 200,
    async json() { return realData; },
  };
};

const stubs = { react: React, 'react-dom': { createPortal: (x) => x } };
const fakeDocument = {
  head: { appendChild() {} },
  createElement: () => ({ setAttribute() {}, appendChild() {}, style: {} }),
  getElementById: () => null,
  querySelector: () => null,
  addEventListener() {},
  removeEventListener() {},
};
let captured = null;
const fakeWindow = {
  __ModuleLoader__: { load({ id, factory }) { captured = { id, factory }; } },
  addEventListener() {},
  removeEventListener() {},
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  location: { href: 'http://localhost/' },
};

// ⚠️ 页面里有一个每秒倒计时的 setInterval。真实浏览器里它是页面生命周期的一部分，
// 但在 node 里会让进程永远不退出 —— 测试中替换为 no-op，并记录被注册的定时器数量。
let intervalCount = 0;
const realSetInterval = globalThis.setInterval;
const realClearInterval = globalThis.clearInterval;
globalThis.setInterval = () => { intervalCount += 1; return { unref() {} }; };
globalThis.clearInterval = () => {};

const runner = new Function('window', 'document', 'require', 'console', 'fetch', source);
runner(fakeWindow, fakeDocument, (name) => stubs[name], console, fakeFetch);

const mod = captured.factory((name) => stubs[name]);

// ── 拿到组件并渲染 ────────────────────────────────────────────────────────
const registered = [];
mod.apply({
  slots: {
    inject(name, fn) { fn(); },
    register(spec, component) { registered.push({ spec, component }); return () => {}; },
  },
});
// 三分区已合并：现在只有一个 'smart-models' 分区，内部标签页切换
const uplinkSpec = registered.find(r => r.spec.id === 'smart-models');
assert.ok(uplinkSpec, '必须注册「Smart Models」合并分区');

// 递归求值元素树（遇到函数组件就调用它）
function evaluate(node) {
  if (node === null || node === undefined || node === false) return null;
  if (typeof node === 'string' || typeof node === 'number') return node;
  if (Array.isArray(node)) return node.map(evaluate);
  if (typeof node.type === 'function') {
    // 错误边界是 class：直接渲染它的 children（本测试不模拟异常）
    if (node.type.prototype && node.type.prototype.render) {
      return evaluate(node.children);
    }
    return evaluate(node.type({ ...node.props, ...(node.children.length === 1 ? {} : {}) }));
  }
  return { ...node, children: evaluate(node.children) };
}

function textOf(node) {
  if (node === null || node === undefined || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return textOf(node.children);
}

function findAll(node, pred, out = []) {
  if (node === null || node === undefined || node === false) return out;
  if (Array.isArray(node)) { node.forEach(n => findAll(n, pred, out)); return out; }
  if (typeof node !== 'object') return out;
  if (pred(node)) out.push(node);
  findAll(node.children, pred, out);
  return out;
}

async function renderUntilStable(component, props, maxRounds = 8) {
  let tree = null;
  for (let round = 0; round < maxRounds; round += 1) {
    hookCursor = 0;
    dirty = false;
    pendingEffects = [];
    tree = evaluate(component(props));
    // 跑 effect
    const effects = pendingEffects;
    pendingEffects = [];
    for (const fn of effects) { fn(); }
    // 等异步状态更新落地
    await new Promise(r => setTimeout(r, 5));
    if (!dirty && effects.length === 0) break;
  }
  return tree;
}

// 1) 默认渲染合并分区（默认 tab：用量统计）
let tree = await renderUntilStable(uplinkSpec.component, { ctx: {} });

// 合并分区必须先渲染出标签栏
// token 精确匹配：'dsh-sm-settings-tabs' 容器也 includes 'dsh-sm-settings-tab'，会多数一个
const tabButtons = findAll(tree, n => n.props
  && typeof n.props.className === 'string'
  && n.props.className.split(/\s+/).includes('dsh-sm-settings-tab'));
assert.equal(tabButtons.length, 4, '合并分区应有 4 个标签页（用量统计/上行自检/渠道排序/倍率覆盖）');
assert.ok(tabButtons.some(b => textOf(b) === '倍率覆盖'), '必须有「倍率覆盖」标签');
assert.ok(tabButtons.some(b => textOf(b) === '用量统计' && b.props.className.includes('active')), '默认激活「用量统计」');

// 2) 切到「上行自检」标签再断言（原测试的断言对象在第二个标签页里）
const uplinkTab = tabButtons.find(b => textOf(b) === '上行自检');
assert.ok(uplinkTab, '应存在「上行自检」标签');
uplinkTab.props.onClick();
// 模拟真实 React 的 unmount/remount：换标签 = 同位置换组件类型，
// 子页面的 hook 槽位必须重置，否则残留上一个标签（用量统计）的状态，
// 上行自检页会读到别人的 state（probe.results 之类读出 undefined）。
// 槽位 0 是标签页自身的 activeTab，保留；1..N 全部清掉。
hookSlots = hookSlots.slice(0, 1);
tree = await renderUntilStable(uplinkSpec.component, { ctx: {} });
const text = textOf(tree);

console.log('fetch calls:', fetchCalls.join(', '));
console.log('rendered text length:', text.length);
console.log('--- preview ---');
console.log(text.slice(0, 900));
console.log('--- /preview ---');

assert.match(text, /上行自检/, '标题');
assert.match(text, /模型级限制/, '卡片 1');
assert.match(text, /渠道与账号/, '卡片 2');
assert.match(text, /观测到的请求/, '卡片 3');
assert.match(text, /按渠道/, '渠道表');
assert.match(text, /需要留意的模型/, '明细表');
assert.match(text, /deepseek-v4-pro/, '明细里应出现 v4-pro');
assert.match(text, /失败率 100%/, '明细里应出现失败率原因');
assert.match(text, /探活/, '应有探活按钮');
assert.match(text, /重置限流/, '受限渠道应有重置按钮');
// 倒计时按当前时间实时算，fixture 写的是 +16h，渲染时可能已过几分钟
assert.match(text, /\d+ 小时( \d+ 分)?后恢复/, '倒计时应渲染');
// v4.1-flash 在 codearts 是 ok，不该出现在明细表
assert.ok(!text.includes('codeartsdeepseek-v4.1-flash'), 'ok 模型不应进明细表');

globalThis.setInterval = realSetInterval;
globalThis.clearInterval = realClearInterval;
console.log('intervals registered (倒计时):', intervalCount);
assert.ok(intervalCount >= 1, '倒计时应注册一个每秒刷新的定时器');

console.log('\nALL RENDER SMOKE TESTS PASSED');
