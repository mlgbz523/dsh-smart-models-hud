import test from 'node:test'
import assert from 'node:assert/strict'

import {
  CAUSE, LEVEL,
  classifyUpstreamMessage,
  subscriptionPlanOf,
  withSubscriptionHint,
  collectModelLimits,
  collectLedgerStats,
  collectFreeLaneStats,
  collectDeadModels,
  collectPassiveSignals,
  formatResetCountdown,
  formatShortDate,
  healthLevelOf,
  localDateKey,
  mergeHealth,
} from '../src/uplink-health.js'

// ─────────────────────────────────────────────────────────────────────────────
// fixture 全部取自本机实测（2026-10-20 00:15）：
//   ~/.dsh/channel-pack/state.json 的 modelRateLimits
//   ~/.dsh/channel-pack/token-ledger.json 的 days 树
//   ~/.dsh/our-free-model/stats.json 的 models / samples
// 用真实数据做断言，避免「测试自己编的数据」这种假绿。
// ─────────────────────────────────────────────────────────────────────────────

const NOW = 1792426247206 // 2026-10-20 00:10 左右，与实测采样同一时刻

const REAL_ACCOUNTS = [
  { id: 'workbuddy-ca52b35a', provider: 'workbuddy', enabled: true, modelRateLimits: { 'deepseek-v4.1-flash': 1792486707000 } },
  { id: 'codearts-e3889cd2', provider: 'codearts', enabled: true, modelRateLimits: { 'deepseek-v4.1-flash': 1792425600000 } },
  { id: 'codearts-58bf3b29', provider: 'codearts', enabled: true },
  { id: 'workbuddy-d161d526', provider: 'workbuddy', enabled: true, modelRateLimits: { 'deepseek-v4.1-flash': 1792404576000 } },
  { id: 'workbuddy-de538f6d', provider: 'workbuddy', enabled: true, modelRateLimits: { 'deepseek-v4.1-flash': 1792407251000 } },
  { id: 'workbuddy-13d4b0a9', provider: 'workbuddy', enabled: true, modelRateLimits: { 'deepseek-v4.1-flash': 1792420024000 } },
  { id: 'workbuddy-165a3357', provider: 'workbuddy', enabled: true, modelRateLimits: { 'deepseek-v4.1-flash': 1792424036000 } },
]

test('collectModelLimits: 真实数据里 workbuddy 只有 1 条未过期标记，不是全池封锁', () => {
  const limits = collectModelLimits({ accounts: REAL_ACCOUNTS, now: NOW })
  const row = limits.workbuddy['deepseek-v4.1-flash']
  // 本机实测：workbuddy 共 5 个账号，其中 4 条的 resetAt 已过期
  assert.equal(row.accounts, 5)
  assert.equal(row.enabledAccounts, 5)
  assert.equal(row.blockedAccounts, 1, '只有 ca52b35a 的 +1006 分钟标记还没过期')
  assert.equal(row.allBlocked, false)
  assert.equal(row.earliestResetAt, 1792486707000)
})

test('collectModelLimits: codearts 唯一标记已过期，整个 provider 不进结果', () => {
  const limits = collectModelLimits({ accounts: REAL_ACCOUNTS, now: NOW })
  // 该条 resetAt=1792425600000 < NOW（已过期）；没有任何未过期限制的 provider
  // 整体不出现在结果里，避免界面渲染一行「0 受限」。
  assert.equal(limits.codearts, undefined)
})

test('collectModelLimits: 全池封锁在 2/2 时成立，且取最早恢复', () => {
  const accounts = [
    { provider: 'x', enabled: true, modelRateLimits: { m: NOW + 60_000 } },
    { provider: 'x', enabled: true, modelRateLimits: { m: NOW + 30_000 } },
  ]
  const row = collectModelLimits({ accounts, now: NOW }).x.m
  assert.equal(row.allBlocked, true)
  assert.equal(row.earliestResetAt, NOW + 30_000)
})

