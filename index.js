/**
 * dsh-smart-models — 宿主端 Cordis 插件
 *
 * 提供 /api/smart-models/channel-status 路由，秒级读取本地 channel-pack
 * 签到积分与账号健康状态，供前端聚合选择器实时渲染消耗等级与积分余量。
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import { collectPassiveSignals } from './src/uplink-health.js';

// 插件自身目录：dashboard 静态资源相对它解析（不依赖 process.cwd()）
const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url));

export const name = 'smart-models';
export const inject = [];

export function apply(ctx) {
  // 如果宿主提供了 webServer 服务，注册同源状态接口
  ctx.inject(['webServer'], child => {
    // 用量看板：/smart-models —— 一个可被浏览器直接打开的只读页面。
    // 复用宿主 webServer（其本身只绑回环地址），不新开监听端口：
    // 看板只读、无凭据，敏感度与设置页同级，不值得引入独立端口的生命周期管理。
    child.effect(() => child.webServer.register({
      kind: 'exact',
      path: '/smart-models',
      handler: async (req, res) => {
        try {
          const html = fs.readFileSync(path.join(PLUGIN_DIR, 'dashboard', 'index.html'), 'utf8');
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Length': Buffer.byteLength(html),
            'Cache-Control': 'no-store'
          });
          res.end(html);
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('看板资源缺失：' + String(e?.message || e));
        }
      }
    }));

    child.effect(() => {
      return child.webServer.register({
        kind: 'prefix',
        path: '/api/smart-models',
        handler: async (req, res) => {
          if (req.url.startsWith('/api/smart-models/preferences')) {
            const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
            const prefsPath = path.join(dshHome, 'smart-models-preferences.json');

            if (req.method === 'GET') {
              try {
                let data = {};
                if (fs.existsSync(prefsPath)) {
                  data = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
                }
                const payload = JSON.stringify({ ok: true, data });
                res.writeHead(200, {
                  'Content-Type': 'application/json; charset=utf-8',
                  'Content-Length': Buffer.byteLength(payload),
                  'Cache-Control': 'no-store'
                });
                res.end(payload);
              } catch (e) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
              }
              return;
            }

            if (req.method === 'POST') {
              try {
                let body = '';
                req.on('data', chunk => { body += chunk; });
                req.on('end', () => {
                  try {
                    const parsed = JSON.parse(body || '{}');
                    fs.writeFileSync(prefsPath, JSON.stringify(parsed, null, 2), 'utf8');
                    const resp = JSON.stringify({ ok: true });
                    res.writeHead(200, {
                      'Content-Type': 'application/json; charset=utf-8',
                      'Content-Length': Buffer.byteLength(resp)
                    });
                    res.end(resp);
                  } catch (err) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
                  }
                });
              } catch (e) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
              }
              return;
            }
          }

          if (req.url.startsWith('/api/smart-models/agy-quota')) {
            // agy-link 没有暴露额度 RPC/HTTP，但账号池把额度持久化在 pool.json：
            // quotas[family] = { remainingFraction, weeklyFraction, resetTime, weeklyResetTime, ... }
            try {
              const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
              const poolPath = path.join(dshHome, 'agy-accounts', 'pool.json');
              const accounts = [];

              if (fs.existsSync(poolPath)) {
                let pool = null;
                try { pool = JSON.parse(fs.readFileSync(poolPath, 'utf8')); } catch (e) { pool = null; }
                for (const acc of (pool?.accounts ?? [])) {
                  if (!acc || acc.enabled === false) continue;
                  const q = acc.quotas?.google;
                  if (!q) continue;
                  const windows = [];
                  if (typeof q.remainingFraction === 'number') {
                    windows.push({
                      name: '5 小时窗口',
                      remaining: q.remainingFraction * 100,
                      resetTime: typeof q.resetTime === 'string' ? q.resetTime : ''
                    });
                  }
                  if (typeof q.weeklyFraction === 'number') {
                    windows.push({
                      name: '周窗口',
                      remaining: q.weeklyFraction * 100,
                      resetTime: typeof q.weeklyResetTime === 'string' ? q.weeklyResetTime : ''
                    });
                  }
                  if (windows.length === 0) continue;
                  const worst = windows.reduce((m, w) => (m === null ? w.remaining : Math.min(m, w.remaining)), null);
                  accounts.push({
                    accountId: acc.id,
                    nickname: acc.alias || acc.email || acc.id,
                    tier: q.subscriptionTier || '',
                    windows,
                    worst
                  });
                }
              }

              const payload = JSON.stringify({
                ok: true,
                quotaMode: true,
                accounts,
                updatedAt: Date.now()
              });
              res.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8',
                'Content-Length': Buffer.byteLength(payload),
                'Cache-Control': 'no-store'
              });
              res.end(payload);
            } catch (err) {
              const errPayload = JSON.stringify({ ok: false, error: String(err?.message || err) });
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(errPayload);
            }
            return;
          }

          if (req.url.startsWith('/api/smart-models/token-ledger')) {
            // DSH 原生 token 台账：真实测量的 token 用量（按 天|渠道|账号|模型 聚合）。
            // 这是「实测值」，与余额差值推算出的积分完全不是一个可信度等级。
            try {
              const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
              const ledgerPath = path.join(dshHome, 'channel-pack', 'token-ledger.json');
              const days = [];
              if (fs.existsSync(ledgerPath)) {
                const parsed = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
                const byDay = parsed && parsed.days && typeof parsed.days === 'object' ? parsed.days : {};
                for (const [day, buckets] of Object.entries(byDay)) {
                  if (!buckets || typeof buckets !== 'object') continue;
                  for (const [key, v] of Object.entries(buckets)) {
                    if (!v || typeof v !== 'object') continue;
                    // key 形如 "direct|workbuddy|workbuddy-ca52b35a|deepseek-v4.1-flash"
                    const parts = String(key).split('|');
                    const account = parts.length >= 4 ? parts[parts.length - 2] : '';
                    const model = parts.length >= 4 ? parts[parts.length - 1] : (parts[parts.length - 1] || '');
                    const provider = parts.length >= 4 ? parts[parts.length - 3] : (parts[1] || '');
                    const ttftCount = Number(v.ttftCount) || 0;
                    const tpsCount = Number(v.tpsCount) || 0;
                    days.push({
                      day,
                      provider,
                      account,
                      model,
                      requests: Number(v.requests) || 0,
                      reportedRequests: Number(v.reportedRequests) || 0,
                      inputTokens: Number(v.inputTokens) || 0,
                      outputTokens: Number(v.outputTokens) || 0,
                      cacheReadTokens: Number(v.cacheReadTokens) || 0,
                      cacheWriteTokens: Number(v.cacheWriteTokens) || 0,
                      reasoningTokens: Number(v.reasoningTokens) || 0,
                      errors: Number(v.errors) || 0,
                      avgTtftMs: ttftCount > 0 ? Math.round((Number(v.ttftSumMs) || 0) / ttftCount) : null,
                      avgTps: tpsCount > 0 ? Number(((Number(v.tpsSum) || 0) / tpsCount).toFixed(2)) : null
                    });
                  }
                }
              }
              const payload = JSON.stringify({ ok: true, days, updatedAt: Date.now() });
              res.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8',
                'Content-Length': Buffer.byteLength(payload),
                'Cache-Control': 'no-store'
              });
              res.end(payload);
            } catch (err) {
              res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify({ ok: false, days: [], error: String(err?.message || err) }));
            }
            return;
          }

          if (req.url.startsWith('/api/smart-models/pricing')) {
            // 渠道计价元数据：priceFactor（公开倍率）与 isFree。
            // 免费层级判定依赖它；拿不到时客户端退化为白名单，不阻塞记账。
            (async () => {
              const pricing = {};
              try {
                const connection = (() => {
                  try { return ctx.get && ctx.get('connection'); } catch { return undefined; }
                })();
                if (connection && typeof connection.rpc?.call === 'function') {
                  // 先取 provider 列表，再逐个查 model.list
                  const providersResp = await connection.rpc.call('/api', 'channel-pack', {
                    method: 'provider.getOrder', payload: {}
                  });
                  const order = providersResp?.ok === true && Array.isArray(providersResp.value?.order)
                    ? providersResp.value.order : [];
                  for (const provider of order) {
                    try {
                      const r = await connection.rpc.call('/api', 'channel-pack', {
                        method: 'model.list', payload: { provider }
                      });
                      if (r?.ok !== true) continue;
                      const models = Array.isArray(r.value?.models) ? r.value.models : [];
                      for (const m of models) {
                        const id = String(m?.id || m?.model || '');
                        if (id === '') continue;
                        pricing[provider + '|' + id] = {
                          isFree: m?.isFree === true,
                          priceFactor: Number.isFinite(m?.priceFactor) ? m.priceFactor : null
                        };
                      }
                    } catch (e) { /* 单个渠道失败不影响其他 */ }
                  }
                }
              } catch (e) { /* 整体失败返回空对象 */ }
              const payload = JSON.stringify({ ok: true, pricing });
              res.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8',
                'Content-Length': Buffer.byteLength(payload),
                'Cache-Control': 'no-store'
              });
              res.end(payload);
            })();
            return;
          }

          if (req.url.startsWith('/api/smart-models/usage/clean')) {
            // 历史可疑记录清理（仅 POST）：把垃圾积分改写为不可信，事件与请求数保留。
            // 判定标准二选一：
            //   a) credits > 1000 且 requests === 1 —— 单轮消耗超过 1000 积分，真实台账里
            //      的 15159.99/23659.99 垃圾正是这个形态（单轮不可能烧这么多）；
            //   b) 带 suspect 标记 —— 升级后新产生、但被判定可疑的记录。
            // 执行前先备份一次原文件（smart-models-usage.json.bak），可手动恢复。
            if (req.method !== 'POST') {
              res.writeHead(405, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: false, error: 'method not allowed' }));
              return;
            }
            try {
              const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
              const usagePath = path.join(dshHome, 'smart-models-usage.json');
              const ledger = readLedger();
              let cleaned = 0;
              for (const e of ledger.events) {
                if (!e) continue;
                const isGarbage = Number.isFinite(e.credits) && e.credits > 1000 && (e.requests || 1) === 1;
                const isSuspect = e.suspect === 'provider-switch' || e.suspect === 'account-change';
                if (isGarbage || isSuspect) {
                  e.creditsKnown = false;
                  delete e.suspect;
                  e.cleaned = true;
                  cleaned += 1;
                }
              }
              // 备份一次原文件再写回（同名覆盖，幂等）
              try { fs.copyFileSync(usagePath, usagePath + '.bak'); } catch (e) { /* 首次运行无文件 */ }
              writeLedger(ledger);
              const okPayload = JSON.stringify({ ok: true, cleaned, total: ledger.events.length });
              res.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8',
                'Content-Length': Buffer.byteLength(okPayload)
              });
              res.end(okPayload);
            } catch (err) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
            }
            return;
          }

          if (req.url.startsWith('/api/smart-models/usage')) {
            // 用量台账：插件自己观测到的每轮积分消耗 + token，用于设置页统计。
            // 现有 token-ledger.json 只有 token 没有积分，历史积分无法回溯，
            // 因此这份台账从本功能安装后开始累积。
            const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
            const usagePath = path.join(dshHome, 'smart-models-usage.json');
            const RETENTION_DAYS = 90;
            const EMPTY = () => ({ schema: 'dsh-smart-models/usage/v1', since: Date.now(), events: [] });

            const readLedger = () => {
              try {
                if (!fs.existsSync(usagePath)) return EMPTY();
                const parsed = JSON.parse(fs.readFileSync(usagePath, 'utf8'));
                if (!parsed || !Array.isArray(parsed.events)) return EMPTY();
                return {
                  schema: parsed.schema || 'dsh-smart-models/usage/v1',
                  since: Number.isFinite(parsed.since) ? parsed.since : Date.now(),
                  events: parsed.events
                };
              } catch (e) {
                // 文件损坏时重建，不阻塞功能
                return EMPTY();
              }
            };

            const writeLedger = (ledger) => {
              // 原子写：先写临时文件再 rename，避免半截文件
              const tmp = usagePath + '.tmp';
              fs.writeFileSync(tmp, JSON.stringify(ledger), 'utf8');
              fs.renameSync(tmp, usagePath);
            };

            if (req.method === 'GET') {
              try {
                const ledger = readLedger();
                const sinceMs = Number(new URL(req.url, 'http://x').searchParams.get('since')) || 0;
                const events = sinceMs > 0 ? ledger.events.filter(e => e && e.at >= sinceMs) : ledger.events;
                const payload = JSON.stringify({
                  ok: true,
                  schema: ledger.schema,
                  since: ledger.since,
                  events,
                  updatedAt: Date.now()
                });
                res.writeHead(200, {
                  'Content-Type': 'application/json; charset=utf-8',
                  'Content-Length': Buffer.byteLength(payload),
                  'Cache-Control': 'no-store'
                });
                res.end(payload);
              } catch (err) {
                const errPayload = JSON.stringify({ ok: false, error: String(err?.message || err) });
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(errPayload);
              }
              return;
            }

            if (req.method === 'POST') {
              let body = '';
              req.on('data', chunk => { body += chunk; });
              req.on('end', () => {
                try {
                  const incoming = JSON.parse(body || '{}');
                  const ledger = readLedger();
                  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;

                  const SUSPECT_REASONS = ['provider-switch', 'account-change'];
                  const rows = Array.isArray(incoming) ? incoming : [incoming];
                  for (const row of rows) {
                    if (!row || typeof row !== 'object') continue;
                    const at = Number.isFinite(row.at) ? row.at : Date.now();
                    if (at < cutoff) continue;
                    ledger.events.push({
                      at,
                      provider: String(row.provider || ''),
                      model: String(row.model || ''),
                      credits: Number.isFinite(row.credits) ? row.credits : 0,
                      creditsKnown: row.creditsKnown === true,
                      // 可疑原因（结算时被闸门拦下）：v1 台账没有这个字段，读取端按无值处理
                      ...(SUSPECT_REASONS.includes(row.suspect) ? { suspect: row.suspect } : {}),
                      inputTokens: Number.isFinite(row.inputTokens) ? row.inputTokens : 0,
                      outputTokens: Number.isFinite(row.outputTokens) ? row.outputTokens : 0,
                      requests: Number.isFinite(row.requests) ? row.requests : 1
                    });
                  }

                  // 90 天滚动裁剪
                  ledger.events = ledger.events.filter(e => e && e.at >= cutoff);
                  writeLedger(ledger);

                  const okPayload = JSON.stringify({ ok: true, count: ledger.events.length });
                  res.writeHead(200, {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Content-Length': Buffer.byteLength(okPayload)
                  });
                  res.end(okPayload);
                } catch (err) {
                  res.writeHead(400, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
                }
              });
              return;
            }
          }

          if (req.url.startsWith('/api/smart-models/channel-status')) {
            try {
              const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
              const autoCheckinPath = path.join(dshHome, 'channel-pack', 'auto-checkin.json');
              const statePath = path.join(dshHome, 'channel-pack', 'state.json');

              let autoCheckin = null;
              let state = null;

              if (fs.existsSync(autoCheckinPath)) {
                try {
                  autoCheckin = JSON.parse(fs.readFileSync(autoCheckinPath, 'utf8'));
                } catch (e) {}
              }

              if (fs.existsSync(statePath)) {
                try {
                  state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
                } catch (e) {}
              }

              const payload = JSON.stringify({
                ok: true,
                autoCheckin,
                state,
                updatedAt: Date.now()
              });

              res.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8',
                'Content-Length': Buffer.byteLength(payload),
                'Cache-Control': 'no-store'
              });
              res.end(payload);
            } catch (err) {
              const errPayload = JSON.stringify({ ok: false, error: String(err?.message || err) });
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(errPayload);
            }
          } else if (req.url.startsWith('/api/smart-models/uplink-health')) {
            // 上行自检（只读）：把 channel-pack 已经落盘的「模型级限制」「失效表」
            // 「请求台账」与免费车道的可用性/统计读出来，交给 src/uplink-health.js
            // 做纯函数归类。
            //
            // ⚠ 这里**不发起任何网络请求**。它回答的是「已经发生过什么」，不是
            // 「现在通不通」——后者只能由客户端显式点「主动探活」触发，因为那会
            // 真实消耗一次上游额度（account.test → adapter.stream）。
            //
            // 每个数据源独立容错：任一文件缺失/损坏只让对应字段为空，接口仍返
            // 200。这份路由存在的意义就是「本机没装 channel-pack 时也能解释现状」。
            try {
              const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
              const readJson = (relative) => {
                const file = path.join(dshHome, relative);
                try {
                  if (!fs.existsSync(file)) return undefined;
                  return JSON.parse(fs.readFileSync(file, 'utf8'));
                } catch (e) {
                  return undefined;
                }
              };

              const signals = collectPassiveSignals({
                state: readJson(path.join('channel-pack', 'state.json')),
                ledger: readJson(path.join('channel-pack', 'token-ledger.json')),
                deadModels: readJson(path.join('channel-pack', 'dead-models.json')),
                autoCheckin: readJson(path.join('channel-pack', 'auto-checkin.json')),
                availability: readJson(path.join('our-free-model', 'availability.json')),
                stats: readJson(path.join('our-free-model', 'stats.json')),
              });

              // 按 provider 过滤（可选参数），便于选择器只取当前渠道那一份。
              const url2 = new URL(req.url, 'http://localhost');
              const only = url2.searchParams.get('provider');
              if (only !== null && only !== '') {
                const row = signals.providers[only];
                signals.providers = row === undefined ? {} : { [only]: row };
              }

              // 脱敏：上游 state.json 带 credentialRef 与 nickname，这里只保留
              // 判定所需的聚合量，绝不把这两项透出（与 channel-pack 自身口径一致）。
              const payload = JSON.stringify({ ok: true, ...signals, updatedAt: Date.now() });
              res.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8',
                'Content-Length': Buffer.byteLength(payload),
                'Cache-Control': 'no-store'
              });
              res.end(payload);
            } catch (err) {
              const errPayload = JSON.stringify({ ok: false, error: String(err?.message || err) });
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(errPayload);
            }
          } else {
            res.writeHead(404);
            res.end('Not Found');
          }
        }
      });
    });
  });
}
