/**
 * 宿主路由集成烟测：用假 ctx 捕获 apply() 注册的 handler，再以假 req/res 调用。
 * 不启动 DSH、不发网络请求。
 */
import assert from 'node:assert/strict';
import { apply } from 'file:///D:/documents/deepseek-harness/default-workspace/dsh-smart-models/index.js';

let handler = null;
const fakeCtx = {
  inject(services, fn) {
    const child = {
      webServer: {
        register(spec) { handler = spec.handler; return () => {}; },
      },
      effect(fn) { return fn(); },
    };
    fn(child);
  },
};

apply(fakeCtx);
assert.equal(typeof handler, 'function', 'apply 应注册一个 prefix handler');
console.log('handler registered OK');

function call(url) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const res = {
      statusCode: 0,
      headers: {},
      writeHead(code, headers) { this.statusCode = code; this.headers = headers || {}; },
      end(body) { chunks.push(body ?? ''); resolve({ status: this.statusCode, headers: this.headers, body: chunks.join('') }); },
    };
    Promise.resolve(handler({ url, method: 'GET' }, res)).catch(reject);
  });
}

const r1 = await call('/api/smart-models/uplink-health');
assert.equal(r1.status, 200);
const j1 = JSON.parse(r1.body);
assert.equal(j1.ok, true);
assert.ok(j1.providers && typeof j1.providers === 'object');
console.log('all providers:', Object.keys(j1.providers).join(', '));
console.log('workbuddy models:', Object.keys(j1.providers.workbuddy?.models ?? {}).join(', '));
const wb = j1.providers.workbuddy?.models?.['deepseek-v4.1-flash'];
console.log('workbuddy/v4.1-flash:', JSON.stringify(wb));
assert.ok(wb, 'workbuddy 应有限制记录');
assert.equal(wb.level, 'degraded');
assert.match(wb.reason, /账号受限/);

// 不得泄漏凭据/昵称
const raw = r1.body;
assert.ok(!raw.includes('credentialRef'), '不得泄漏 credentialRef');
assert.ok(!raw.includes('nickname'), '不得泄漏 nickname');
assert.ok(!raw.includes('WORKBUDDY_ACCOUNT_'), '不得泄漏凭据引用名');
console.log('no credential leakage OK');

const r2 = await call('/api/smart-models/uplink-health?provider=codearts');
assert.equal(r2.status, 200);
const j2 = JSON.parse(r2.body);
assert.deepEqual(Object.keys(j2.providers), ['codearts']);
console.log('provider filter OK:', JSON.stringify(j2.providers.codearts.models['deepseek-v4-pro']));

const r3 = await call('/api/smart-models/uplink-health?provider=nonexistent');
assert.equal(r3.status, 200);
assert.deepEqual(JSON.parse(r3.body).providers, {});
console.log('unknown provider -> empty OK');

// 未知路径仍 404
const r4 = await call('/api/smart-models/nope');
assert.equal(r4.status, 404);
console.log('404 fallback OK');

console.log('\nALL ROUTE TESTS PASSED');
