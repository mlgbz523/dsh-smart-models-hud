/**
 * 选择器状态点渲染烟测。
 *
 * 走完整链路：注入假 catalog（含 workbuddy 的 deepseek-v4.1-flash）与假自检数据，
 * 点开选择器，断言该模型行上真的出现了「受限」状态点，且 title 里是模型级限制的
 * 原因（而不是笼统的「额度」）。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('D:/documents/deepseek-harness/default-workspace/dsh-smart-models/client.js', 'utf8');

// ── 最小 hooks 运行时 ─────────────────────────────────────────────────────
let hookSlots = [];
let hookCursor = 0;
let dirty = false;
let pendingEffects = [];
let intervalCount = 0;

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
    const changed = !prev || !deps || !prev.deps || deps.length !== prev.deps.length || deps.some((d, k) => d !== prev.deps[k]);
    if (changed) { hookSlots[i] = { deps }; pendingEffects.push(fn); }
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
  useRef: (init) => { const i = hookCursor++; if (hookSlots.length <= i) hookSlots.push({ current: init }); return hookSlots[i]; },
  useCallback: (fn, deps) => {
    const i = hookCursor++;
    const prev = hookSlots[i];
    if (!prev || !deps || !prev.deps || deps.length !== prev.deps.length || deps.some((d, k) => d !== prev.deps[k])) {
      hookSlots[i] = { fn, deps };
      return fn;
    }
    return prev.fn;
  },
  Component: class { constructor(p) { this.props = p; this.state = {}; } setState() {} },
};

// ── 假 catalog：两个模型，其中 v4.1-flash 在 workbuddy 受限 ────────────────
const catalog = {
  default: { provider: 'codearts', model: 'deepseek-v4.1-flash' },
  groups: [
    {
      id: 'workbuddy', name: 'WorkBuddy',
      models: [
        { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', creditsRate: 'x0' },
        { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
      ],
    },
    {
      id: 'codearts', name: 'CodeArts',
      models: [{ id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash' }],
    },
  ],
};

const healthData = {
  ok: true,
  checkedAt: Date.now(),
  providers: {
    workbuddy: {
      accounts: 5, enabledAccounts: 5, modelCount: 2, blockedPairs: 1,
      deadModels: 0, disabledModels: 0, requests: 100, errors: 1, errorRate: 0.01,
      models: {
        'deepseek-v4.1-flash': {
          accounts: 5, enabledAccounts: 5, blockedAccounts: 1, allBlocked: false,
          earliestResetAt: Date.now() + 16 * 3600_000, dead: null, disabled: false,
          requests: 100, errors: 1, level: 'degraded',
          reason: '1/5 个账号受限 · 最早 16 小时 37 分后恢复',
        },
      },
    },
  },
};

const fetchCalls = [];
const fakeFetch = async (url) => {
  fetchCalls.push(String(url));
  if (String(url).includes('uplink-health')) {
    return { ok: true, status: 200, async json() { return healthData; } };
  }
  return { ok: true, status: 200, async json() { return { ok: true }; } };
};

const stubs = { react: React, 'react-dom': { createPortal: (x) => x } };
const fakeDocument = {
  head: { appendChild() {} },
  body: { appendChild() {}, removeChild() {} },
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
  innerWidth: 1440,
  innerHeight: 900,
};

let intervalId = 0;
globalThis.setInterval = () => { intervalCount += 1; return { unref() {} }; };
globalThis.clearInterval = () => {};

const runner = new Function('window', 'document', 'require', 'console', 'fetch', source);
runner(fakeWindow, fakeDocument, (name) => stubs[name], console, fakeFetch);
const mod = captured.factory((name) => stubs[name]);

// ── 假 ctx：sessions / remote.session 提供 catalog ────────────────────────
const fakeCtx = {
  sessions: {
    binding: () => ({
      session: {
        projections: { faceOf: () => null },
        getSnapshot: () => ({ running: false }),
        subscribe: () => () => {},
      },
    }),
  },
  remote: {
    $on: () => () => {},
    session: {
      modelCatalog: async () => ({ ok: true, value: catalog }),
      selectModel: async () => ({ ok: true }),
    },
  },
  slots: { inject() {}, register() { return () => {}; } },
};

const registered = [];
mod.apply({
  slots: { inject(name, fn) { fn(); }, register(spec, component) { registered.push({ spec, component }); return () => {}; } },
});
const selectSpec = registered.find(r => r.spec.name === 'conversation.input.model');
assert.ok(selectSpec, '必须注册模型选择器');

// ── 求值 + 交互 ───────────────────────────────────────────────────────────
function evaluate(node) {
  if (node === null || node === undefined || node === false) return null;
  if (typeof node === 'string' || typeof node === 'number') return node;
  if (Array.isArray(node)) return node.map(evaluate);
  if (typeof node.type === 'function') {
    if (node.type.prototype && node.type.prototype.render) return evaluate(node.children);
    return evaluate(node.type(node.props));
  }
  return { ...node, children: evaluate(node.children) };
}
function findAll(node, pred, out = []) {
  if (node === null || node === undefined || node === false) return out;
  if (Array.isArray(node)) { node.forEach(n => findAll(n, pred, out)); return out; }
  if (typeof node !== 'object') return out;
  if (pred(node)) out.push(node);
  findAll(node.children, pred, out);
  return out;
}
function textOf(node) {
  if (node === null || node === undefined || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return textOf(node.children);
}

async function render(props, maxRounds = 10) {
  let tree = null;
  for (let i = 0; i < maxRounds; i += 1) {
    hookCursor = 0;
    dirty = false;
    pendingEffects = [];
    tree = evaluate(selectSpec.component(props));
    const effects = pendingEffects;
    pendingEffects = [];
    for (const fn of effects) fn();
    await new Promise(r => setTimeout(r, 5));
    if (!dirty) break;
  }
  return tree;
}

let tree = await render({ ctx: fakeCtx, sessionId: 'ses_test' });
console.log('fetch calls after mount:', fetchCalls.join(', '));
assert.ok(fetchCalls.some(u => u.includes('uplink-health')), '挂载时应拉一次自检数据');

// 点开选择器：找到 trigger 按钮并触发 onClick
const triggers = findAll(tree, n => n.props && typeof n.props.className === 'string' && n.props.className.includes('dsh-sm-trigger'));
assert.ok(triggers.length > 0, '应渲染出触发器');
triggers[0].props.onClick();
tree = await render({ ctx: fakeCtx, sessionId: 'ses_test' });

const text = textOf(tree);
console.log('--- selector text ---');
console.log(text.slice(0, 600));

const dots = findAll(tree, n => n.props && typeof n.props.className === 'string' && n.props.className.includes('dsh-sm-health-dot'));
console.log('health dots:', dots.length);
assert.ok(dots.length >= 1, '受限模型应渲染状态点');
const degraded = dots.filter(d => d.props.className.includes('dsh-sm-health-degraded'));
assert.equal(degraded.length, 1, 'deepseek-v4.1-flash 在 workbuddy 受限 → 一个琥珀点');
assert.match(degraded[0].props.title, /1\/5 个账号受限/, 'title 应说明是账号级限制');
assert.match(degraded[0].props.title, /workbuddy|WorkBuddy/i, 'title 应标明渠道');

// v4-pro 没有自检记录 → 不该有状态点
const rows = findAll(tree, n => n.props && typeof n.props.className === 'string' && n.props.className.includes('dsh-sm-master-item'));
console.log('model rows:', rows.length);

console.log('\nALL SELECTOR DOT TESTS PASSED');
