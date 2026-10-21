/**
 * 上行自检的纯函数核心。
 *
 * ## 为什么需要它
 *
 * `channel-pack` 早就把「模型级限制」落盘了 —— `state.json` 每个账号带
 * `modelRateLimits: { [modelId]: resetAtMs }`，写入点覆盖配额耗尽、429 限流、
 * 安全策略拦截（+30 分钟）与队列饱和共 11 处。但这份数据**只被账号池内部消费**
 * （`getAvailableAccount` 拿它过滤候选），选择器完全不知道：用户仍能选中一个
 * 「所有账号都受限」的模型，选中即失败，而且失败原因要等聊天区吐红字才看得见。
 *
 * 所以本模块的定位是：**把已经存在的离线信号读出来、归好类、算成可展示的结论**。
 * 它不发任何网络请求、不写任何文件、不依赖 React —— 纯函数，便于用真实数据做
 * fixture 单测（见 `test/uplink-health.test.mjs`）。
 *
 * ## 为什么「模型级限制」优先于「额度」
 *
 * 额度是账号级的（一个账号有多少积分），限制是 **(账号 × 模型) 二元组** 的。
 * 同一个账号可以对这个模型受限、对那个模型正常；同一个模型可以在 5 个账号里
 * 有 4 个受限。只报「额度耗尽」会把「换一个模型就能跑」误报成「没额度了」，
 * 这是两种完全不同的处置（换模型 vs 领积分/换渠道）。
 *
 * @module src/uplink-health.js
 */

/** 状态等级。与选择器里的状态点颜色一一对应。 */
export const LEVEL = {
  ok: 'ok',
  degraded: 'degraded',
  blocked: 'blocked',
  unknown: 'unknown',
}

/** 文案归类。顺序即优先级：越靠前越具体。 */
export const CAUSE = {
  modelLimit: 'model-limit',
  invalidModel: 'invalid-model',
  /**
   * 需要开通会员/订阅才能用的模型。
   *
   * ⚠️ 与 {@link CAUSE.quotaExhausted} 必须分开：两者在用户眼里都是「用不了」，
   * 但处置相反 —— 充值/等重置对订阅墙**完全无效**，只能升级套餐或换渠道。
   * 混为一谈会让人反复充钱却始终用不了。
   */
  subscriptionRequired: 'subscription-required',
  quotaExhausted: 'quota-exhausted',
  queue: 'queue',
  rateLimited: 'rate-limited',
  auth: 'auth',
  policyBlock: 'policy-block',
  unknown: 'unknown',
}

/**
 * 文案 → 归类。以本机实测到的上游原文为准，不做同义词联想。
 *
 * 依据（全部来自 vendor/channel-pack/pack.js 与本机日志）：
 * - `Invalid model.` 是华为云 MaaS 的 404 `ModelArts.81009`（错误码文档原文），
 *   插件在 33462 以 `{ status: 200 }` 抛出（HTTP 200 + SSE 内嵌错误）。
 * - `benefit 已用尽` 由 32755 生成；`isSseQuotaExhaustedErrorCode`（32767）
 *   认 `4291` 前缀与 `insufficient quota`。
 * - `TM.00001041` / `81111` / `TPM` 由 `isSseQueueErrorCode`（32764）与
 *   `isQueueError`（32757）认作排队/限流。
 * - `APIG.0602` / `invalid token` 由 `isAuthError`（32760）认作认证失败。
 * - 安全策略拦截由 `contentRejectionError`（34761）产生，冷却 30 分钟（34760）。
 *
 * @param {unknown} message
 * @returns {string} {@link CAUSE} 之一
 */
