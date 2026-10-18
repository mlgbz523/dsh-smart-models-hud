/**
 * dsh-smart-models — 宿主端 Cordis 插件
 *
 * 提供 /api/smart-models/channel-status 路由，秒级读取本地 channel-pack
 * 签到积分与账号健康状态，供前端聚合选择器实时渲染消耗等级与积分余量。
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const name = 'smart-models';
export const inject = [];

export function apply(ctx) {
  // 如果宿主提供了 webServer 服务，注册同源状态接口
  ctx.inject(['webServer'], child => {
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
          } else {
            res.writeHead(404);
            res.end('Not Found');
          }
        }
      });
    });
  });
}
