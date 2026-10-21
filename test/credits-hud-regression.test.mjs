/**
 * CreditsHud 回归烟测：callPack 被抽成模块级 callChannelPack 之后，
 * HUD 必须仍然走同一条链路取余额、渲染胶囊、并在 RPC 不可用时静默隐藏。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('D:/documents/deepseek-harness/default-workspace/dsh-smart-models/client.js', 'utf8');

let hookSlots = []; let hookCursor = 0; let dirty = false; let pendingEffects = [];
const h = (type, props, ...children) => ({
  type, props: props || {},
  children: children.flat(Infinity).filter(c => c !== null && c !== undefined && c !== false),
});
const React = {
  createElement: h,
  useState: (init) => {
    const i = hookCursor++;
    if (hookSlots.length <= i) hookSlots.push(typeof init === 'function' ? init() : init);
    return [hookSlots[i], (n) => { const v = typeof n === 'function' ? n(hookSlots[i]) : n; if (v !== hookSlots[i]) { hookSlots[i] = v; dirty = true; } }];
  },
  useEffect: (fn, deps) => {
    const i = hookCursor++;
    const prev = hookSlots[i];
    const changed = !prev || !deps || !prev.deps || deps.length !== prev.deps.length || deps.some((d, k) => d !== prev.deps[k]);
    if (changed) { hookSlots[i] = { deps }; pendingEffects.push(fn); }
  },
  useMemo: (fn) => fn(),
  useRef: (init) => { const i = hookCursor++; if (hookSlots.length <= i) hookSlots.push({ current: init }); return hookSlots[i]; },
  useCallback: (fn, deps) => {
    const i = hookCursor++;
    const prev = hookSlots[i];
    if (!prev || !deps || !prev.deps || deps.length !== prev.deps.length || deps.some((d, k) => d !== prev.deps[k])) {
      hookSlots[i] = { fn, deps }; return fn;
    }
    return prev.fn;
  },
  Component: class { constructor(p) { this.props = p; this.state = {}; } setState() {} },
};

const rpcCalls = [];
const fakeConnection = {
  rpc: {
    async call(_scope, service, payload) {
      rpcCalls.push({ service, method: payload.method });
      if (payload.method === 'credits.balances') {
        return { ok: true, value: { accounts: [
          { accountId: 'codearts-a', nickname: 'A', balance: { total: 1360, packages: [{ unit: 'credit', remaining: 1360 }] } },
        ] } };
      }
      return { ok: true, value: {} };
    },
  },
};

const fakeFetch = async () => ({ ok: true, status: 200, async json() { return { ok: true, providers: {} }; } });
const stubs = { react: React, 'react-dom': { createPortal: (x) => x } };
const fakeDocument = {
  head: { appendChild() {} }, body: { appendChild() {}, removeChild() {} },
  createElement: () => ({ setAttribute() {}, appendChild() {}, style: {} }),
  getElementById: () => null, querySelector: () => null,
  addEventListener() {}, removeEventListener() {},
};
let captured = null;
const fakeWindow = {
  __ModuleLoader__: { load({ factory }) { captured = { factory }; } },
  addEventListener() {}, removeEventListener() {},
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  location: { href: 'http://localhost/' }, innerWidth: 1440, innerHeight: 900,
};
globalThis.setInterval = () => ({ unref() {} });
globalThis.clearInterval = () => {};

const runner = new Function('window', 'document', 'require', 'console', 'fetch', source);
runner(fakeWindow, fakeDocument, (n) => stubs[n], console, fakeFetch);
const mod = captured.factory((n) => stubs[n]);

const registered = [];
mod.apply({ slots: { inject(name, fn) { fn(); }, register(spec, c) { registered.push({ spec, component: c }); return () => {}; } } });
const hudSpec = registered.find(r => r.spec.id === 'smart-models-credits-hud');
assert.ok(hudSpec, 'HUD 槽位必须仍注册');

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
function textOf(node) {
  if (node === null || node === undefined || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return textOf(node.children);
}

// modelSelection projection 指向 codearts
const projection = {
  getSnapshot: () => ({ next: { provider: 'codearts', model: 'deepseek-v4.1-flash' }, lastUsed: null }),
  subscribe: () => () => {},
};
const fakeCtx = {
  connection: fakeConnection,
  sessions: {
    binding: () => ({
      session: {
        projections: { faceOf: (name) => (name === 'modelSelection' ? projection : null) },
        getSnapshot: () => ({ running: false }),
        subscribe: () => () => {},
      },
    }),
  },
};

async function render(props, rounds = 12) {
  // 每次渲染前清空 hook 槽：否则第二次渲染会复用上一次的 state，
  // 「无 connection 应隐藏」会被上一次的余额结果污染（假运行时的典型陷阱）。
  hookSlots = [];
  let tree = null;
  for (let i = 0; i < rounds; i += 1) {
    hookCursor = 0; dirty = false; pendingEffects = [];
    tree = evaluate(hudSpec.component(props));
    const effects = pendingEffects; pendingEffects = [];
    for (const fn of effects) fn();
    await new Promise(r => setTimeout(r, 5));
    if (!dirty) break;
  }
  return tree;
}

const tree = await render({ ctx: fakeCtx, sessionId: 'ses_test' });
const text = textOf(tree);
console.log('rpc calls:', rpcCalls.map(c => c.method).join(', '));
console.log('hud text:', JSON.stringify(text));

assert.ok(rpcCalls.some(c => c.method === 'credits.balances'), 'HUD 必须通过 channel-pack RPC 取余额');
assert.match(text, /1,?360/, 'HUD 应显示积分余额');

// 无 connection 时不得抛错：胶囊降级为「—」（这是抽取前的既有行为，必须保持）
const noConnCtx = { ...fakeCtx, connection: undefined };
const tree2 = await render({ ctx: noConnCtx, sessionId: 'ses_test' });
const text2 = textOf(tree2);
console.log('no-connection render:', JSON.stringify(text2));
assert.ok(!/1,?360/.test(text2), '无 connection 时不应显示上一次的余额');
assert.match(text2, /—/, '降级为破折号，而不是崩溃');

console.log('\nALL HUD REGRESSION TESTS PASSED');