export function classifyUpstreamMessage(message) {
  const text = typeof message === 'string' ? message : String(message ?? '')
  if (text.length === 0) return CAUSE.unknown
  const lower = text.toLowerCase()

  // 认证类先判：它的文案里常同时出现 "invalid" 与 "model"，先判模型会把登录过期
  // 误报成「模型不存在」。
  if (/\b401\b|\b403\b|apig\.0602|invalid[\s_-]+token|token[\s_-]+(?:expired|is[\s_-]+invalid)|未登录|鉴权|凭据/.test(lower)) {
    return CAUSE.auth
  }
  // 安全策略拦截：与额度无关，冷却只有 30 分钟，处置是「换账号」而不是「充值」。
  if (/安全策略|content[\s_-]*(?:rejection|policy)|content[\s_-]*filter|风险内容|敏感信息/.test(lower)) {
    return CAUSE.policyBlock
  }
  // 模型不存在 / 未开通。`Invalid model.` 与 `ModelArts.81009` 是同一个错误的
  // 两种表述（前者是 message，后者是 error_code），必须同时认。
  if (/invalid[\s_-]*model|modelarts\.81009|not[\s_-]+available[\s_-]+with[\s_-]+api[\s_-]+url|model[\s_-]+not[\s_-]+found|no[\s_-]+such[\s_-]+model|unknown[\s_-]+model|模型[^。；]{0,20}不存在|模型[^。；]{0,20}未上线|已下线/.test(lower)) {
    return CAUSE.invalidModel
  }
  // 会员/订阅墙：**必须排在额度之前**。它和「额度用完」在用户看来都是
  // 「用不了」，但处置相反 —— 充值、等重置、换账号全都无效，只能升级套餐
  // 或换渠道。典型形态：
  //   - Cline 的 cline-pass 通道（pack.js:41521 把 models.dev 的模型补成
  //     `cline-pass/<id>`，41553 明确 `isFree: false`）
  //   - 各家 402/403 伴随 "requires subscription" / "upgrade to Pro"
  //   - 中文「需开通会员」「订阅专属」
  if (
    /requires?\b[^.;!?]{0,60}?\b(?:subscription|plan|membership)\b|\b(?:subscription|plan)\b[^.;!?]{0,20}?\brequired\b|subscription[\s_-]+only|\bnot[\s_-]+subscribed\b|upgrade[\s_-]+(?:to|your)\b[^.;!?]{0,20}?(?:pro|plus|premium|plan|tier)|premium[\s_-]+only|paid[\s_-]+(?:plan|tier)[\s_-]+only|(?:do|does|did)\s+not\s+have\b[^.;!?]{0,40}?\bsubscription\b|\bno\s+(?:active\s+)?subscription\b|会员|订阅[^。；]{0,10}(?:才能|才可|专属|有效)|开通[^。；]{0,8}(?:会员|套餐)/.test(lower)
  ) {
    return CAUSE.subscriptionRequired
  }
  // 额度：优先于限流判，因为「额度用尽」文案里也可能带 429。
  if (/insufficient[\s_-]+(?:quota|credit|fund|balance)|quota[\s_-]*(?:exceeded|exhaust)|benefit[^。]{0,20}(?:用尽|耗尽)|额度[^。]{0,10}(?:用尽|耗尽|已用完)|积分[^。]{0,10}(?:用尽|耗尽|不足)|余额不足|4291|\b402\b|payment[\s_-]+required/.test(lower)) {
    return CAUSE.quotaExhausted
  }
  // 排队 / 限流 / 模型繁忙。
  if (/tm\.00001041|81111|\btpm\b|peak[\s_-]*(?:usage|hours)|high[\s_-]+demand|too[\s_-]+many[\s_-]+requests|rate[\s_-]*limit|排队|限流|模型繁忙|请求量饱和|10605/.test(lower)) {
    return CAUSE.queue
  }
  if (/\b429\b/.test(lower)) return CAUSE.rateLimited
  return CAUSE.unknown
}


/**
 * 从模型 id / 名称判定「这是订阅/会员通道的模型」。
 *
 * ## 为什么这是**离线可判**的
 *
 * 各家订阅通道在模型 id 上留下了命名空间前缀，插件把远端目录原样播报：
 * - Cline 的付费通道是 `cline-pass/<id>`（pack.js:41521 由 models.dev 补入，
 *   41553 显式 `isFree: false`；`cline-free/<id>` 才是免费池，41287）；
 * - 其余 provider 目前没有同类前缀，因此**不做猜测** —— 宁可判不出来，
 *   也不要把一个免费模型标成「要开会员」。
 *
 * ## 为什么不能只靠 isFree === false
 *
 * `isFree: false` 只说明「不是免费」，按量计费的模型同样是 false。
 * 把两者混为一谈会让每个付费模型都挂上「需开通会员」的假标签。
 *
 * @param {unknown} modelId
 * @returns {{ plan: string, hint: string } | null}
 */