test('collectModelLimits: 停用账号不进分母（否则全池封锁会误报为部分受限）', () => {
  const accounts = [
    { provider: 'x', enabled: true, modelRateLimits: { m: NOW + 1000 } },
    { provider: 'x', enabled: false, modelRateLimits: { m: NOW + 1000 } },
  ]
  const row = collectModelLimits({ accounts, now: NOW }).x.m
  assert.equal(row.accounts, 2)
  assert.equal(row.enabledAccounts, 1)
  // 两个账号都有标记，但停用的那个不该让 allBlocked 判不出来
  assert.equal(row.allBlocked, true)
})

test('collectModelLimits: resetAt=0 是「无限制」哨兵，不统计', () => {
  const accounts = [{ provider: 'x', enabled: true, modelRateLimits: { m: 0 } }]
  assert.equal(collectModelLimits({ accounts, now: NOW }).x, undefined)
})

test('collectModelLimits: 空/畸形输入不抛', () => {
  assert.deepEqual(collectModelLimits({}), {})
  assert.deepEqual(collectModelLimits({ accounts: null }), {})
  assert.deepEqual(collectModelLimits({ accounts: [null, 1, 'x', { provider: '' }] }), {})
  assert.deepEqual(collectModelLimits({ accounts: [{ provider: 'p', modelRateLimits: 'oops' }] }), {})
})

test('collectLedgerStats: 四段 key 正确拆出 provider/model，段数不符跳过', () => {
  const ledger = {
    days: {
      '2026-10-19': {
        'direct|codearts|codearts-e3889cd2|deepseek-v4.1-flash': {
          requests: 90, errors: 11, ttftSumMs: 3483000, ttftCount: 90,
        },
        'direct|codearts|codearts-e3889cd2|deepseek-v4-pro': {
          requests: 3, errors: 3, ttftSumMs: 0, ttftCount: 0,
        },
        'garbage-key': { requests: 1, errors: 0 },
        'a|b|c|d|e': { requests: 1, errors: 0 },
      },
    },
  }
  const out = collectLedgerStats(ledger)
  assert.deepEqual(out.codearts['deepseek-v4.1-flash'], { requests: 90, errors: 11, ttftMs: 3483000, ttftCount: 90 })
  assert.deepEqual(out.codearts['deepseek-v4-pro'], { requests: 3, errors: 3, ttftMs: 0, ttftCount: 0 })
  assert.equal(Object.keys(out).length, 1, 'garbage-key 与五段 key 都不该产生 provider')
})

test('collectLedgerStats: 跨天累加', () => {
  const ledger = { days: {
    '2026-10-18': { 'direct|p|a|m': { requests: 2, errors: 1, ttftSumMs: 1000, ttftCount: 2 } },
    '2026-10-19': { 'direct|p|a|m': { requests: 3, errors: 0, ttftSumMs: 2000, ttftCount: 3 } },
  } }
  const row = collectLedgerStats(ledger).p.m
  assert.equal(row.requests, 5)
  assert.equal(row.errors, 1)
  assert.equal(row.ttftCount, 5)
})

test('collectFreeLaneStats: 失败样本只取 ok===false 的最大 at', () => {
  const stats = {
    models: { 'm1': { calls: 64, failed: 4 } },
    samples: [
      { at: 100, model: 'm1', ok: false },
      { at: 300, model: 'm1', ok: false },
      { at: 200, model: 'm1', ok: true },
    ],
  }
  const out = collectFreeLaneStats(stats)
  assert.equal(out.m1.calls, 64)
  assert.equal(out.m1.failed, 4)
  assert.equal(out.m1.lastErrorAt, 300)
})

test('collectDeadModels: 文件缺失/结构异常返回空', () => {
  assert.deepEqual(collectDeadModels(undefined), {})
  assert.deepEqual(collectDeadModels({}), {})
  assert.deepEqual(collectDeadModels({ providers: null }), {})
  const out = collectDeadModels({ providers: { p: { m: { at: '2026-10-01T00:00:00Z', reason: 'model not found' } } } })
  assert.equal(out.p.m.reason, 'model not found')
})

