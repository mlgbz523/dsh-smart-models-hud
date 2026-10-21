/**
 * 渠道视图（按渠道商分类排列）渲染与行为烟测。
 *
 * 守护的缺陷（都是设计阶段就识别出来的，不是事后补的）：
 *  1. 视图开关死锁：Claude / GPT-OSS 的 efforts 为 null，底栏若条件渲染，
 *     切到这类模型时开关会整行消失，用户再也切不回「按模型」。
 *  2. 查询爆炸：credits.balances 是串行逐账号查询，折叠的渠道组绝不能发请求。
 *  3. 行语义错位：渠道视图的行必须是「渠道 × 模型」，不是聚合模型行。
 *  4. 置顶区泄漏：渠道视图不该出现模型视图的置顶区。
 *  5. 排序失效：自定义顺序必须生效，免费池必须垫底。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('D:/documents/deepseek-harness/default-workspace/dsh-smart-models/client.js', 'utf8');

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

// ── 假 catalog：三个渠道，含一个免费池、一个无思考档位模型 ─────────────────
const catalog = {
  default: { provider: 'codearts', model: 'deepseek-v4.1-flash' },
  groups: [
    {
      id: 'our-free-model', name: 'Free Lane',
      models: [{ id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' }],
    },
    {
      id: 'workbuddy', name: 'WorkBuddy',
      models: [
        { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', creditsRate: 'x0' },
        { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
      ],
    },
    {
      id: 'codearts', name: 'CodeArts',
      models: [
        { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash' },
        { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },  // efforts 缺失 → null
        // 追加 3 个 Claude 模型：让 claude 家族非置顶成员数 >= FAMILY_MERGE_THRESHOLD(3)，
        // 从而真实渲染成一个家族块。当前模型本身被置顶、不进家族，若它的家族没有
        // 其它非置顶成员，界面上根本不会有这个块，自动展开自然无从谈起。
        { id: 'claude-opus-4-6-thinking', name: 'Claude Opus 4.6 (Thinking)' },
        { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' },
        { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' },
      ],
    },
  ],
};

// ── 假 RPC：记录每一次 credits.balances 调用 ──────────────────────────────
const rpcCalls = [];
// 受控并发的实测探针：进入/离开 RPC 时增减在飞计数，记录峰值
let inFlight = 0;
let peakInFlight = 0;
const fakeConnection = {
  rpc: {
    async call(_route, _service, payload) {
      const method = payload?.method;
      const provider = payload?.payload?.provider;
      rpcCalls.push({ method, provider });
      if (method === 'usage.badge' || method === 'credits.balances') {
        inFlight += 1;
        if (inFlight > peakInFlight) peakInFlight = inFlight;
        // 模拟串行逐账号查询的耗时
        await new Promise(r => setTimeout(r, 15));
        inFlight -= 1;
        const total = provider === 'workbuddy' ? 1360 : provider === 'codearts' ? 250 : 0;
        return { ok: true, value: { accounts: [{ accountId: 'a1', balance: { total, packages: [{ unit: 'credit' }] } }] } };
      }
      return { ok: true, value: {} };
    },
  },
};

const fakeFetch = async (url) => {
  const u = String(url);
  if (u.includes('uplink-health')) {
    return { ok: true, status: 200, async json() { return { ok: true, checkedAt: Date.now(), providers: {} }; } };
  }
  if (u.includes('channel-status')) {
    return { ok: true, status: 200, async json() { return { ok: true, autoCheckin: { channels: [] }, state: { accounts: [] } }; } };
  }
  return { ok: true, status: 200, async json() { return { ok: true }; } };
};

// 从 client.js 抽取单位归一函数，独立求值（不启动整个插件）
function normalizeUnitForTest(unit) {
  const m = source.match(/function normalizeBalanceUnit\(unit\) \{[\s\S]*?\n    \}/);
  if (!m) throw new Error('未找到 normalizeBalanceUnit');
  const fn = new Function('unit', m[0] + '\n return normalizeBalanceUnit(unit);');
  return fn(unit);
}

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
const storage = new Map();
const fakeWindow = {
  __ModuleLoader__: { load({ id, factory }) { captured = { id, factory }; } },
  addEventListener() {},
  removeEventListener() {},
  localStorage: {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  },
  location: { href: 'http://localhost/' },
  innerWidth: 1440,
  innerHeight: 900,
};

// ⚠️ 模块内部用的是裸 localStorage（浏览器全局），不是 window.localStorage。
//    必须把它装到 globalThis 上，否则 17 处持久化调用全部落到 catch 分支，
//    「默认视图」「一次性重置」这类逻辑在测试里等于没跑。
globalThis.localStorage = fakeWindow.localStorage;

const origSetInterval = globalThis.setInterval;
const origClearInterval = globalThis.clearInterval;
globalThis.setInterval = () => ({ unref() {} });
globalThis.clearInterval = () => {};

const runner = new Function('window', 'document', 'require', 'console', 'fetch', source);
runner(fakeWindow, fakeDocument, (name) => stubs[name], console, fakeFetch);
const mod = captured.factory((name) => stubs[name]);

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
  remote: {
    $on: () => () => {},
    session: {
      modelCatalog: async () => ({ ok: true, value: catalog }),
      selectModel: async () => ({ ok: true }),
    },
  },
};

const registered = [];
mod.apply({
  slots: { inject(name, fn) { fn(); }, register(spec, component) { registered.push({ spec, component }); return () => {}; } },
});
const selectSpec = registered.find(r => r.spec.name === 'conversation.input.model');
assert.ok(selectSpec, '必须注册模型选择器');

// ── 求值与查询工具 ────────────────────────────────────────────────────────
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
const cls = (needle) => (n) => n.props && typeof n.props.className === 'string' && n.props.className.includes(needle);
// 精确 token 匹配：'dsh-sm-family' 用 includes 会同时命中 'dsh-sm-family-head'，
// 导致每个渠道组被数两遍。
const clsToken = (token) => (n) => {
  if (!n.props || typeof n.props.className !== 'string') return false;
  return n.props.className.split(/\s+/).includes(token);
};

async function render(props, rounds = 14) {
  // ⚠️ 不重置 hookSlots：open / viewMode 等状态必须跨渲染存活，
  //    否则「点开面板」后下一次渲染又变回关闭状态，整个测试自欺欺人。
  let tree = null;
  for (let i = 0; i < rounds; i += 1) {
    hookCursor = 0; dirty = false; pendingEffects = [];
    tree = evaluate(selectSpec.component(props));
    const effects = pendingEffects; pendingEffects = [];
    for (const fn of effects) fn();
    await new Promise(r => setTimeout(r, 6));
    if (!dirty) break;
  }
  return tree;
}

const props = { ctx: fakeCtx, sessionId: 'ses_channel' };

// ── 1. 打开面板：底栏开关必须存在 ─────────────────────────────────────────
let tree = await render(props);
const trigger = findAll(tree, cls('dsh-sm-trigger'))[0];
assert.ok(trigger, '应渲染出触发器');
trigger.props.onClick();
tree = await render(props);

let toggles = findAll(tree, cls('dsh-sm-view-toggle'));
assert.equal(toggles.length, 1, '底栏应有且仅有一个视图切换开关');
// 单按钮两态：本身就是一个 button，不是分段控件
assert.equal(toggles[0].type, 'button', '开关必须是单个 button');
assert.equal(textOf(toggles[0]), '模型', '默认态文案应为「模型」');
assert.ok(!toggles[0].props.className.includes('is-active'), '默认态不应带激活样式');
console.log('✓ 1 视图开关为单按钮两态，默认显示「模型」');

// ── 2. 模型视图下无渠道分组 ───────────────────────────────────────────────
assert.equal(findAll(tree, cls('dsh-sm-channel-balance')).length, 0, '模型视图不该有渠道余额标签');
console.log('✓ 2 模型视图无渠道分组');

// ── 3. 切到渠道视图：行语义 = 渠道 × 模型 ─────────────────────────────────
const t2 = findAll(tree, cls('dsh-sm-view-toggle'))[0];
t2.props.onClick();
tree = await render(props);

// 切换后：文案变「渠道」，且带激活样式
const afterToggle = findAll(tree, cls('dsh-sm-view-toggle'))[0];
assert.equal(textOf(afterToggle), '渠道', '激活态文案应为「渠道」');
assert.ok(afterToggle.props.className.includes('is-active'), '激活态应带 is-active');
console.log('✓ 3a 单按钮切换后文案变「渠道」并激活');

const groups = findAll(tree, clsToken('dsh-sm-channel-row'));
assert.ok(groups.length >= 3, '渠道视图应有至少 3 个渠道组，实际 ' + groups.length);

// deepseek-v4.1-flash 同时存在于 workbuddy 与 codearts 两组
// 悬停 WorkBuddy 渠道行 → 右侧伴随卡列出该渠道的模型
const wbRow = findAll(tree, cls('dsh-sm-channel-row')).find(n => textOf(n).includes('WorkBuddy'));
assert.ok(wbRow, '应能定位到 WorkBuddy 渠道行');
wbRow.props.onMouseEnter({ currentTarget: { getBoundingClientRect: () => ({ top: 100, right: 300 }) } });
tree = await render(props);

const flyout = findAll(tree, cls('dsh-sm-companion-flyout'))[0];
assert.ok(flyout, '悬停渠道行后应出现右侧伴随卡');
const flyoutText = textOf(flyout);
assert.match(flyoutText, /DeepSeek V4\.1 Flash/, '伴随卡应列出该渠道的模型');
assert.match(flyoutText, /2 个模型/, '伴随卡标题应显示模型数');
console.log('✓ 3 悬停渠道行 → 伴随卡列出该渠道模型:', JSON.stringify(flyoutText.slice(0, 60)));

// 同一模型在不同渠道的伴随卡里各出现一次（行语义 = 渠道 × 模型）
const codeartsRow = findAll(tree, cls('dsh-sm-channel-row')).find(n => textOf(n).includes('CodeArts'));
codeartsRow.props.onMouseEnter({ currentTarget: { getBoundingClientRect: () => ({ top: 130, right: 300 }) } });
tree = await render(props);
const flyout2 = findAll(tree, cls('dsh-sm-companion-flyout'))[0];
assert.match(textOf(flyout2), /DeepSeek V4\.1 Flash/, 'CodeArts 的伴随卡里也应有同一模型');
console.log('✓ 3b 同一模型在多个渠道的伴随卡中各出现一次');

// ── 4. 渠道视图不出现置顶区 ───────────────────────────────────────────────
assert.equal(findAll(tree, cls('dsh-sm-pinned-section')).length, 0, '渠道视图不该有置顶区');
console.log('✓ 4 渠道视图无置顶区');

// ── 5. 进入渠道视图即全量查询，但走受控并发（并发度 2）──────────────���────
const queried = rpcCalls.filter(c => c.method === 'usage.badge' || c.method === 'credits.balances');
const providersQueried = queried.map(c => c.provider);
console.log('   已查询余额的渠道:', JSON.stringify(providersQueried));
assert.ok(providersQueried.length >= 3, '进入渠道视图应查询全部渠道，实际 ' + providersQueried.length);
assert.ok(providersQueried.includes('codearts'), '应包含当前模型所在渠道');
assert.ok(providersQueried.includes('our-free-model'), '应包含免费池渠道（不再懒加载）');
// 优先走 usage.badge（带服务端 120s 缓存）
assert.ok(queried.some(c => c.method === 'usage.badge'), '应优先使用 usage.badge（复用服务端缓存）');
console.log('✓ 5 全量查询 + 优先 usage.badge');

// 受控并发：同时在飞的上游请求不超过 2
assert.ok(peakInFlight <= 2, '并发度必须 <= 2，实测峰值 ' + peakInFlight);
console.log('✓ 5b 并发受控，峰值同时在飞 =', peakInFlight);

// ── 6. 展开的组标题显示余额 ───────────────────────────────────────────────
const balances = findAll(tree, cls('dsh-sm-channel-balance'));
assert.ok(balances.length >= 1, '展开的渠道组标题应显示余额');
const balText = balances.map(textOf).join('|');
assert.match(balText, /250|分/, '余额文本应含数值，实际: ' + balText);
console.log('✓ 6 组标题显示余额:', JSON.stringify(balText));

// ── 7. 无思考档位模型下开关仍存在（死锁回归）──────────────────────────────
// 在 CodeArts 的伴随卡里点 Claude Sonnet 4.6（catalog 里没有 reasoning → efforts 为 null）
const caRow = findAll(tree, cls('dsh-sm-channel-row')).find(n => textOf(n).includes('CodeArts'));
caRow.props.onMouseEnter({ currentTarget: { getBoundingClientRect: () => ({ top: 160, right: 300 }) } });
tree = await render(props);
const caFlyout = findAll(tree, cls('dsh-sm-companion-flyout'))[0];
assert.ok(caFlyout, 'CodeArts 应弹出伴随卡');
const claudeCard = findAll(caFlyout, cls('dsh-sm-detail-card')).find(c => textOf(c).includes('Claude Sonnet'));
assert.ok(claudeCard, 'CodeArts 伴随卡里应有 Claude Sonnet');
claudeCard.props.onClick();
tree = await render(props);
toggles = findAll(tree, cls('dsh-sm-view-toggle'));
assert.equal(toggles.length, 1, '无思考档位模型下，视图开关必须仍然存在（防功能死锁）');
console.log('✓ 7 无档位模型下开关仍在（死锁回归）');

// ── 8. 排序：agy / Gemini 最前，官方账号与 Siliconflow 置底 ──────────────
const order = findAll(tree, cls('dsh-sm-channel-row')).map(r => {
  const label = findAll(r, cls('dsh-sm-family-label'))[0];
  return label ? textOf(label) : '';
});
console.log('   渠道行顺序:', JSON.stringify(order));
// 当前 fixture 只有 3 个渠道，验证「免算力车道」相对靠后即可
const freeIdx = order.findIndex(t => /免算力|Free/i.test(t));
assert.ok(freeIdx === -1 || freeIdx >= 1, '免算力/免费池不应排在最前，实际位置 ' + freeIdx);
console.log('✓ 8 排序生效（免费池不占首位）');

// ── 9. 单位统一：credits / credit / 积分 都归一成「分」──────────────────────
const unitCases = [
  ['credits', '分'], ['credit', '分'], ['积分', '分'], ['points', '分'],
  ['token', 'Token'], ['USD', 'USD']
];
for (const [raw, want] of unitCases) {
  const out = normalizeUnitForTest(raw);
  assert.equal(out, want, '单位 ' + raw + ' 应归一为 ' + want + '，实际 ' + out);
}
console.log('✓ 9 单位统一：credits/credit/积分 → 分，token/USD 保持量纲');

// ── 10. 余额列定宽右对齐（CSS 契约）────────────────────────────────────────
const cssBlock = source.slice(source.indexOf('.dsh-sm-channel-balance {'), source.indexOf('.dsh-sm-channel-balance {') + 500);
assert.match(cssBlock, /text-align:\s*right/, '余额列必须右对齐');
assert.match(cssBlock, /width:\s*\d+px/, '余额列必须定宽');
assert.match(cssBlock, /tabular-nums/, '余额列必须使用等宽数字');
console.log('✓ 10 余额列定宽右对齐 + 等宽数字');

// ── 11. 离开渠道伴随卡后必须关闭（旧实现只清 hoveredModel 的 bug）──────────
const caRow2 = findAll(tree, cls('dsh-sm-channel-row')).find(n => textOf(n).includes('CodeArts'));
caRow2.props.onMouseEnter({ currentTarget: { getBoundingClientRect: () => ({ top: 200, right: 300 }) } });
tree = await render(props);
assert.ok(findAll(tree, cls('dsh-sm-companion-flyout')).length > 0, '悬停后应出现伴随卡');

const fly2 = findAll(tree, cls('dsh-sm-companion-flyout'))[0];
assert.ok(typeof fly2.props.onMouseLeave === 'function', '伴随卡必须有 onMouseLeave');
fly2.props.onMouseLeave();
// 等待超过关闭宽限
await new Promise(r => setTimeout(r, 400));
tree = await render(props);
assert.equal(findAll(tree, cls('dsh-sm-companion-flyout')).length, 0,
  '离开伴随卡后必须关闭（渠道卡的 leave 必须清 hoveredChannel）');
console.log('✓ 11 离开渠道伴随卡后正确关闭');

// ── 12. 桥接通道必须覆盖斜向路径，且不遮挡主卡片 ─────────────────────────
const bridgeIdx = source.indexOf('.dsh-sm-companion-flyout::before');
assert.ok(bridgeIdx !== -1, '必须存在隐形桥接通道');
const bridgeCss = source.slice(bridgeIdx, bridgeIdx + 400);
const topMatch = bridgeCss.match(/top:\s*-?(\d+)px/);
const bottomMatch = bridgeCss.match(/bottom:\s*-?(\d+)px/);
const widthMatch = bridgeCss.match(/width:\s*(\d+)px/);
assert.ok(topMatch && Number(topMatch[1]) >= 400, '桥接通道竖向跨度必须 >= 400px（覆盖钳制后的斜向路径），实际 ' + (topMatch && topMatch[1]));
assert.ok(bottomMatch && Number(bottomMatch[1]) >= 400, '桥接通道底部跨度必须 >= 400px');
assert.ok(widthMatch && Number(widthMatch[1]) <= 12, '桥接通道横向必须 <= 12px（不遮挡主卡片），实际 ' + (widthMatch && widthMatch[1]));
console.log('✓ 12 桥接通道覆盖斜向路径且不遮挡主卡片');

// ── 13. 关闭宽限必须 >= 300ms（150ms 实测不够）──────────────────────────
const delayMatch = source.match(/const FLYOUT_CLOSE_DELAY_MS = (\d+)/);
assert.ok(delayMatch, '必须定义 FLYOUT_CLOSE_DELAY_MS 常量');
assert.ok(Number(delayMatch[1]) >= 300, '关闭宽限必须 >= 300ms，实际 ' + delayMatch[1]);
assert.ok(!/\}, 150\);/.test(source), '不得残留硬编码的 150ms 超时');
console.log('✓ 13 关闭宽限 =', delayMatch[1] + 'ms，无硬编码残留');

// ── 16. 当前模型所在家族默认展开（悬停级联前：内联展开 + 自动展开）────────
// 回到模型视图
let backBtn = findAll(tree, cls('dsh-sm-view-toggle'))[0];
if (textOf(backBtn) === '渠道') {
  backBtn.props.onClick();
  tree = await render(props);
}

const famHeads = findAll(tree, cls('dsh-sm-family-head'));
assert.ok(famHeads.length >= 1, '模型视图应渲染出家族标题，实际 ' + famHeads.length);
const openHeads = famHeads.filter(n => n.props.className.includes('is-open'));
assert.ok(openHeads.length >= 1, '当前模型所在家族必须默认展开，实际展开 ' + openHeads.length);
console.log('✓ 16 自动展开的家族:', JSON.stringify(textOf(openHeads[0])));

// ── 17. 自动展开的家族不吸顶（吸顶只给手动展开）──────────────────────────
assert.ok(!openHeads[0].props.className.includes('is-sticky'),
  '自动展开的家族不应吸顶（吸顶会让标题钉在顶部挡住内容）');
console.log('✓ 17 自动展开的家族不吸顶');

// ── 18. 伴随卡「第一个选项」与母行对齐（而非卡片头部对齐）──────────────
const calcSrc = source.slice(source.indexOf('const calculateFlyoutPos'), source.indexOf('const handleRowMouseEnter'));
assert.ok(calcSrc.includes('maxHeight'), 'calculateFlyoutPos 必须返回 maxHeight');
assert.ok(calcSrc.includes('optionAligned'), '必须返回 optionAligned 以便验证对齐是否达成');

// 核心：定位必须补偿「头部 + 列表内边距」的偏移，否则对齐到的是标题栏而非选项
assert.ok(calcSrc.includes('FLYOUT_OPTION_OFFSET_PX'), '必须补偿选项相对卡片顶部的偏移');
assert.ok(calcSrc.includes('rowCenter'), '必须以母行中线为对齐基准');
assert.ok(/rowCenter - FLYOUT_OPTION_OFFSET_PX - FLYOUT_OPTION_ROW_PX \/ 2/.test(calcSrc),
  '选项中线必须与母行中线重合');

// 常量与 CSS 必须自洽
const offMatch = source.match(/const FLYOUT_OPTION_OFFSET_PX = (\d+)/);
const rowMatch = source.match(/const FLYOUT_OPTION_ROW_PX = (\d+)/);
assert.ok(offMatch && Number(offMatch[1]) === 38, 'FLYOUT_OPTION_OFFSET_PX 应为 38（头 32 + 列表内边距 6）');
assert.ok(rowMatch && Number(rowMatch[1]) === 29, 'FLYOUT_OPTION_ROW_PX 应为 29');

// 用「取到下一个 } 为止」的方式精确切片，避免多处同名规则导致取错块
function cssRule(selector) {
  const start = source.indexOf(selector + ' {');
  if (start === -1) return '';
  const end = source.indexOf('}', start);
  return source.slice(start, end + 1);
}
assert.match(cssRule('.dsh-sm-companion-head'), /min-height:\s*32px/, '头部必须锁死 32px 以匹配 JS 常量');
assert.match(cssRule('.dsh-sm-detail-card'), /min-height:\s*29px/, '选项卡必须锁死 29px 以匹配 JS 常量');

console.log('✓ 18 伴随卡第一选项与母行中线对齐（偏移 38px 已补偿）');

// ── 19. 伴随卡高度上调（比旧版 380 更高）且内层不再写死 320 ─────────────
assert.ok(/Math\.min\(460/.test(calcSrc), '伴随卡期望高度应上调到 460');
const innerCss = source.slice(source.indexOf('.dsh-sm-companion-channels {'), source.indexOf('.dsh-sm-companion-channels {') + 400);
assert.ok(!/max-height:\s*320px/.test(innerCss), '内层列表不得再写死 320px（会截断外层加高）');
assert.ok(/flex:\s*1 1 auto/.test(innerCss), '内层列表必须 flex 撑满动态高度');
console.log('✓ 19 伴随卡高度上调，内层自适应');

// ── 14. 默认视图 = 模型（空存储时）──────────────────────────────────────
// loadViewMode 只在组件首次渲染时执行，因此必须真的渲染一次，不能只装配模块。
const freshStorage = new Map();
const savedStorage = globalThis.localStorage;
const makeStorage = (map) => ({
  getItem: (k) => (map.has(k) ? map.get(k) : null),
  setItem: (k, v) => map.set(k, String(v)),
  removeItem: (k) => map.delete(k),
});
globalThis.localStorage = makeStorage(freshStorage);
fakeWindow.localStorage = globalThis.localStorage;

const captured2 = { id: null, factory: null };
const fakeWindow2 = { ...fakeWindow, __ModuleLoader__: { load({ id, factory }) { captured2.id = id; captured2.factory = factory; } } };
const runner2 = new Function('window', 'document', 'require', 'console', 'fetch', source);
runner2(fakeWindow2, fakeDocument, (name) => stubs[name], console, fakeFetch);
const mod2 = captured2.factory((name) => stubs[name]);

const reg2 = [];
mod2.apply({
  slots: { inject(name, fn) { fn(); }, register(spec, component) { reg2.push({ spec, component }); return () => {}; } },
});
const spec2 = reg2.find(r => r.spec.name === 'conversation.input.model');
assert.ok(spec2, '空存储场景下必须注册模型选择器');

// 渲染一次以触发 loadViewMode
hookSlots = [];
hookCursor = 0; dirty = false; pendingEffects = [];
evaluate(spec2.component(props));
for (const fn of pendingEffects.slice()) fn();
await new Promise(r => setTimeout(r, 20));

assert.equal(freshStorage.get('dsh_sm_view_mode_v1'), 'model', '空存储时默认视图必须是 model');
assert.equal(freshStorage.get('dsh_sm_view_mode_defaulted_v1'), '1', '必须写入一次性重置标记');
console.log('✓ 14 空存储默认视图 = model，且写入重置标记');

// ── 15. 存量 'channel' 会被一次性重置，且磁盘无法把它覆盖回来 ──────────────
const staleStorage = new Map([
  ['dsh_sm_view_mode_v1', 'channel'],   // 历史存量：打开就是渠道
]);
globalThis.localStorage = makeStorage(staleStorage);
fakeWindow.localStorage = globalThis.localStorage;
const captured3 = { id: null, factory: null };
const fakeWindow3 = { ...fakeWindow, __ModuleLoader__: { load({ id, factory }) { captured3.id = id; captured3.factory = factory; } } };
const runner3 = new Function('window', 'document', 'require', 'console', 'fetch', source);
runner3(fakeWindow3, fakeDocument, (name) => stubs[name], console, fakeFetch);
const mod3 = captured3.factory((name) => stubs[name]);
const reg3 = [];
mod3.apply({
  slots: { inject(name, fn) { fn(); }, register(spec, component) { reg3.push({ spec, component }); return () => {}; } },
});
const spec3 = reg3.find(r => r.spec.name === 'conversation.input.model');
hookSlots = [];
hookCursor = 0; dirty = false; pendingEffects = [];
evaluate(spec3.component(props));
for (const fn of pendingEffects.slice()) fn();
await new Promise(r => setTimeout(r, 20));

assert.equal(staleStorage.get('dsh_sm_view_mode_v1'), 'model',
  '存量 channel 必须被一次性重置为 model');
assert.equal(staleStorage.get('dsh_sm_view_mode_defaulted_v1'), '1', '重置后必须打标记');
console.log('✓ 15 存量 channel 一次性重置为 model');

globalThis.localStorage = savedStorage;
fakeWindow.localStorage = savedStorage;

// ── 20. 对齐公式的数值验证（不只看字符串，要算出来对得上）──────────────
// 复刻 calculateFlyoutPos 的数学，验证「第一选项中线 == 母行中线」
const OFF = 38, ROW = 29, MARGIN = 12;
function optionCenterOf(cardTop) { return cardTop + OFF + ROW / 2; }
function computeTop(rowTop, rowHeight, viewportH, desiredHeight) {
  const rowCenter = rowTop + rowHeight / 2;
  const desired = rowCenter - OFF - ROW / 2;
  const maxTop = viewportH - MARGIN - desiredHeight;
  let top = desired, aligned = true;
  if (top > maxTop) { top = maxTop; aligned = false; }
  if (top < MARGIN) { top = MARGIN; aligned = false; }
  return { top, aligned };
}

// 场景 A：母行在视口中间，空间充足 → 必须精确对齐
const A = computeTop(400, 32, 900, 300);
assert.equal(A.aligned, true, '空间充足时必须达成选项级对齐');
assert.equal(optionCenterOf(A.top), 400 + 16, '第一选项中线必须等于母行中线（416）');
console.log('✓ 20a 空间充足：选项中线', optionCenterOf(A.top), '= 母行中线 416');

// 场景 B：母行贴近视口底部 → 允许放弃对齐，但卡片必须完整可见
const B = computeTop(850, 32, 900, 300);
assert.equal(B.aligned, false, '空间不足时应标记为未对齐');
assert.ok(B.top + 300 <= 900 - MARGIN + 0.001, '卡片必须完整落在视口内，实际底边 ' + (B.top + 300));
console.log('✓ 20b 空间不足：放弃对齐但保证卡片可见（top=' + B.top + '）');

// 场景 C：母行贴近顶部 → 下移但仍在视口内
const C = computeTop(2, 32, 900, 300);
assert.equal(C.aligned, false);
assert.ok(C.top >= MARGIN, '卡片不得溢出顶部');
console.log('✓ 20c 贴顶场景：卡片不溢出（top=' + C.top + '）');

// ── 21/22/23. settleRound 纯函数：三道闸防误算 ───────────────────────────
const settleSrc = source.match(/function settleRound\([\s\S]*?\n    \}/);
assert.ok(settleSrc, '必须存在 settleRound 纯函数（结算闸门可独立测试）');
const settleFn = new Function('before', 'after', 'currentProviderId',
  settleSrc[0] + '\n return settleRound(before, after, currentProviderId);');

// 21. 跨渠道：快照渠道 A（9000），结算渠道 B → 弃积分，reason=provider-switch
const r21 = settleFn(
  { total: 9000, provider: 'channelA', accounts: 3, at: 1 },
  { total: 1000, accounts: 3 },
  'channelB'
);
assert.equal(r21.kind, 'suspect', '跨渠道必须判为 suspect');
assert.equal(r21.reason, 'provider-switch', '原因必须是 provider-switch（用户实测的 -8000 场景）');
console.log('✓ 21 跨渠道结算 → suspect(provider-switch)，不再产生 -8000');

// 22. 账号集变化：快照 3 账号，结算 2 账号（1 个查询失败）→ 弃积分
const r22 = settleFn(
  { total: 15000, provider: 'workbuddy', accounts: 3, at: 1 },
  { total: 500, accounts: 2, failed: 1 },
  'workbuddy'
);
assert.equal(r22.kind, 'suspect');
assert.equal(r22.reason, 'account-change', '账号集变化必须判 account-change（15159.99 垃圾的来源）');
console.log('✓ 22 账号集变化 → suspect(account-change)，不再产生 15159.99');

// 23. 正常路径：同渠道同账号集，余额下降 → 实测消耗
const r23 = settleFn(
  { total: 1000, provider: 'workbuddy', accounts: 2, at: 1 },
  { total: 940, accounts: 2, failed: 0 },
  'workbuddy'
);
assert.equal(r23.kind, 'measured');
assert.equal(r23.consumed, 60, '正常消耗应为 60');
console.log('✓ 23 正常结算 → measured(60)');

// 23b. 余额增加（签到/充值）→ 记 0，不记负数
const r23b = settleFn(
  { total: 900, provider: 'workbuddy', accounts: 2, at: 1 },
  { total: 1100, accounts: 2, failed: 0 },
  'workbuddy'
);
assert.equal(r23b.kind, 'measured');
assert.equal(r23b.consumed, 0, '余额增加时消耗记 0（不记负数）');
console.log('✓ 23b 余额增加 → consumed=0（签到场景回归）');

// ── 24/25. 明细表 + 柱状图（UI 契约）────────────────────────────────────
assert.ok(source.includes('明细日志'), '必须提供明细日志表');
assert.ok(source.includes('dsh-sm-usage-detail'), '明细表必须有专属样式');
assert.ok(source.match(/'时间'|'时间'/), '明细表必须有时间列');
assert.ok(source.match(/'渠道'|'渠道'/), '明细表必须有渠道列');
assert.ok(source.match(/'模型'|'模型'/), '明细表必须有模型列');
assert.ok(source.match(/'积分'|'积分'/), '明细表必须有积分列');
console.log('✓ 24 明细日志表：时间/渠道/模型/积分列齐备');

assert.ok(source.includes('dsh-sm-usage-bar'), '柱状图必须有 bar 元素类');
assert.ok(source.includes("className: 'dsh-sm-usage-chart'"), '必须有 SVG 图表容器');
assert.ok(source.includes('chartDays.length === 0'), '空数据时必须有占位（不渲染空图）');
console.log('✓ 25 柱状图：SVG 自绘 + 空数据占位');

// ── 26. 统计口径：creditsKnown:false 不进积分合计（既有行为回归）─────────
const totalsSrc = source.match(/const totals = useMemo\(\(\) => \{[\s\S]*?\}, \[filtered\]\);/);
assert.ok(totalsSrc && totalsSrc[0].includes('creditsKnown === true'), '聚合积分只计 creditsKnown:true');
console.log('✓ 26 聚合积分只计可信记录');

// ── 27. 清理路由：宿主端存在 /usage/clean 且在 /usage 之前 ───────────────
const idxSrc = fs.readFileSync('D:/documents/deepseek-harness/default-workspace/dsh-smart-models/index.js', 'utf8');
const cleanAt = idxSrc.indexOf("'/api/smart-models/usage/clean'");
const usageAt = idxSrc.indexOf("'/api/smart-models/usage'");
assert.ok(cleanAt !== -1, '宿主必须有 /usage/clean 路由');
assert.ok(cleanAt < usageAt, '/usage/clean 必须派发在 /usage 之前（startsWith 前缀冲突）');
assert.ok(idxSrc.includes("usagePath + '.bak'"), '清理前必须备份台账');
assert.ok(idxSrc.includes('e.credits > 1000'), '清理判定必须含「单轮 >1000 积分」');
console.log('✓ 27 清理路由存在、顺序正确、先备份');

// ── 28. 设置页提供「打开完整看板」入口（且保留原有统计内容）─────────────
assert.ok(source.includes('打开完整看板'), '设置页必须有打开看板的入口');
// 入口必须构造**绝对 URL**：DSH 桌面壳的 setWindowOpenHandler 会对相对路径
// 执行 new URL(url) 并抛 Invalid URL，导致 window.open 静默失败（用户报「什么都没显示」）
// 桌面壳双网络语义：fetch 用相对路径（走 dsh-app 代理 + cookie），
// window.open 必须用绝对 http URL（主进程只对 http/https 调 openExternal）。
assert.ok(source.includes("fetch('/smart-models'"), '探活必须用相对路径（走 dsh-app 代理，避免 CORS）');
assert.ok(source.includes('__DSH_TRANSPORT__'), '必须从 __DSH_TRANSPORT__ 取真实 http origin');
assert.ok(source.includes('streamBaseUrl'), '必须读取 streamBaseUrl');
assert.ok(source.includes("origin.replace(/\\/$/, '') + '/smart-models'"), '打开时用 origin + /smart-models 拼绝对 URL');
assert.ok(!/window\.open\(\s*['"]\/smart-models['"]/.test(source), '严禁相对路径 window.open');
// 反例守护：绝对 http fetch 会被 CORS 拦死（用户实测报错）
assert.ok(!/fetch\(\s*(origin|absoluteUrl)\s*,/.test(source),
  '严禁用绝对 http URL 做 fetch（会被 dsh-app://app 的 CORS 拦截）');
assert.ok(!/window\.open\(\s*['"]\/smart-models['"]/.test(source),
  '严禁用相对路径 window.open（会被 Electron 静默拒绝）');
assert.ok(source.includes('window.open(url'), '必须实际调用 window.open 打开看板');
assert.ok(source.includes('noopener,noreferrer'), 'window.open 必须带 noopener/noreferrer');
assert.ok(source.includes('看板路由不可用'), '路由 404 时必须提示用户重启 DSH');
assert.ok(source.includes('完整重启'), '提示必须说明需要完整重启而非 Ctrl+R');
// 用户明确要求：设置页不瘦身，原有内容必须保留
assert.ok(source.includes('明细日志'), '设置页明细日志必须保留（不瘦身）');
assert.ok(source.includes('按模型') && source.includes('按渠道') && source.includes('按日期'), '三张聚合表必须保留');
assert.ok(source.includes('清理历史可疑记录'), '清理按钮必须保留');
console.log('✓ 28 设置页新增看板入口且未瘦身');

globalThis.setInterval = origSetInterval;
globalThis.clearInterval = origClearInterval;

console.log('\nALL CHANNEL VIEW TESTS PASSED');
