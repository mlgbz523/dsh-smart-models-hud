/**
 * 用量看板静态结构测试。
 *
 * 看板是一个零依赖单页（dashboard/index.html），没有构建步骤，
 * 因此这里做的是「静态契约」断言：控件齐备、离线可用、不引外部资源。
 * 不启动浏览器——真正的渲染效果需人工验证。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'D:/documents/deepseek-harness/default-workspace/dsh-smart-models';
const htmlPath = path.join(ROOT, 'dashboard', 'index.html');

assert.ok(fs.existsSync(htmlPath), '看板文件必须存在：dashboard/index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

// ── 1. 时间范围：4 个按钮 ────────────────────────────────────────────────
for (const r of ['today', '7d', '30d', 'all']) {
  assert.ok(html.includes('data-range="' + r + '"'), '必须有时间范围按钮：' + r);
}
console.log('✓ 1 时间范围 4 档齐备');

// ── 2. 筛选控件：渠道 / 模型 / 仅可信 / 搜索 ──────────────────────────────
for (const id of ['fProvider', 'fModel', 'fTrusted', 'fSearch', 'fReset']) {
  assert.ok(html.includes('id="' + id + '"'), '必须有筛选控件：' + id);
}
console.log('✓ 2 筛选控件齐备（渠道/模型/仅可信/搜索/重置）');

// ── 3. 明细表列：时间 / 渠道 / 模型 / 积分 / Token / 状态 ────────────────
for (const col of ['时间', '渠道', '模型', '积分', 'Token', '状态']) {
  assert.ok(html.includes('<th>' + col + '</th>') || html.includes('<th class="num">' + col + '</th>'),
    '明细表必须有列：' + col);
}
console.log('✓ 3 明细表 6 列齐备');

// ── 4. 柱状图：SVG + 可点选某天 ──────────────────────────────────────────
assert.ok(html.includes('id="chart"'), '必须有 SVG 图表容器');
assert.ok(html.includes('data-day'), '柱体必须带 data-day 以支持点选过滤');
assert.ok(html.includes('selectedDay'), '必须实现「点柱体筛选当天」状态');
console.log('✓ 4 柱状图可点选过滤当天');

// ── 5. 分页：每页 100 条 ─────────────────────────────────────────────────
assert.ok(/PAGE_SIZE\s*=\s*100/.test(html), '分页大小必须为 100');
assert.ok(html.includes('上一页') && html.includes('下一页'), '必须有分页按钮');
console.log('✓ 5 分页每页 100 条');

// ── 6. 汇总：按渠道 / 按模型 ─────────────────────────────────────────────
assert.ok(html.includes('按渠道汇总'), '必须有按渠道汇总');
assert.ok(html.includes('按模型汇总'), '必须有按模型汇总');
console.log('✓ 6 按渠道 / 按模型汇总齐备');

// ── 7. 可信度语义：可疑记录必须可见 ──────────────────────────────────────
for (const t of ['渠道切换', '账号变化', '已清理', '不可信', '可信']) {
  assert.ok(html.includes(t), '状态标签必须覆盖：' + t);
}
console.log('✓ 7 可疑记录状态标签齐备');

// ── 8. 离线可用：不得引用任何外部资源 ────────────────────────────────────
assert.ok(!/<script[^>]+src=/i.test(html), '不得引用外部 script（离线可用）');
assert.ok(!/<link[^>]+href=["']https?:/i.test(html), '不得引用外部样式表（离线可用）');
assert.ok(!/https?:\/\//i.test(html.replace(/xmlns[^"]*"[^"]*"/g, '')), '不得含任何 http(s) 外链');
console.log('✓ 8 零外部依赖，完全离线可用');

// ── 9. 数据源：读同一份台账接口 ──────────────────────────────────────────
assert.ok(html.includes("'/api/smart-models/usage'"), '必须从台账接口取数');
assert.ok(html.includes('creditsKnown'), '必须区分可信/不可信记录');
console.log('✓ 9 数据源为 /api/smart-models/usage');

// ── 10. 宿主路由注册（index.js）─────────────────────────────────────────
const idx = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
assert.ok(idx.includes("path: '/smart-models'"), 'index.js 必须注册 /smart-models 路由');
assert.ok(idx.includes("kind: 'exact'"), '看板路由必须是 exact（避免吞掉其他路径）');
assert.ok(idx.includes('text/html'), '必须返回 text/html');
assert.ok(idx.includes('PLUGIN_DIR'), '必须用插件目录解析 dashboard 资源（不依赖 cwd）');
assert.ok(idx.includes('fileURLToPath'), '必须用 import.meta.url 推导插件目录');
console.log('✓ 10 宿主路由注册正确');

// ── 11. 打包白名单包含 dashboard ────────────────────────────────────────
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
assert.ok(Array.isArray(pkg.files) && pkg.files.includes('dashboard'),
  'package.json files 必须包含 dashboard（否则发布后看板 404）');
console.log('✓ 11 打包白名单含 dashboard');

// ── 12. 子视图切换（概览/消耗分析/渠道对比/明细）────────────────────────
for (const v of ['overview', 'consume', 'compare', 'detail']) {
  assert.ok(html.includes('data-view="' + v + '"'), '必须有子视图按钮：' + v);
}
console.log('✓ 12 子视图 4 档齐备');

// ── 13. 完整图表系列：堆叠/排行/增减/性价比 ─────────────────────────────
assert.ok(html.includes('id="chartStack"'), '必须有每日消耗堆叠图');
assert.ok(html.includes('id="chartRank"'), '必须有渠道消耗排行图');
assert.ok(html.includes('id="chartDelta"'), '必须有余额增减双向图');
assert.ok(html.includes('byValue'), '必须有性价比表');
assert.ok(html.includes('renderStack') && html.includes('renderRank')
  && html.includes('renderDelta') && html.includes('renderValue'), '四个渲染函数必须存在');
console.log('✓ 13 完整图表系列（堆叠/排行/增减/性价比）');

// ── 14. 免费层级与估算口径必须可见 ─────────────────────────────────────
assert.ok(html.includes('免费层级'), '排行图必须标注免费层级');
assert.ok(html.includes('估算'), '积分必须标注为估算值');
assert.ok(html.includes('消耗率'), '必须有消耗率列');
assert.ok(html.includes('性价比'), '必须有性价比列');
console.log('✓ 14 免费层级 / 估算 / 消耗率 / 性价比 标注齐备');

// ── 15. 免费层级不计积分（client.js 契约）──────────────────────────────
const cli = fs.readFileSync(path.join(ROOT, 'client.js'), 'utf8');
assert.ok(cli.includes('FREE_TIER_PROVIDERS'), '必须有免费层级白名单');
assert.ok(cli.includes('isFreeTierChannel'), '必须有免费层级判定函数');
assert.ok(cli.includes("freeTier: true"), '免费层级事件必须带 freeTier 标记');
assert.ok(cli.includes('priceFactor === 0'), '必须按 priceFactor=0 判定免费');
console.log('✓ 15 免费层级不计积分');

// ── 16. 宿主新增两条只读路由 ────────────────────────────────────────────
const idx2 = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
assert.ok(idx2.includes("'/api/smart-models/token-ledger'"), '必须有 token-ledger 路由');
assert.ok(idx2.includes("'/api/smart-models/pricing'"), '必须有 pricing 路由');
const tlAt = idx2.indexOf("token-ledger'");
const usageAt2 = idx2.indexOf("'/api/smart-models/usage'");
assert.ok(tlAt < usageAt2, 'token-ledger 必须派发在 usage 之前（前缀冲突）');
console.log('✓ 16 token-ledger / pricing 路由就位且顺序正确');

// ── 17. 倍率本地覆盖表（华为云等渠道的显示覆盖）────────────────────────
assert.ok(cli.includes('MULTIPLIER_OVERRIDES'), '必须有倍率覆盖表');
assert.ok(cli.includes('lookupMultiplierOverride'), '必须有覆盖查找函数');
assert.ok(cli.includes('extractMultiplierRaw'), '上游真实取值必须保留为独立函数（覆盖层不得污染它）');
assert.ok(cli.includes('function extractMultiplier('), '必须有覆盖包装函数');

// 覆盖逻辑必须与上游取值分离：包装函数先取 upstream，再决定是否替换
const wrapIdx = cli.indexOf('function extractMultiplier(');
const wrapBody = cli.slice(wrapIdx, wrapIdx + 600);
assert.ok(wrapBody.includes('extractMultiplierRaw'), '包装函数必须调用 raw 版本取上游值');
assert.ok(wrapBody.includes('lookupMultiplierOverride'), '包装函数必须查覆盖表');
assert.ok(wrapBody.includes('if (override === null) return upstream'), '未命中覆盖时必须原样返回上游值');
console.log('✓ 17 倍率覆盖表与上游取值分离，未命中不污染');

// ── 18. 倍率覆盖页：可在设置里增删（不必改代码）──────────────────────
assert.ok(cli.includes('MultiplierOverridePage'), '必须有倍率覆盖设置页');
assert.ok(cli.includes("label: '倍率覆盖'"), '必须注册为设置标签页');
assert.ok(cli.includes('STORAGE_MULTIPLIER_OVERRIDES_KEY'), '用户覆盖必须持久化');
assert.ok(cli.includes('loadMultiplierOverrides'), '必须能读取用户覆盖');
assert.ok(cli.includes('saveMultiplierOverrides'), '必须能保存用户覆盖');
assert.ok(cli.includes('reloadMultiplierOverrides'), '保存后必须重载生效表');
assert.ok(cli.includes('MULTIPLIER_OVERRIDES_BUILTIN'), '内置默认表与用户表必须分离');
console.log('✓ 18 倍率覆盖页可增删且持久化');

console.log('\nALL DASHBOARD TESTS PASSED');