export function subscriptionPlanOf(modelId) {
  const id = typeof modelId === 'string' ? modelId.trim() : ''
  if (id === '') return null
  const lower = id.toLowerCase()
  if (lower.startsWith('cline-pass/')) {
    return {
      plan: 'cline-pass',
      hint: '该模型属于 Cline 的订阅通道（cline-pass），需在 Cline 开通会员才能调用；充值积分或换账号都无效。',
    }
  }
  return null
}

/**
 * 把一个模型的「订阅墙」判定合进健康结论。
 *
 * 订阅墙与「额度/限制」是**并列**的第三条路：它不是这个账号此刻的状态，
 * 而是这个模型在这个渠道上的**准入条件**。因此它不参与 blocked/degraded 的
 * 等级判定（那两者会随时间恢复），而是作为独立标记透出，由界面单独说明。
 *
 * @param {{ level: string, reason: string }} verdict
 * @param {{ plan: string, hint: string } | null} plan
 */
export function withSubscriptionHint(verdict, plan) {
  if (plan === null) return verdict
  return {
    ...verdict,
    subscription: plan,
    // 订阅墙优先解释：用户看到「需开通会员」比看到「失败率 100%」更有用。
    reason: verdict.reason === '' ? plan.hint : `${plan.hint}（当前：${verdict.reason}）`,
  }
}

/**
 * 把「账号 × 模型」的限制标记聚合成「provider × 模型」的可用性结论。
 *
 * ## 为什么只统计 **启用** 账号
 *
 * `getAvailableAccount`（pack.js:30839）的过滤链是
 * `provider === p && enabled` 再按 `modelRateLimits` 剔除。停用账号本来就不参与
 * 自动选择，把它算进分母会让「2 个账号全受限」在停用一个后变成「1/2 受限」，
 * 结论从「这个模型现在完全不能用」退化成「还有一半机会」—— 正好相反。
 * 因此 `enabledAccounts` 是分母，`allBlocked` 也只在启用账号里判定；
 * 停用账号的标记仍然计数（`blockedAccounts`），但只作为附加信息。
 *
 * ## 已过期的标记不算受限
 *
 * 标记只是「上次 429 时的快照」，服务端常在重置时间之前就放行。把过期的标记
 * 继续当受限，会把一个现在能用的模型标红 —— 这正是「重测」按钮存在的原因
 * （pack.js:61470-61472 的注释说明了同一件事）。
 *
 * @param {{ accounts?: unknown[], now?: number }} input
 * @returns {Record<string, Record<string, {
 *   accounts: number, enabledAccounts: number, blockedAccounts: number,
 *   allBlocked: boolean, earliestResetAt: number|null,
 * }>>}
 */
export function collectModelLimits({ accounts, now = Date.now() } = {}) {
  const list = Array.isArray(accounts) ? accounts : []
  /** @type {Map<string, { total: number, enabled: number, models: Map<string, { blocked: number, earliest: number|null }> }>} */
  const byProvider = new Map()

  for (const account of list) {
    if (account === null || typeof account !== 'object') continue
    const provider = typeof account.provider === 'string' ? account.provider : ''
    if (provider === '') continue
    const bucket = byProvider.get(provider) ?? { total: 0, enabled: 0, models: new Map() }
    bucket.total += 1
    if (account.enabled !== false) bucket.enabled += 1
    byProvider.set(provider, bucket)

    const limits = account.modelRateLimits
    if (limits === null || typeof limits !== 'object') continue
    for (const [modelId, resetAtRaw] of Object.entries(limits)) {
      if (typeof modelId !== 'string' || modelId === '') continue
      const resetAt = Number(resetAtRaw)
      // 非法时间戳跳过：`0` 在池里是「无限期」的哨兵（30843 把它当已到期处理），
      // 这里保持一致 —— 0 视为「无限制」，不进入统计。
      if (!Number.isFinite(resetAt) || resetAt <= 0) continue
      if (resetAt <= now) continue
      const row = bucket.models.get(modelId) ?? { blocked: 0, earliest: null }
      row.blocked += 1
      row.earliest = row.earliest === null ? resetAt : Math.min(row.earliest, resetAt)
      bucket.models.set(modelId, row)
    }
  }

  const out = {}
  for (const [provider, bucket] of byProvider) {
    const models = {}
    for (const [modelId, row] of bucket.models) {
      models[modelId] = {
        accounts: bucket.total,
        enabledAccounts: bucket.enabled,
        blockedAccounts: row.blocked,
        allBlocked: bucket.enabled > 0 && row.blocked >= bucket.enabled,
        earliestResetAt: row.earliest,
      }
    }
    // 没有任何**未过期**限制的 provider 不进结果：它的存在只会让调用方
    // 多渲染一行「0 受限」，与「没有这条信息」是同一件事。
    if (Object.keys(models).length > 0) out[provider] = models
  }
  return out
}