test('classifyUpstreamMessage: 六类文案', () => {
  assert.equal(classifyUpstreamMessage('codearts: Invalid model.'), CAUSE.invalidModel)
  assert.equal(classifyUpstreamMessage('ModelArts.81009 Invalid model.'), CAUSE.invalidModel)
  assert.equal(classifyUpstreamMessage('model not found'), CAUSE.invalidModel)
  assert.equal(classifyUpstreamMessage('模型 x 不存在'), CAUSE.invalidModel)
  assert.equal(classifyUpstreamMessage('benefit 免费额度已用尽'), CAUSE.quotaExhausted)
  assert.equal(classifyUpstreamMessage('insufficient quota'), CAUSE.quotaExhausted)
  assert.equal(classifyUpstreamMessage('TM.00001041 peak usage'), CAUSE.queue)
  assert.equal(classifyUpstreamMessage('InferHub.ModelArts.81111.429 TPM 超限'), CAUSE.queue)
  assert.equal(classifyUpstreamMessage('APIG.0602 invalid token'), CAUSE.auth)
  assert.equal(classifyUpstreamMessage('HTTP 401'), CAUSE.auth)
  assert.equal(classifyUpstreamMessage('当前账号被服务端安全策略拦截'), CAUSE.policyBlock)
  assert.equal(classifyUpstreamMessage('HTTP 429'), CAUSE.rateLimited)
  assert.equal(classifyUpstreamMessage(''), CAUSE.unknown)
  assert.equal(classifyUpstreamMessage(null), CAUSE.unknown)
})

test('classifyUpstreamMessage: 认证优先于模型（登录过期不该报成模型不存在）', () => {
  // 真实上游会把 "Invalid token" 与 "model" 写在同一句里
  assert.equal(classifyUpstreamMessage('Invalid token for model deepseek-v4-pro'), CAUSE.auth)
})

test('healthLevelOf: 全池受限 > 失效表 > 部分受限 > 错误率 > ok', () => {
  const now = NOW
  assert.equal(healthLevelOf({ allBlocked: true, earliestResetAt: now + 3_600_000 }, now).level, LEVEL.blocked)
  assert.equal(healthLevelOf({ dead: { at: '2026-10-01T00:00:00Z' } }, now).level, LEVEL.blocked)
  assert.equal(healthLevelOf({ blockedAccounts: 1, enabledAccounts: 6, earliestResetAt: now + 3_600_000 }, now).level, LEVEL.degraded)
  assert.equal(healthLevelOf({ requests: 10, errors: 6 }, now).level, LEVEL.degraded)
  assert.equal(healthLevelOf({ requests: 10, errors: 1 }, now).level, LEVEL.ok)
  assert.equal(healthLevelOf({ requests: 2, errors: 2 }, now).level, LEVEL.ok, '样本不足不判')
})

test('healthLevelOf: 用户主动关闭返回 unknown 而不是 blocked（关闭不等于坏了）', () => {
  const verdict = healthLevelOf({ disabled: true }, NOW)
  assert.equal(verdict.level, LEVEL.unknown)
  assert.match(verdict.reason, /关闭/)
})

test('healthLevelOf: 原因文案带恢复倒计时', () => {
  const verdict = healthLevelOf({ blockedAccounts: 1, enabledAccounts: 6, earliestResetAt: NOW + 1006 * 60_000 }, NOW)
  assert.match(verdict.reason, /1\/6 个账号受限/)
  assert.match(verdict.reason, /16 小时/)
})

test('formatResetCountdown: 边界', () => {
  assert.equal(formatResetCountdown(-1), '已过期')
  assert.equal(formatResetCountdown(0), '已过期')
  assert.equal(formatResetCountdown(30_000), '不到 1 分钟')
  assert.equal(formatResetCountdown(38 * 60_000), '38 分钟')
  assert.equal(formatResetCountdown(3_600_000), '1 小时')
  assert.equal(formatResetCountdown(1006 * 60_000), '16 小时 46 分')
  assert.equal(formatResetCountdown(26 * 3_600_000), '1 天 2 小时')
  assert.equal(formatResetCountdown(null), '')
  assert.equal(formatResetCountdown(NaN), '')
})

