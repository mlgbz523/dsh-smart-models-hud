#!/usr/bin/env node
/**
 * prepack 校验：确保 package.json 的 files 白名单覆盖了所有运行时实际依赖的文件。
 *
 * 背景：v0.1.0 的 files 漏了 "src"，导致 npm pack / pnpm install 时
 * src/uplink-health.js 被丢弃，宿主端 index.js 的 import 失败，
 * 插件启动不了 —— 而它的 cordis.patch.yml 又禁用了内置模型选择器，
 * 结果模型筛选器整个消失。
 *
 * 这个脚本在 prepack 阶段拦截同类问题。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const files = pkg.files || [];
const errors = [];

/** 从 files 白名单还原出"哪些顶层路径会被打包" */
function isCovered(relPath) {
  return files.some((entry) => {
    const e = entry.replace(/\/+$/, '');
    return relPath === e || relPath.startsWith(e + '/');
  });
}

/** 递归收集源码里的相对 import */
function collectRelativeImports(file) {
  const src = fs.readFileSync(file, 'utf8');
  const out = new Set();
  const re = /(?:from\s*|import\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) out.add(m[1]);
  return [...out];
}

/** 解析相对 import 到真实文件（补 .js / 目录 index） */
function resolveRel(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [base, base + '.js', base + '.mjs', base + '.json', path.join(base, 'index.js')];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

// 1. 入口文件必须在 files 里
for (const entry of [pkg.main, pkg.exports?.['.'], pkg.dsh?.bundle?.patch, pkg.dsh?.client && './client.js']) {
  const e = typeof entry === 'string' ? entry : null;
  if (!e) continue;
  const rel = e.replace(/^\.\//, '');
  if (!isCovered(rel)) errors.push(`入口 "${e}" 不在 files 白名单内`);
}

// 2. 从入口出发，递归检查所有相对 import 是否都被 files 覆盖
const entries = [pkg.main, './client.js']
  .filter(Boolean)
  .map((e) => path.resolve(ROOT, e.replace(/^\.\//, '')))
  .filter((f) => fs.existsSync(f));

const seen = new Set();
const queue = [...entries];
while (queue.length) {
  const cur = queue.shift();
  if (seen.has(cur)) continue;
  seen.add(cur);

  const relToRoot = path.relative(ROOT, cur).split(path.sep).join('/');
  if (!isCovered(relToRoot)) {
    errors.push(`运行时依赖的文件未被 files 覆盖: ${relToRoot}`);
    continue; // 不再往下追，避免噪音
  }

  if (!/\.(js|mjs)$/.test(cur)) continue;
  for (const spec of collectRelativeImports(cur)) {
    const resolved = resolveRel(cur, spec);
    if (!resolved) {
      errors.push(`${relToRoot} 引用了不存在的模块: ${spec}`);
    } else {
      queue.push(resolved);
    }
  }
}

// 3. 检查 cordis.patch.yml 是否在包内
if (pkg.dsh?.bundle?.patch) {
  const p = path.resolve(ROOT, pkg.dsh.bundle.patch.replace(/^\.\//, ''));
  if (!fs.existsSync(p)) errors.push(`bundle patch 文件不存在: ${pkg.dsh.bundle.patch}`);
}

if (errors.length) {
  console.error('[verify-files] 打包校验失败，以下文件会丢失或在运行时缺失：');
  for (const e of errors) console.error('  ✗ ' + e);
  console.error('\n请修正 package.json 的 "files" 字段后重试。');
  process.exit(1);
}

console.log(`[verify-files] OK — 检查了 ${seen.size} 个运行时文件，全部被 files 白名单覆盖。`);