/**
 * 把 `token-ledger.json` 的 `days` 树压平成 `provider → model` 的请求/错误计数。
 *
 * 台账的 key 形如 `direct|codearts|codearts-e3889cd2|deepseek-v4.1-flash`，
 * 四段：调用方式 | provider | 账号 | 模型。段数不符的直接跳过（台账是本插件
 * 之外的第三方写的，不能假设格式永远不变）。
 *
 * @param {unknown} ledger
 * @returns {Record<string, Record<string, { requests: number, errors: number, ttftMs: number, ttftCount: number }>>}
 */
export function collectLedgerStats(ledger) {
  const out = {}
  const days = ledger?.days
  if (days === null || typeof days !== 'object') return out
  for (const rows of Object.values(days)) {
    if (rows === null || typeof rows !== 'object') continue
    for (const [key, value] of Object.entries(rows)) {
      if (value === null || typeof value !== 'object') continue
      const parts = String(key).split('|')
      if (parts.length !== 4) continue
      const provider = parts[1]
      const model = parts[3]
      if (provider === '' || model === '') continue
      const byModel = out[provider] ?? (out[provider] = {})
      const row = byModel[model] ?? (byModel[model] = { requests: 0, errors: 0, ttftMs: 0, ttftCount: 0 })
      row.requests += Number(value.requests) || 0
      row.errors += Number(value.errors) || 0
      const ttftSum = Number(value.ttftSumMs)
      const ttftCount = Number(value.ttftCount)
      if (Number.isFinite(ttftSum) && Number.isFinite(ttftCount) && ttftCount > 0) {
        row.ttftMs += ttftSum
        row.ttftCount += ttftCount
      }
    }
  }
  return out
}

/**
 * 从免费车道统计里取每模型的失败数与末次失败时间。
 *
 * `stats.json` 的 `samples` 只在**失败时**可能带 `error` 字段；本机实测的失败样本
 * 是「用户中止」（`aborted: true`）而非上游拒绝，因此 `lastErrorAt` 允许为空 ——
 * 不能把「没有错误文案」当成「没有错误」。
 *
 * @param {unknown} stats
 * @returns {Record<string, { calls: number, failed: number, lastErrorAt: number|null }>}
 */
export function collectFreeLaneStats(stats) {
  const out = {}
  const models = stats?.models
  if (models !== null && typeof models === 'object') {
    for (const [model, value] of Object.entries(models)) {
      if (value === null || typeof value !== 'object') continue
      out[model] = {
        calls: Number(value.calls) || 0,
        failed: Number(value.failed) || 0,
        lastErrorAt: null,
      }
    }
  }
  const samples = Array.isArray(stats?.samples) ? stats.samples : []
  for (const sample of samples) {
    if (sample === null || typeof sample !== 'object') continue
    if (sample.ok !== false) continue
    const model = typeof sample.model === 'string' ? sample.model : ''
    if (model === '') continue
    const row = out[model] ?? (out[model] = { calls: 0, failed: 0, lastErrorAt: null })
    const at = Number(sample.at)
    if (Number.isFinite(at) && (row.lastErrorAt === null || at > row.lastErrorAt)) row.lastErrorAt = at
  }
  return out
}

/**
 * 取 `dead-models.json` 里的失效记录（provider → model → 记录）。
 *
 * 注意这份表**在本机可能根本不存在**：它的写入依赖 `isModelGoneError` 认出
 * 「模型已下线」的文案，而 `Invalid model.` 不在 `GONE_PATTERNS`（31827）里 ——
 * 这正是上游缺陷 A。文件不存在不是异常，是当前事实。
 *
 * @param {unknown} deadModels
 */