test('formatShortDate: 解析失败原样返回', () => {
  assert.equal(formatShortDate('not-a-date'), 'not-a-date')
  assert.equal(formatShortDate(''), '')
  assert.match(formatShortDate('2026-10-19T15:41:00.000Z'), /^10-19 \d{2}:\d{2}$/)
})

test('localDateKey: 本地自然日', () => {
  const ms = new Date(2026, 9, 20, 0, 15).getTime()
  assert.equal(localDateKey(ms), '2026-10-20')
})

test('collectPassiveSignals: 真实三源合并，codearts/v4-pro 被台账标为高失败率', () => {
  const state = { accounts: REAL_ACCOUNTS, disabledModels: { qoder: { auto: true } } }
  const ledger = { days: { '2026-10-19': {
    'direct|codearts|codearts-e3889cd2|deepseek-v4.1-flash': { requests: 90, errors: 11, ttftSumMs: 3483000, ttftCount: 90 },
    'direct|codearts|codearts-e3889cd2|deepseek-v4-pro': { requests: 3, errors: 3, ttftSumMs: 0, ttftCount: 0 },
  } } }
  const out = collectPassiveSignals({ state, ledger, now: NOW })

  const codearts = out.providers.codearts
  assert.equal(codearts.accounts, 2)
  assert.equal(codearts.enabledAccounts, 2)
  // v4-pro：3 次全失败 → 50%+ → degraded
  assert.equal(codearts.models['deepseek-v4-pro'].level, LEVEL.degraded)
  assert.match(codearts.models['deepseek-v4-pro'].reason, /失败率 100%/)
  // v4.1-flash：90 次 11 错 = 12% → ok（错误率不到 50%）
  assert.equal(codearts.models['deepseek-v4.1-flash'].level, LEVEL.ok)

  // workbuddy 的 v4.1-flash 有 1 条未过期标记 → degraded
  const wb = out.providers.workbuddy.models['deepseek-v4.1-flash']
  assert.equal(wb.level, LEVEL.degraded)
  assert.equal(wb.blockedAccounts, 1)

  // 用户关闭但没有其它信号的模型：不进 models（避免 16 行噪声），只计数
  assert.equal(out.providers.qoder.models.auto, undefined)
  assert.equal(out.providers.qoder.disabledModels, 1)
})

test('collectPassiveSignals: 空输入产出空 providers 且不抛', () => {
  const out = collectPassiveSignals({ now: NOW })
  assert.deepEqual(out.providers, {})
  assert.equal(out.checkedAt, NOW)
  assert.equal(out.checkin, null)
})

test('collectPassiveSignals: 签到状态判定今天', () => {
  const now = new Date(2026, 9, 20, 10, 0).getTime()
  const out = collectPassiveSignals({
    autoCheckin: { enabled: true, lastDate: '2026-10-20', lastAt: now - 3_600_000, lastResult: '8 个渠道：10 个账号领取成功（+3100积分）' },
    now,
  })
  assert.equal(out.checkin.isToday, true)
  assert.equal(out.checkin.enabled, true)
  assert.match(out.checkin.result, /3100/)
})

test('mergeHealth: 主动结果只覆盖测过的模型', () => {
  const passive = collectPassiveSignals({
    state: { accounts: REAL_ACCOUNTS },
    ledger: { days: { d: {
      'direct|codearts|a|m1': { requests: 5, errors: 5 },
      'direct|codearts|a|m2': { requests: 5, errors: 5 },
    } } },
    now: NOW,
  })
  const merged = mergeHealth(passive, {
    codearts: { m1: { ok: true, at: NOW } },
  })
  assert.equal(merged.providers.codearts.models.m1.level, LEVEL.ok)
  assert.match(merged.providers.codearts.models.m1.reason, /主动探活通过/)
  // m2 没被测，保持被动结论
  assert.equal(merged.providers.codearts.models.m2.level, LEVEL.degraded)
})

