/**
 * 客户端半身装配烟测（无 React 依赖）。
 *
 * 目的不是渲染出像素，而是证明三件事：
 *  1. client.js 能被当作模块求值（无语法/顶层引用错误）；
 *  2. factory 在拿到最小 React 替身后能返回 apply/inject；
 *  3. apply() 能对着假 ctx 完成三个槽位注册，且不抛错。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const file = 'D:/documents/deepseek-harness/default-workspace/dsh-smart-models/client.js';
const source = fs.readFileSync(file, 'utf8');

// ── 最小 React 替身：只要够 factory 顶层求值即可 ──────────────────────────
const h = (type, props, ...children) => ({ type, props, children });
const React = {
  createElement: h,
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useRef: (init) => ({ current: init }),
  useCallback: (fn) => fn,
  Component: class { constructor(props) { this.props = props; this.state = {}; } setState() {} },
};
const stubs = { react: React, 'react-dom': { createPortal: () => null } };

let captured = null;
const fakeWindow = {
  __ModuleLoader__: {
    load({ id, factory }) {
      captured = { id, factory };
    },
  },
};

// 以函数参数注入 window / require，避免真的改全局
// 样式注入走 document.head，最小替身即可（我们只验证不抛错）
const fakeDocument = {
  head: { appendChild() {} },
  createElement: () => ({ setAttribute() {}, appendChild() {}, style: {} }),
  getElementById: () => null,
  querySelector: () => null,
  addEventListener() {},
  removeEventListener() {},
};

const runner = new Function('window', 'document', 'require', 'console', source);
runner(fakeWindow, fakeDocument, (name) => {
  if (stubs[name] === undefined) throw new Error('unexpected require: ' + name);
  return stubs[name];
}, console);

assert.ok(captured !== null, 'client.js 应调用 __ModuleLoader__.load');
assert.equal(captured.id, 'dsh-smart-models');
console.log('module registered:', captured.id);

const mod = captured.factory((name) => stubs[name]);
assert.equal(typeof mod.apply, 'function', 'exports.apply 必须是函数');
assert.ok(Array.isArray(mod.inject), 'exports.inject 必须是数组');
console.log('exports.apply OK, inject =', mod.inject.join(', '));

// ── 假 ctx：记录槽位注册 ──────────────────────────────────────────────────
// 真实契约：`ctx.slots.inject(slotName, () => ctx.slots.register(spec, Component))`
// —— 回调不带参数，register 挂在**外层** ctx.slots 上。
const registered = [];
const fakeCtx = {
  slots: {
    inject(name, fn) {
      fn();
    },
    register(spec, component) {
      registered.push({ slot: spec.name, spec, component });
      return () => {};
    },
  },
};

mod.apply(fakeCtx);

const slots = registered.map(r => r.slot).sort();
console.log('registered slots:', slots.join(', '));
assert.ok(slots.includes('conversation.input.model'), '必须注册模型选择器');
assert.ok(slots.includes('conversation.input.left'), '必须注册积分 HUD');
assert.ok(slots.includes('settings.section'), '必须注册设置页分区');

const sections = registered.filter(r => r.slot === 'settings.section').map(r => r.spec.id);
console.log('settings sections:', sections.join(', '));

// 三个分区已合并为一个：设置侧栏从 3 行减到 1 行
assert.equal(sections.length, 1, '本插件在设置侧栏应只占 1 个分区（原 3 个已合并），实际 ' + sections.length);
assert.equal(sections[0], 'smart-models', '合并后的分区 id 应为 smart-models');
const merged = registered.find(r => r.spec.id === 'smart-models');
assert.equal(merged.spec.order, 36, '合并分区沿用原 order 36（紧随「免费模型」）');
assert.equal(merged.spec.label(), 'Smart Models');
assert.equal(typeof merged.component, 'function', '合并分区必须挂载组件');

// 旧分区 id 不得再注册（否则侧栏又变回 3 行）
assert.ok(!sections.includes('smart-models-usage'), '旧的用量统计分区不应再独立注册');
assert.ok(!sections.includes('smart-models-uplink'), '旧的上行自检分区不应再独立注册');
assert.ok(!sections.includes('smart-models-channel-order'), '旧的渠道排序分区不应再独立注册');

console.log('\nALL CLIENT ASSEMBLY TESTS PASSED');