export function collectDeadModels(deadModels) {
  const out = {}
  const providers = deadModels?.providers
  if (providers === null || typeof providers !== 'object') return out
  for (const [provider, entries] of Object.entries(providers)) {
    if (entries === null || typeof entries !== 'object') continue
    const bucket = out[provider] ?? (out[provider] = {})
    for (const [model, meta] of Object.entries(entries)) {
      if (meta === null || typeof meta !== 'object') continue
      bucket[model] = {
        at: typeof meta.at === 'string' ? meta.at : '',
        reason: typeof meta.reason === 'string' ? meta.reason : '',
      }
    }
  }
  return out
}

/**
 * 时长 → 人话。用于「最早 X 后恢复」。
 *
 * @param {number|null|undefined} ms 正数表示还剩多久；非正数表示已过期
 */
export function formatResetCountdown(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return ''
  if (ms <= 0) return '已过期'
  // 向下取整：30 秒不能被说成「1 分钟」——「不到 1 分钟」才是事实。
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return '不到 1 分钟'
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours < 24) return rest === 0 ? `${hours} 小时` : `${hours} 小时 ${rest} 分`
  const days = Math.floor(hours / 24)
  const restHours = hours % 24
  return restHours === 0 ? `${days} 天` : `${days} 天 ${restHours} 小时`
}

/**
 * 单模型的健康等级与一句话原因。
 *
 * 判据优先级（从「确定不能用」到「确定能用」）：
 * 1. 全池受限 → blocked
 * 2. 已进失效表（上游说过「这个模型不存在」）→ blocked
 * 3. 用户主动关闭 → 不参与（返回 unknown，界面上单独显示为「已关闭」）
 * 4. 部分账号受限 → degraded
 * 5. 有错误历史 → degraded
 * 6. 其余 → ok
 *
 * @param {{ allBlocked?: boolean, blockedAccounts?: number, earliestResetAt?: number|null,
 *   dead?: { at?: string, reason?: string }|null, disabled?: boolean,
 *   requests?: number, errors?: number, lastErrorAt?: number|null }} entry
 * @param {number} now
 * @returns {{ level: string, reason: string }}
 */
export function healthLevelOf(entry, now = Date.now()) {
  if (entry === null || typeof entry !== 'object') return { level: LEVEL.unknown, reason: '' }
  if (entry.disabled === true) return { level: LEVEL.unknown, reason: '已在渠道包中关闭' }
  if (entry.dead) {
    const at = entry.dead.at ? formatShortDate(entry.dead.at) : ''
    return {
      level: LEVEL.blocked,
      reason: `上游已判定该模型失效${entry.dead.reason ? `（${entry.dead.reason}）` : ''}${at ? ` · ${at}` : ''}`,
      // 失效表由上游文案分类得出：这是**权威**结论，不是本机快照
      snapshot: false,
    }
  }
  const resetAt = Number(entry.earliestResetAt)
  const resetIn = Number.isFinite(resetAt) ? resetAt - now : null
  if (entry.allBlocked === true) {
    return {
      level: LEVEL.blocked,
      reason: resetIn !== null
        ? `全部启用账号均受限 · 最早 ${formatResetCountdown(resetIn)}后恢复`
        : '全部启用账号均受限',
      // ⚠️ 限流标记来自**本机快照**，恢复时刻可能是本地推算的（见 pack.js
      // 的 nextUtc8DayStartMs）。上游常在推算时刻之前就放行，因此这不是
      // 「一定不可用」的权威结论。界面据此提示用户可「重置/探活」验证。
      snapshot: true,
    }
  }
  if (Number(entry.blockedAccounts) > 0) {
    const parts = [`${entry.blockedAccounts}/${entry.enabledAccounts ?? '?'} 个账号受限`]
    if (resetIn !== null) parts.push(`最早 ${formatResetCountdown(resetIn)}后恢复`)
    return { level: LEVEL.degraded, reason: parts.join(' · '), snapshot: true }
  }
  const requests = Number(entry.requests) || 0
  const errors = Number(entry.errors) || 0
  if (requests >= 3 && errors > 0) {
    const rate = Math.round((errors / requests) * 100)
    if (rate >= 50) {
      return { level: LEVEL.degraded, reason: `失败率 ${rate}%（${errors}/${requests}）` }
    }
  }
  return { level: LEVEL.ok, reason: '' }
}