test('mergeHealth: 主动失败覆盖为 blocked 并带原因', () => {
  const passive = collectPassiveSignals({ state: { accounts: REAL_ACCOUNTS }, now: NOW })
  const merged = mergeHealth(passive, {
    workbuddy: { 'deepseek-v4.1-flash': { ok: false, message: 'codearts: Invalid model.', at: NOW } },
  })
  const row = merged.providers.workbuddy.models['deepseek-v4.1-flash']
  assert.equal(row.level, LEVEL.blocked)
  assert.match(row.reason, /Invalid model/)
})


// ── 会员/订阅墙 ───────────────────────────────────────────────────────────

test('classifyUpstreamMessage: 订阅墙独立于额度（充值无效）', () => {
  assert.equal(classifyUpstreamMessage('This model requires a Cline Pass subscription'), CAUSE.subscriptionRequired)
  assert.equal(classifyUpstreamMessage('You do not have an active subscription to use this model'), CAUSE.subscriptionRequired)
  assert.equal(classifyUpstreamMessage('Upgrade to Pro to use this model'), CAUSE.subscriptionRequired)
  assert.equal(classifyUpstreamMessage('plan required'), CAUSE.subscriptionRequired)
  assert.equal(classifyUpstreamMessage('需要开通会员才能使用该模型'), CAUSE.subscriptionRequired)
  // 额度类仍归额度，不被订阅分支吞掉
  assert.equal(classifyUpstreamMessage('402 Insufficient credits'), CAUSE.quotaExhausted)
  assert.equal(classifyUpstreamMessage('HTTP 402'), CAUSE.quotaExhausted)
})

test('subscriptionPlanOf: 只认确凿的命名空间前缀，不做猜测', () => {
  const plan = subscriptionPlanOf('cline-pass/anthropic/claude-sonnet-5')
  assert.equal(plan.plan, 'cline-pass')
  assert.match(plan.hint, /开通会员/)
  // 免费池不是订阅墙
  assert.equal(subscriptionPlanOf('cline-free/mimo-v2.6-flash'), null)
  // 没有前缀的普通模型一律 null —— isFree:false 不等于「要开会员」
  assert.equal(subscriptionPlanOf('deepseek-v4.1-flash'), null)
  assert.equal(subscriptionPlanOf('stealth/space-bunny-alpha'), null)
  assert.equal(subscriptionPlanOf(''), null)
  assert.equal(subscriptionPlanOf(null), null)
})

test('withSubscriptionHint: 订阅墙不改变等级，但优先解释原因', () => {
  const plan = subscriptionPlanOf('cline-pass/x')
  const ok = withSubscriptionHint({ level: LEVEL.ok, reason: '' }, plan)
  assert.equal(ok.level, LEVEL.ok)
  assert.equal(ok.subscription.plan, 'cline-pass')
  assert.match(ok.reason, /开通会员/)

  const degraded = withSubscriptionHint({ level: LEVEL.degraded, reason: '失败率 100%（3/3）' }, plan)
  assert.equal(degraded.level, LEVEL.degraded, '等级不变：订阅墙不是临时状态')
  assert.match(degraded.reason, /开通会员/)
  assert.match(degraded.reason, /失败率 100%/)

  const plain = { level: LEVEL.ok, reason: '' }
  assert.equal(withSubscriptionHint(plain, null), plain)
})

test('collectPassiveSignals: cline-pass 模型带 subscription 标记', () => {
  const out = collectPassiveSignals({
    state: { accounts: [{ provider: 'cline', enabled: true }] },
    ledger: { days: { d: {
      'direct|cline|a|cline-pass/anthropic/claude-sonnet-5': { requests: 4, errors: 4 },
      'direct|cline|a|cline-free/mimo-v2.6-flash': { requests: 4, errors: 0 },
    } } },
    now: NOW,
  })
  const paid = out.providers.cline.models['cline-pass/anthropic/claude-sonnet-5']
  assert.equal(paid.subscription.plan, 'cline-pass')
  assert.match(paid.reason, /开通会员/)
  const free = out.providers.cline.models['cline-free/mimo-v2.6-flash']
  assert.equal(free.subscription, undefined)
})