/** ISO 时间串 → `MM-DD HH:mm`。无法解析时原样返回。 */
export function formatShortDate(iso) {
  if (typeof iso !== 'string' || iso === '') return ''
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return iso
  const d = new Date(ms)
  const pad = n => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * 汇总全部分析，产出可直接交给客户端渲染的树。
 *
 * @param {object} input
 * @param {unknown} [input.state]  `state.json`
 * @param {unknown} [input.ledger] `token-ledger.json`
 * @param {unknown} [input.deadModels] `dead-models.json`
 * @param {unknown} [input.autoCheckin] `auto-checkin.json`
 * @param {unknown} [input.availability] 免费车道 `availability.json`
 * @param {unknown} [input.stats] 免费车道 `stats.json`
 * @param {number} [input.now]
 */
export function collectPassiveSignals({
  state, ledger, deadModels, autoCheckin, availability, stats, now = Date.now(),
} = {}) {
  const accounts = Array.isArray(state?.accounts) ? state.accounts : []
  const limits = collectModelLimits({ accounts, now })
  const ledgerStats = collectLedgerStats(ledger)
  const dead = collectDeadModels(deadModels)
  const freeStats = collectFreeLaneStats(stats)
  const freeAvailability = availability?.results !== null && typeof availability?.results === 'object'
    ? availability.results
    : {}

  // 用户主动关闭的模型：`state.json` 的 `disabledModels[provider][model] === true`
  const disabled = state?.disabledModels !== null && typeof state?.disabledModels === 'object'
    ? state.disabledModels
    : {}

  /** provider → model 的完整并集（三个来源取并：目录外也可能有限制记录） */
  const providers = new Set([
    ...Object.keys(limits),
    ...Object.keys(ledgerStats),
    ...Object.keys(dead),
    ...Object.keys(disabled),
  ])

  const out = { checkedAt: now, providers: {} }
  for (const provider of providers) {
    const accountRows = accounts.filter(a => a !== null && typeof a === 'object' && a.provider === provider)
    const enabledAccounts = accountRows.filter(a => a.enabled !== false).length
    const providerLimits = limits[provider] ?? {}
    const providerLedger = ledgerStats[provider] ?? {}
    const providerDead = dead[provider] ?? {}
    const providerDisabled = disabled[provider] !== null && typeof disabled[provider] === 'object' ? disabled[provider] : {}

    // ⚠ 「用户主动关闭」**不作为模型来源**，只作为已有模型的附加标记。
    // 本机实测 qoder 一次关了 16 个模型 —— 若把它们当来源，界面会多出 16 行
    // 「已在渠道包中关闭」，全是噪声：用户自己关的，不需要自检来告诉他。
    // 它们只由 `disabledModels` 计数体现，并且如果该模型恰好还有别的信号
    // （受限/失败/失效），关闭状态仍会显示出来。
    const modelIds = new Set([
      ...Object.keys(providerLimits),
      ...Object.keys(providerLedger),
      ...Object.keys(providerDead),
    ])

    const models = {}
    let providerRequests = 0
    let providerErrors = 0
    for (const modelId of modelIds) {
      const limitRow = providerLimits[modelId] ?? null
      const ledgerRow = providerLedger[modelId] ?? null
      const freeRow = freeStats[modelId] ?? null
      const availabilityRow = freeAvailability[modelId] ?? null
      const requests = (ledgerRow?.requests ?? 0) + (freeRow?.calls ?? 0)
      const errors = (ledgerRow?.errors ?? 0) + (freeRow?.failed ?? 0)
      providerRequests += requests
      providerErrors += errors
      const entry = {
        accounts: accountRows.length,
        enabledAccounts,
        blockedAccounts: limitRow?.blockedAccounts ?? 0,
        allBlocked: limitRow?.allBlocked ?? false,
        earliestResetAt: limitRow?.earliestResetAt ?? null,
        dead: providerDead[modelId] ?? null,
        disabled: providerDisabled[modelId] === true,
        requests,
        errors,
        lastErrorAt: freeRow?.lastErrorAt ?? null,
        // 免费车道的可用性判定（若该模型恰好也走免费车道）。只作附加信息，
        // 不参与等级判定：它说的是「这条免费车道通不通」，不是「这个渠道的模型
        // 有没有被限制」。
        freeLaneState: typeof availabilityRow?.state === 'string' ? availabilityRow.state : null,
      }
      const verdict = healthLevelOf(entry, now)
      // 订阅墙与等级判定并列：它不随时间恢复，因此不参与 blocked/degraded，
      // 只作为独立标记 + 更可操作的原因透出。
      const withPlan = withSubscriptionHint(verdict, subscriptionPlanOf(modelId))
      models[modelId] = {
        ...entry,
        level: withPlan.level,
        reason: withPlan.reason,
        // 结论来源：true=限流标记（本机快照，恢复时刻可能是本地推算），
        // false=失效表（上游权威判定）。界面据此区分「可能已放行」与「确实不能用」。
        ...withPlan.snapshot === undefined ? {} : { snapshot: withPlan.snapshot },
        ...withPlan.subscription === undefined ? {} : { subscription: withPlan.subscription },
      }
    }

    out.providers[provider] = {
      accounts: accountRows.length,
      enabledAccounts,
      modelCount: modelIds.size,
      blockedPairs: Object.values(models).reduce((sum, m) => sum + (m.blockedAccounts || 0), 0),
      deadModels: Object.keys(providerDead).length,
      disabledModels: Object.values(providerDisabled).filter(v => v === true).length,
      // 有实际观测记录（台账/失效表/限制）的模型数。与 `modelCount` 区分：
      // 后者可能包含只有限制记录、从未真正调用过的模型。
      observedModels: Object.keys(providerLedger).length,
      requests: providerRequests,
      errors: providerErrors,
      errorRate: providerRequests > 0 ? providerErrors / providerRequests : null,
      models,
    }
  }

  out.checkin = summarizeCheckin(autoCheckin, now)
  return out
}

/** 签到状态：只取「今天领没领、领了多少」，不展开逐渠道细节。 */
function summarizeCheckin(autoCheckin, now) {
  if (autoCheckin === null || typeof autoCheckin !== 'object') return null
  const lastDate = typeof autoCheckin.lastDate === 'string' ? autoCheckin.lastDate : ''
  const lastAt = Number(autoCheckin.lastAt)
  return {
    enabled: autoCheckin.enabled === true,
    lastDate,
    lastAt: Number.isFinite(lastAt) ? lastAt : 0,
    isToday: lastDate === localDateKey(now),
    result: typeof autoCheckin.lastResult === 'string' ? autoCheckin.lastResult : '',
  }
}

/** `YYYY-MM-DD`（本地时区）。签到按本机自然日结算。 */
export function localDateKey(ms) {
  const d = new Date(ms)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * 合并被动信号与主动探活结果。主动结果**只覆盖它真正测过的模型**，
 * 其余保持被动结论 —— 一次探活不应该把没测的模型冲成 unknown。
 *
 * @param {ReturnType<typeof collectPassiveSignals>} passive
 * @param {Record<string, Record<string, { ok: boolean, message?: string, at: number }>>} active
 */
export function mergeHealth(passive, active) {
  if (active === null || typeof active !== 'object') return passive
  const out = { ...passive, providers: { ...passive.providers } }
  for (const [provider, models] of Object.entries(active)) {
    if (models === null || typeof models !== 'object') continue
    const target = out.providers[provider]
    if (target === undefined) continue
    const nextModels = { ...target.models }
    for (const [modelId, result] of Object.entries(models)) {
      if (result === null || typeof result !== 'object') continue
      const existing = nextModels[modelId]
      if (existing === undefined) continue
      if (result.ok === true) {
        nextModels[modelId] = {
          ...existing,
          level: LEVEL.ok,
          reason: `主动探活通过 · ${formatShortDate(new Date(result.at).toISOString())}`,
          probedAt: result.at,
        }
      } else {
        nextModels[modelId] = {
          ...existing,
          level: LEVEL.blocked,
          reason: `主动探活失败：${String(result.message ?? '未知原因')}`,
          probedAt: result.at,
        }
      }
    }
    out.providers[provider] = { ...target, models: nextModels }
  }
  return out
}