// ── [A] 结论来源标记：本机快照 vs 上游权威 ────────────────────────────────
test('A1: 全池受限标 snapshot=true（恢复时刻可能是本地推算）', () => {
  const v = healthLevelOf({ allBlocked: true, blockedAccounts: 2, enabledAccounts: 2, earliestResetAt: NOW + 3600_000 }, NOW)
  assert.equal(v.level, LEVEL.blocked)
  assert.equal(v.snapshot, true, '限流标记来自本机，必须标记为快照')
})

test('A2: 部分账号受限标 snapshot=true', () => {
  const v = healthLevelOf({ allBlocked: false, blockedAccounts: 1, enabledAccounts: 2, earliestResetAt: NOW + 3600_000 }, NOW)
  assert.equal(v.level, LEVEL.degraded)
  assert.equal(v.snapshot, true)
})

test('A3: 上游判定失效标 snapshot=false（权威结论，不是快照）', () => {
  const v = healthLevelOf({ dead: { at: new Date(NOW).toISOString(), reason: 'Invalid model.' } }, NOW)
  assert.equal(v.level, LEVEL.blocked)
  assert.equal(v.snapshot, false, '失效表来自上游文案分类，是权威判定')
})

test('A4: 正常模型不带 snapshot 字段', () => {
  const v = healthLevelOf({ requests: 5, errors: 0 }, NOW)
  assert.equal(v.level, LEVEL.ok)
  assert.equal(v.snapshot, undefined)
})

test('A5: snapshot 必须透传到最终的 provider×model 行（不能被展开时丢掉）', () => {
  const out = collectPassiveSignals({
    state: { accounts: [{ id: 'a1', provider: 'codearts', nickname: 'a1', enabled: true,
      modelRateLimits: { 'glm-5.3': NOW + 3600_000 } }] },
    now: NOW,
  })
  const row = out.providers.codearts.models['glm-5.3']
  assert.equal(row.level, LEVEL.blocked)
  assert.equal(row.snapshot, true, 'snapshot 必须随行下发，否则界面无从区分来源')
})

// ── [B] 已过期标记必须被忽略（与调度层 getAvailableAccount 保持一致）──────
test('B1: resetAt 在过去的标记一律不算受限（collectModelLimits 过滤）', () => {
  const out = collectModelLimits({
    accounts: [{ id: 'a1', provider: 'codearts', enabled: true, modelRateLimits: { 'glm-5.3': NOW - 1000 } }],
    now: NOW,
  })
  assert.deepEqual(out, {}, '过期标记不得进入统计（否则界面会长期误报不可用）')
})

test('B2: resetAt 在未来才计入受限', () => {
  const out = collectModelLimits({
    accounts: [{ id: 'a1', provider: 'codearts', enabled: true, modelRateLimits: { 'glm-5.3': NOW + 1000 } }],
    now: NOW,
  })
  // 注意结构：collectModelLimits 返回 provider → modelId → 行（不是 provider.models）
  const row = out.codearts['glm-5.3']
  assert.equal(row.blockedAccounts, 1)
  assert.equal(row.allBlocked, true)
})

test('B3: resetAt=0 视为「无限制」不计入（与池的哨兵语义一致）', () => {
  const out = collectModelLimits({
    accounts: [{ id: 'a1', provider: 'codearts', enabled: true, modelRateLimits: { 'glm-5.3': 0 } }],
    now: NOW,
  })
  assert.deepEqual(out, {}, '0 是「无限期/无限制」哨兵，不得当成受限')
})

test('mergeHealth: 空 active 不改变结论（返回等价副本）', () => {
  const passive = collectPassiveSignals({ state: { accounts: REAL_ACCOUNTS }, now: NOW })
  assert.equal(mergeHealth(passive, null), passive, 'null 直接返回原对象')
  assert.deepEqual(mergeHealth(passive, {}).providers, passive.providers, '{} 返回等价副本')
})
