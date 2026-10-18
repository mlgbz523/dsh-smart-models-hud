/**
 * dsh-smart-models — 浏览器端核心聚合选择器 (V2 增强版)
 *
 * 核心升级：
 * 1. 显式倍率标识 (xN.M)：像 our-free-model 一样，精准提取并展示每个渠道的具体计费倍率
 *    （🟢 x0 免算力 / 🟣 x0.5 半价优惠 / 🔵 x1 标准倍率 / 🟠 x2 深度倍率 / 🟣 x1→x0.5 限时促销），
 *    并在输入框常驻显示当前模型的倍率 [xN.M]，让用户一目了然做出渠道抉择；
 * 2. 彻底解决遮挡问题：绝对定位锚定在输入框上方 10px，列表采用 flex: 1 1 auto + min-height: 0，
 *    滚动区域受控，思考档位为独立底部固钉，末尾项滚动完全展示，绝不再被遮挡；
 * 3. 渠道级星标（全局默认模型）：移除了模型标题上的多余星标，星标精确定位到每个渠道徽章上。
 *    点击任意渠道的星标即设为新会话全局默认，下次新建对话自动采用；
 * 4. 实时同步消耗等级与额度：拉取本地 channel-pack 每日签到领取的 +2000分、+200分 实际积分，
 *    结合计费倍率提供最权威的渠道决策指引；
 * 5. 渠道多账号智能合并：相同供应商合并为一个徽章，消除重复标签并标注可用账号数。
 */

window.__ModuleLoader__.load({
  id: 'dsh-smart-models',
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;

    const React = require('react');
    const {
      createElement: h,
      useState,
      useEffect,
      useMemo,
      useRef,
      useCallback
    } = React;

    let createPortal = null;
    try {
      const ReactDOM = require('react-dom');
      if (typeof ReactDOM?.createPortal === 'function') {
        createPortal = ReactDOM.createPortal;
      }
    } catch (e) {}
    if (!createPortal && typeof window !== 'undefined' && typeof window.ReactDOM?.createPortal === 'function') {
      createPortal = window.ReactDOM.createPortal;
    }

    let rootCtx = null;

    // ── CSS 样式注入 ────────────────────────────────────────────────────────────
    const CSS_TEXT = `
      .dsh-sm-root {
        position: relative;
        display: inline-flex;
        align-items: center;
      }

      /* 触发器按钮 */
      .dsh-sm-trigger {
        min-width: 0;
        max-width: min(420px, 50cqw);
        height: 28px;
        border-radius: var(--dsw-radius-sm, 6px);
        color: var(--dsw-alias-label-secondary, #94a3b8);
        background: transparent;
        border: 1px solid transparent;
        outline: none;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 0 8px;
        font-size: 13px;
        font-weight: 500;
        line-height: 20px;
        user-select: none;
        white-space: nowrap;
        flex-shrink: 0;
        transition: background 0.15s, color 0.15s, border-color 0.15s;
      }
      .dsh-sm-trigger:hover:not(:disabled) {
        background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.08));
        color: var(--dsw-alias-label-primary, #f8fafc);
      }
      .dsh-sm-trigger.open {
        background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.08));
        color: var(--dsw-alias-label-primary, #f8fafc);
        border-color: var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.12));
      }
      .dsh-sm-trigger:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .dsh-sm-trigger-text {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 170px;
      }
      .dsh-sm-trigger-provider {
        opacity: 0.75;
        font-size: 12px;
        white-space: nowrap;
        flex-shrink: 0;
      }
      .dsh-sm-trigger-rate,
      .dsh-sm-trigger-rate.dsh-sm-rate-zero,
      .dsh-sm-trigger-rate.dsh-sm-rate-discount,
      .dsh-sm-trigger-rate.dsh-sm-rate-standard,
      .dsh-sm-trigger-rate.dsh-sm-rate-high {
        color: #38bdf8;
        font-size: 11px;
        font-weight: 600;
        white-space: nowrap;
        flex-shrink: 0;
        background: transparent !important;
        background-color: transparent !important;
        border: none !important;
        box-shadow: none !important;
        padding: 0 !important;
      }
      .dsh-sm-trigger-effort {
        opacity: 0.75;
        font-size: 11px;
        white-space: nowrap;
        flex-shrink: 0;
      }
      .dsh-sm-chevron {
        flex-shrink: 0;
        width: 12px;
        height: 12px;
        transition: transform 0.2s ease;
        opacity: 0.7;
      }
      .dsh-sm-chevron.open {
        transform: rotate(180deg);
      }

      /* 弹窗主容器：最高层级，允许伴随卡片溢出 */
      .dsh-sm-popover {
        position: fixed;
        z-index: 999999 !important;
        width: 270px;
        max-width: min(270px, calc(100vw - 24px));
        height: auto;
        color: var(--dsw-alias-label-primary, #f8fafc);
        overflow: visible !important;
        animation: dsh-sm-in 0.14s cubic-bezier(0.16, 1, 0.3, 1);
        pointer-events: auto;
      }
      @keyframes dsh-sm-in {
        from { opacity: 0; transform: translateY(6px) scale(0.985); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }

      /* 主卡片：包覆搜索、模型列表与思考档位 */
      .dsh-sm-main-card {
        width: 100%;
        max-height: min(420px, calc(100vh - 120px));
        background: color-mix(in srgb, var(--dsw-alias-bg-layer-2, #18181b) 97%, transparent);
        backdrop-filter: blur(28px);
        -webkit-backdrop-filter: blur(28px);
        border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.16));
        border-radius: var(--dsw-radius-lg, 12px);
        box-shadow: 0 20px 60px -4px rgba(0, 0, 0, 0.75), 0 0 0 1px rgba(255, 255, 255, 0.1);
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      /* 搜索栏 */
      .dsh-sm-search-row {
        padding: 8px 10px;
        position: relative;
        flex-shrink: 0;
        border-bottom: 1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.08));
        background: rgba(255, 255, 255, 0.02);
      }
      .dsh-sm-search-input {
        width: 100%;
        height: 32px;
        background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.06));
        border: 1px solid transparent;
        border-radius: var(--dsw-radius-sm, 6px);
        color: inherit;
        font-size: 13px;
        padding: 0 28px 0 30px;
        outline: none;
        box-sizing: border-box;
        transition: border-color 0.15s;
      }
      .dsh-sm-search-input:focus {
        border-color: var(--dsw-alias-state-business-primary, #38bdf8);
      }
      .dsh-sm-search-icon {
        position: absolute;
        left: 19px;
        top: 17px;
        width: 14px;
        height: 14px;
        opacity: 0.5;
        pointer-events: none;
      }
      .dsh-sm-search-clear {
        position: absolute;
        right: 18px;
        top: 15px;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background: transparent;
        border: none;
        color: inherit;
        opacity: 0.6;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
      }
      .dsh-sm-search-clear:hover {
        opacity: 1;
        background: rgba(255, 255, 255, 0.1);
      }

      /* ── 视图 1：主模型列表视图 (Models View) ── */
      .dsh-sm-models-view {
        display: flex;
        flex-direction: column;
        flex: 1 1 auto;
        min-height: 0;
        animation: dsh-sm-slide-right 0.14s cubic-bezier(0.16, 1, 0.3, 1);
      }
      @keyframes dsh-sm-slide-right {
        from { opacity: 0; transform: translateX(-8px); }
        to { opacity: 1; transform: translateX(0); }
      }

      .dsh-sm-master-col {
        width: 100%;
        max-height: 275px;
        overflow-y: auto;
        overscroll-behavior: contain;
        padding: 4px 0;
        display: flex;
        flex-direction: column;
        gap: 1px;
      }
      .dsh-sm-empty {
        padding: 24px 12px;
        text-align: center;
        color: var(--dsw-alias-label-tertiary, #64748b);
        font-size: 12px;
      }

      /* 单行：严格 32px 绝对定高，零 Layout Shift */
      .dsh-sm-master-item {
        height: 32px;
        min-height: 32px;
        max-height: 32px;
        padding: 0 8px 0 10px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        user-select: none;
        transition: background 0.1s ease;
        box-sizing: border-box;
        cursor: pointer;
        border-left: 3px solid transparent;
      }
      .dsh-sm-master-item:hover, .dsh-sm-master-item.is-hovered {
        background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.08));
      }
      /* 当前会话激活模型高亮：青蓝半透背景 + 纯正青蓝左边线 + 模型名高亮提亮 */
      .dsh-sm-master-item.is-active-session {
        background: rgba(56, 189, 248, 0.14);
        border-left: 3px solid #38bdf8;
      }
      .dsh-sm-master-item.is-active-session .dsh-sm-master-name {
        color: #f8fafc;
        font-weight: 600;
      }
      .dsh-sm-master-item.is-active-session:hover,
      .dsh-sm-master-item.is-active-session.is-hovered {
        background: rgba(56, 189, 248, 0.22);
      }
      .dsh-sm-master-left {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
        overflow: hidden;
        flex: 1 1 auto;
        cursor: pointer;
        height: 100%;
      }
      .dsh-sm-master-fav-btn {
        background: transparent;
        border: none;
        padding: 0;
        margin: 0;
        font-size: 13px;
        line-height: 1;
        cursor: pointer;
        color: #facc15;
        transition: opacity 0.15s ease, transform 0.12s ease, color 0.12s ease;
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        width: 14px;
        height: 14px;
      }
      /* 激活（已收藏）时始终显示实心星标 */
      .dsh-sm-master-fav-btn.is-fav {
        opacity: 1 !important;
        color: #facc15;
      }
      /* 未激活（未收藏）时，鼠标挪到模型处时显示空心星标按钮（开关），移开时消失 */
      .dsh-sm-master-item:hover .dsh-sm-master-fav-btn:not(.is-fav),
      .dsh-sm-master-item.is-hovered .dsh-sm-master-fav-btn:not(.is-fav) {
        opacity: 0.65;
        color: #94a3b8;
      }
      /* 鼠标悬停在星标开关本身时高亮 */
      .dsh-sm-master-fav-btn:hover {
        opacity: 1 !important;
        color: #facc15 !important;
        transform: scale(1.22);
      }
      .dsh-sm-master-name {
        font-size: 12px;
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dsh-sm-master-right {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-shrink: 0;
      }
      .dsh-sm-master-channel-name {
        font-size: 11px;
        color: var(--dsw-alias-label-tertiary, #94a3b8);
        white-space: nowrap;
        opacity: 0.75;
        max-width: 58px;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .dsh-sm-master-item.is-active-session .dsh-sm-master-channel-name {
        color: #38bdf8;
        opacity: 1;
        font-weight: 600;
      }
      .dsh-sm-master-arrow {
        font-size: 13px;
        opacity: 0.4;
        line-height: 1;
        transition: transform 0.12s, opacity 0.12s;
      }
      .dsh-sm-master-item:hover .dsh-sm-master-arrow,
      .dsh-sm-master-item.is-hovered .dsh-sm-master-arrow {
        opacity: 0.9;
        transform: translateX(1px);
      }

      /* ── 方案 2：动态伴随渠道卡片 (Dynamic Companion Floating Card) ── */
      .dsh-sm-companion-flyout {
        position: absolute;
        left: calc(100% + 6px);
        top: 0;
        width: 245px;
        max-height: 380px;
        background: color-mix(in srgb, var(--dsw-alias-bg-layer-2, #18181b) 97%, transparent);
        backdrop-filter: blur(28px);
        -webkit-backdrop-filter: blur(28px);
        border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.18));
        border-radius: var(--dsw-radius-lg, 12px);
        box-shadow: 0 20px 60px -4px rgba(0, 0, 0, 0.75), 0 0 0 1px rgba(255, 255, 255, 0.1);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        z-index: 1000000;
        animation: dsh-sm-flyout-in 0.12s cubic-bezier(0.16, 1, 0.3, 1);
        pointer-events: auto;
      }
      @keyframes dsh-sm-flyout-in {
        from { opacity: 0; transform: translateX(-4px) scale(0.98); }
        to { opacity: 1; transform: translateX(0) scale(1); }
      }
      .dsh-sm-companion-flyout.flip-left {
        left: auto;
        right: calc(100% + 6px);
        animation: dsh-sm-flyout-in-left 0.12s cubic-bezier(0.16, 1, 0.3, 1);
      }
      @keyframes dsh-sm-flyout-in-left {
        from { opacity: 0; transform: translateX(4px) scale(0.98); }
        to { opacity: 1; transform: translateX(0) scale(1); }
      }
      /* 隐形安全桥接通道：解决鼠标从左卡片移动到右卡片时中间缝隙失焦问题 */
      .dsh-sm-companion-flyout::before {
        content: '';
        position: absolute;
        left: -14px;
        top: -10px;
        bottom: -10px;
        width: 16px;
        background: transparent;
        pointer-events: auto;
      }
      .dsh-sm-companion-flyout.flip-left::before {
        left: auto;
        right: -14px;
      }
      .dsh-sm-companion-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        padding: 8px 10px;
        border-bottom: 1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.08));
        background: rgba(255, 255, 255, 0.02);
        flex-shrink: 0;
      }
      .dsh-sm-companion-title-wrap {
        display: flex;
        align-items: baseline;
        gap: 5px;
        min-width: 0;
        overflow: hidden;
        flex: 1 1 auto;
      }
      .dsh-sm-companion-title {
        font-size: 12px;
        font-weight: 600;
        color: var(--dsw-alias-label-primary, #f8fafc);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dsh-sm-companion-count {
        font-size: 10px;
        color: var(--dsw-alias-label-tertiary, #94a3b8);
        white-space: nowrap;
      }
      .dsh-sm-detail-fav-btn {
        background: transparent;
        border: 1px solid rgba(234, 179, 8, 0.25);
        border-radius: 4px;
        color: #fef08a;
        font-size: 11px;
        cursor: pointer;
        padding: 2px 6px;
        opacity: 0.75;
        transition: all 0.15s;
        white-space: nowrap;
        flex-shrink: 0;
      }
      .dsh-sm-detail-fav-btn:hover, .dsh-sm-detail-fav-btn.is-fav {
        opacity: 1;
        border-color: #facc15;
        background: rgba(234, 179, 8, 0.15);
        color: #facc15;
      }
      .dsh-sm-companion-channels {
        padding: 6px 8px;
        max-height: 320px;
        overflow-y: auto;
        overscroll-behavior: contain;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      /* 渠道卡片：横向平铺，大点按区 */
      .dsh-sm-detail-card {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 6px 9px;
        border-radius: 6px;
        border: 1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.08));
        background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.04));
        cursor: pointer;
        transition: all 0.12s ease;
        user-select: none;
        gap: 8px;
      }
      .dsh-sm-detail-card:hover {
        border-color: rgba(255, 255, 255, 0.25);
        background: rgba(255, 255, 255, 0.09);
        transform: translateY(-1px);
      }
      /* 使用中高亮：柔和青蓝背景与高亮描边 */
      .dsh-sm-detail-card.active {
        background: rgba(56, 189, 248, 0.16) !important;
        border-color: #38bdf8 !important;
        color: #f8fafc !important;
        box-shadow: 0 0 0 1px rgba(56, 189, 248, 0.4), 0 2px 8px rgba(56, 189, 248, 0.22) !important;
      }
      .dsh-sm-detail-left {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
        overflow: hidden;
        flex: 1 1 auto;
      }
      .dsh-sm-detail-provider-name {
        font-size: 12px;
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        flex: 1 1 auto;
        min-width: 0;
      }
      .dsh-sm-detail-right {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-shrink: 0;
      }
      .dsh-sm-detail-active-badge {
        font-size: 10px;
        font-weight: 600;
        padding: 1px 5px;
        border-radius: 3px;
        background: rgba(56, 189, 248, 0.3);
        color: #38bdf8;
        border: 1px solid rgba(56, 189, 248, 0.5);
        white-space: nowrap;
      }

      /* 渠道星标设为默认按钮（精确到模型+渠道） */
      .dsh-sm-badge-star {
        background: transparent;
        border: none;
        color: #eab308;
        font-size: 13px;
        line-height: 1;
        padding: 3px 6px 3px 3px;
        cursor: pointer;
        opacity: 0.35;
        transition: all 0.15s;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .dsh-sm-badge-wrap:hover .dsh-sm-badge-star {
        opacity: 0.85;
      }
      .dsh-sm-badge-star.is-default {
        opacity: 1 !important;
        color: #facc15;
        text-shadow: 0 0 8px rgba(250, 204, 21, 0.6);
      }
      .dsh-sm-badge-star:hover {
        transform: scale(1.25);
        opacity: 1 !important;
      }

      /* 账号数量微标签 */
      .dsh-sm-acct-tag {
        font-size: 9px;
        opacity: 0.7;
        margin-left: -2px;
      }

      /* 核心：计费倍率微标 (x0 / x0.5 / x1 / x2 等) */
      .dsh-sm-rate-tag {
        font-size: 10px;
        font-weight: 700;
        padding: 1px 4px;
        border-radius: 3px;
        letter-spacing: 0.02em;
        line-height: normal;
        display: inline-flex;
        align-items: center;
      }
      .dsh-sm-rate-zero {
        background: rgba(34, 197, 94, 0.25);
        color: #4ade80;
      }
      .dsh-sm-rate-discount {
        background: rgba(168, 85, 247, 0.25);
        color: #d8b4fe;
      }
      .dsh-sm-rate-standard {
        background: rgba(56, 189, 248, 0.22);
        color: #38bdf8;
      }
      .dsh-sm-rate-high {
        background: rgba(245, 158, 11, 0.25);
        color: #fbbf24;
      }
      .dsh-sm-badge-wrap.active .dsh-sm-rate-tag {
        background: rgba(255, 255, 255, 0.26);
        color: #ffffff;
      }

      /* 消耗性质微标 */
      .dsh-sm-tier-tag {
        font-size: 9px;
        font-weight: 500;
        padding: 1px 3px;
        border-radius: 3px;
        letter-spacing: 0.01em;
        line-height: normal;
        opacity: 0.85;
      }
      .dsh-sm-tier-free {
        color: #86efac;
      }
      .dsh-sm-tier-points {
        color: #e9d5ff;
      }
      .dsh-sm-tier-account {
        color: #bae6fd;
      }
      .dsh-sm-tier-quota {
        color: #bae6fd;
      }
      .dsh-sm-tier-paid {
        color: #fde68a;
      }
      .dsh-sm-badge-wrap.active .dsh-sm-tier-tag {
        color: rgba(255, 255, 255, 0.9);
      }

      /* 底部思考档位栏 */
      .dsh-sm-effort-row {
        padding: 8px 12px;
        border-top: 1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.08));
        background: rgba(0, 0, 0, 0.28);
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
        font-size: 12px;
      }
      .dsh-sm-effort-label {
        color: var(--dsw-alias-label-tertiary, #94a3b8);
        white-space: nowrap;
      }
      .dsh-sm-effort-pills {
        display: flex;
        gap: 4px;
        flex-wrap: wrap;
      }
      .dsh-sm-effort-pill {
        padding: 2px 7px;
        border-radius: 4px;
        font-size: 11px;
        border: 1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.1));
        background: transparent;
        color: inherit;
        cursor: pointer;
        transition: background 0.15s;
      }
      .dsh-sm-effort-pill:hover {
        background: rgba(255, 255, 255, 0.1);
      }
      .dsh-sm-effort-pill.active {
        background: var(--dsw-alias-state-business-primary, #0284c7);
        border-color: transparent;
        color: #ffffff;
        font-weight: 600;
      }

      /* ── 渠道积分透视 HUD（聚合自 dsh-channel-credits-hud）────────────── */
      .dsh-cchud-pill {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        height: 24px;
        padding: 0 7px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(255, 255, 255, 0.04);
        color: var(--dsw-alias-label-secondary, #94a3b8);
        font-size: 11px;
        font-weight: 600;
        line-height: 1;
        white-space: nowrap;
        user-select: none;
        cursor: pointer;
        transition: background 0.16s ease, border-color 0.16s ease, color 0.16s ease, box-shadow 0.16s ease;
        flex-shrink: 0;
      }
      .dsh-cchud-pill:hover {
        background: rgba(255, 255, 255, 0.09);
        border-color: rgba(255, 255, 255, 0.2);
        color: var(--dsw-alias-label-primary, #f8fafc);
      }
      .dsh-cchud-pill:disabled {
        cursor: default;
        opacity: 0.6;
      }
      .dsh-cchud-icon {
        font-size: 11px;
        line-height: 1;
        flex-shrink: 0;
      }
      .dsh-cchud-label {
        opacity: 0.75;
        font-weight: 500;
        max-width: 56px;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .dsh-cchud-amount {
        font-variant-numeric: tabular-nums;
        letter-spacing: 0.01em;
      }
      .dsh-cchud-unit {
        opacity: 0.55;
        font-size: 10px;
        font-weight: 500;
      }
      .dsh-cchud-pill.is-running {
        border-color: rgba(56, 189, 248, 0.42);
        background: rgba(56, 189, 248, 0.1);
        color: #7dd3fc;
        animation: dsh-cchud-breathe 1.8s ease-in-out infinite;
      }
      @keyframes dsh-cchud-breathe {
        0%, 100% { box-shadow: 0 0 0 0 rgba(56, 189, 248, 0); }
        50% { box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.14); }
      }
      .dsh-cchud-pill.is-settled {
        border-color: rgba(251, 191, 36, 0.5);
        background: rgba(251, 191, 36, 0.13);
        color: #fbbf24;
        box-shadow: 0 0 0 2px rgba(251, 191, 36, 0.12);
      }
      .dsh-cchud-delta {
        font-variant-numeric: tabular-nums;
        font-weight: 700;
      }
      .dsh-cchud-pill.is-loading .dsh-cchud-amount {
        opacity: 0.5;
      }
      .dsh-cchud-error {
        opacity: 0.55;
        font-weight: 500;
      }
      /* 配额健康度配色：低余量醒目提示 */
      .dsh-cchud-amount.is-low {
        color: #f87171;
      }
      .dsh-cchud-amount.is-mid {
        color: #fbbf24;
      }
    `;

    function injectStyles() {
      if (typeof document === 'undefined') return;
      const STYLE_TAG_ID = 'dsh-smart-models-styles-v17';
      const oldIds = ['dsh-smart-models-styles-v2', 'dsh-smart-models-styles-v3', 'dsh-smart-models-styles-v4', 'dsh-smart-models-styles-v5', 'dsh-smart-models-styles-v6', 'dsh-smart-models-styles-v7', 'dsh-smart-models-styles-v8', 'dsh-smart-models-styles-v9', 'dsh-smart-models-styles-v10', 'dsh-smart-models-styles-v11', 'dsh-smart-models-styles-v12', 'dsh-smart-models-styles-v13', 'dsh-smart-models-styles-v14', 'dsh-smart-models-styles-v15', 'dsh-smart-models-styles-v16'];
      for (const oid of oldIds) {
        const el = document.getElementById(oid);
        if (el) el.remove();
      }

      let style = document.getElementById(STYLE_TAG_ID);
      if (!style) {
        style = document.createElement('style');
        style.id = STYLE_TAG_ID;
        document.head.appendChild(style);
      }
      style.textContent = CSS_TEXT;
    }

    // ── 格式化单倍率为 2 位小数 (如 x1.00 / x0.00 / x0.50 / x6.67) ──────────────
    function formatSingleRate(val) {
      if (!val && val !== 0) return 'x1.00';
      const s = String(val).replace(/^x/i, '').replace(/x$/i, '').trim();
      if (s === '免费') return 'x0.00';
      const num = parseFloat(s);
      if (isNaN(num)) return String(val);
      return `x${num.toFixed(2)}`;
    }

    // ── 格式化紧凑倍率 (如 0x / 1x / 0.26x / 1x→0.5x，大幅节约触发器和列表空间) ──
    function formatCompactRate(multiplier) {
      if (!multiplier) return '1x';
      const s = String(multiplier).replace(/^x/i, '').replace(/x$/i, '').trim();
      if (s === '0.00' || s === '0' || s === '免费') return '0x';
      if (s === '1.00' || s === '1') return '1x';
      if (s.endsWith('.00')) return `${parseFloat(s)}x`;
      if (s.includes('→')) {
        return s.split('→').map(p => formatCompactRate(p)).join('→');
      }
      const num = parseFloat(s);
      return isNaN(num) ? multiplier : `${num}x`;
    }

    // ── 计算渠道列表中的最低倍率 ────────────────────────────────────────────────
    function parseMultiplier(multiplier) {
      if (!multiplier) return 1.0;
      if (multiplier === 'x0.00' || multiplier === 'x0' || multiplier === '0' || multiplier === '免费') return 0;
      const s = String(multiplier).replace(/^x/i, '');
      const parts = s.split('→');
      const val = parseFloat(parts[parts.length - 1]);
      return isNaN(val) ? 1.0 : val;
    }

    function getLowestRate(providers) {
      if (!providers || providers.length === 0) return 'x1.00';
      let minNum = Infinity;
      let minRateStr = 'x1.00';
      for (const p of providers) {
        const val = parseMultiplier(p.multiplier);
        if (val < minNum) {
          minNum = val;
          minRateStr = p.multiplier;
        }
      }
      return minNum === Infinity ? 'x1.00' : minRateStr;
    }

    // ── 获取积分消耗最低的渠道商（倍率优先，同倍率时免算力 > 签到积分 > 网页端额度 > API）──
    function getBestProvider(providers) {
      if (!providers || providers.length === 0) return null;
      const tierWeight = {
        free: 0,
        points: 1,
        account: 2,
        quota: 3,
        paid: 4
      };
      let best = providers[0];
      let minRate = parseMultiplier(best.multiplier);
      let bestTierWeight = tierWeight[best.tierInfo?.tier] ?? 9;

      for (let i = 1; i < providers.length; i++) {
        const p = providers[i];
        const r = parseMultiplier(p.multiplier);
        const tw = tierWeight[p.tierInfo?.tier] ?? 9;
        if (r < minRate || (r === minRate && tw < bestTierWeight)) {
          minRate = r;
          bestTierWeight = tw;
          best = p;
        }
      }
      return best;
    }

    function isSameProvider(id1, id2) {
      if (!id1 || !id2) return false;
      if (id1 === id2) return true;
      const a = String(id1).toLowerCase();
      const b = String(id2).toLowerCase();
      if (a === b) return true;
      if ((a.includes('agy') || a.includes('antigravity')) && (b.includes('agy') || b.includes('antigravity'))) return true;
      return false;
    }

    // ── 获取某模型的默认使用渠道（优先用户专属收藏渠道，否则为最低积分消耗渠道）────
    function getModelDefaultProvider(item, modelChannelDefaults) {
      if (!item?.providers || item.providers.length === 0) return null;
      const canonKey = item.canonName.toLowerCase();
      const explicit = modelChannelDefaults?.[canonKey];
      if (explicit) {
        const found = item.providers.find(p => isSameProvider(p.providerId, explicit.providerId));
        if (found) return found;
      }
      return getBestProvider(item.providers);
    }

    // ── 精准提取计费倍率 (精确到 2 位小数，如 x0.00 / x0.50 / x1.00 / x1.00→x0.50) ──
    function extractMultiplier(m, providerId) {
      const pId = (providerId || '').toLowerCase();
      const mId = (m?.id || '').toLowerCase();

      // 特别修正：WorkBuddy 国际版官方活动（Free daily use with unlimited credits），DeepSeek Flash 系列及免费模型均为 0.00x
      if (pId === 'workbuddy') {
        if (mId.includes('deepseek') || mId.includes('flash') || mId.includes('step-') || mId.includes('hy')) {
          return 'x0.00';
        }
      }

      // 官方免算力渠道兜底
      if (['our-free-model', 'gemini', 'agy-link', 'gemini-code-assist'].includes(pId)) {
        return 'x0.00';
      }

      let rawRate = null;

      // 1. 如果 m.creditsRate 或 discountedCreditsRate 属性存在
      if (m?.discountedCreditsRate && m?.creditsRate) {
        return `${formatSingleRate(m.creditsRate)}→${formatSingleRate(m.discountedCreditsRate)}`;
      }
      if (m?.creditsRate !== undefined && m?.creditsRate !== null) {
        rawRate = m.creditsRate;
      } else if (m?.costMultiplier !== undefined && m?.costMultiplier !== null) {
        rawRate = m.costMultiplier;
      } else {
        // 2. 从 m.name 中用正则提取（our-free-model 原生拼入的 ' · x0.5' / ' · x1→x0.5' / ' · 免费'）
        const rawName = m?.name || '';

        // 匹配限时促销倍率: x1→x0.5 或 x1->x0.5 或 x1→免费
        const promoMatch = rawName.match(/(?:x\d+(?:\.\d+)?)\s*(?:→|->)\s*(?:x\d+(?:\.\d+)?|免费)/i);
        if (promoMatch) {
          const parts = promoMatch[0].split(/→|->/);
          return `${formatSingleRate(parts[0])}→${formatSingleRate(parts[1])}`;
        }

        // 匹配普通倍率: x0.5, x1, x2, 0.5x, 1x
        const rateMatch = rawName.match(/\b(?:x(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)x)\b/i);
        if (rateMatch) {
          rawRate = rateMatch[1] ?? rateMatch[2];
        } else if (/[\s·\(\[]免费[\s·\)\]]?/i.test(rawName) || m?.isFree === true) {
          rawRate = '0';
        }
      }

      if (rawRate !== null && rawRate !== undefined) {
        return formatSingleRate(rawRate);
      }

      // 3. 兜底按渠道固有特征判断
      if (pId === 'deepseek-account' || pId === 'codearts' || pId === 'siliconflow') {
        return 'x1.00';
      }

      return 'x1.00';
    }

    // ── 计算倍率的色彩等级 ──────────────────────────────────────────────────────
    function getRateClass(multiplier) {
      if (!multiplier) return 'dsh-sm-rate-standard';
      if (multiplier === 'x0.00' || multiplier === 'x0' || multiplier === '0' || multiplier === '免费') {
        return 'dsh-sm-rate-zero';
      }
      if (multiplier.includes('→')) return 'dsh-sm-rate-discount';
      const num = parseFloat(multiplier.replace(/^x/i, ''));
      if (isNaN(num)) return 'dsh-sm-rate-standard';
      if (num === 0) return 'dsh-sm-rate-zero';
      if (num < 1.0) return 'dsh-sm-rate-discount';
      if (num === 1.0) return 'dsh-sm-rate-standard';
      return 'dsh-sm-rate-high';
    }

    function getRateColor(multiplier) {
      if (!multiplier) return '#38bdf8';
      if (multiplier === 'x0.00' || multiplier === 'x0' || multiplier === '0' || multiplier === '免费') {
        return '#4ade80';
      }
      if (multiplier.includes('→')) return '#c084fc';
      const num = parseFloat(multiplier.replace(/^x/i, ''));
      if (isNaN(num)) return '#38bdf8';
      if (num === 0) return '#4ade80';
      if (num < 1.0) return '#c084fc';
      if (num === 1.0) return '#38bdf8';
      return '#fbbf24';
    }

    // ── 渠道消耗等级与定价分类器（结合实时积分）──────────────────────────────────
    function getProviderTierInfo(providerId, multiplier, dynamicChannelInfo) {
      const id = (providerId || '').toLowerCase();
      const dyn = dynamicChannelInfo?.[id];

      // 1. 完全零消耗白嫖通道 (腾讯 WorkBuddy 国际版、免算力车道)
      if (['workbuddy', 'our-free-model'].includes(id) || multiplier === 'x0') {
        return {
          tier: 'free',
          label: '免算力',
          desc: `免算力通道 · ${multiplier} 计费倍率，完全无扣费白嫖 (首选推荐)`,
          cls: 'dsh-sm-tier-free'
        };
      }

      // 2. 每日签到积分池（CodeArts、CodeBuddy、TRAE、LobsterAI、Qoder）
      if (['codearts', 'buddy', 'trae', 'lobsterai', 'qoder', 'qodercn'].includes(id)) {
        let ptsLabel = dyn?.points || '积分';
        if (id === 'codearts') ptsLabel = '+2000分';
        else if (id === 'buddy') ptsLabel = '+200分';
        else if (id === 'trae') ptsLabel = '+200分';
        else if (id === 'lobsterai') ptsLabel = '+100分';
        else if (id.startsWith('qoder')) ptsLabel = '赠额';

        const acctsText = dyn?.accounts ? ` · ${dyn.accounts}账号可用` : '';
        return {
          tier: 'points',
          label: ptsLabel,
          desc: `每日签到积分抵扣池（计费倍率 ${multiplier}，今日签到 ${ptsLabel}${acctsText}）`,
          cls: 'dsh-sm-tier-points'
        };
      }

      // 3. 官方账号（官网网页端 Session）
      if (id === 'deepseek-account') {
        return {
          tier: 'account',
          label: '官网额度',
          desc: `DeepSeek 官方网页端额度（计费倍率 ${multiplier}）`,
          cls: 'dsh-sm-tier-account'
        };
      }

      // 4. 专属配额车道（Gemini / agy）
      if (['gemini', 'agy-link', 'gemini-code-assist'].includes(id)) {
        return {
          tier: 'quota',
          label: '免费配额',
          desc: `Google 开发者阶梯配额（计费倍率 ${multiplier}）`,
          cls: 'dsh-sm-tier-quota'
        };
      }

      // 5. 按量扣费 API（Siliconflow、官方 API、OpenAI 等）
      if (['siliconflow', 'deepseek-official', 'openai', 'anthropic'].includes(id)) {
        return {
          tier: 'paid',
          label: '按量扣费',
          desc: `按 Token 扣除账户余额（计费倍率 ${multiplier}）`,
          cls: 'dsh-sm-tier-paid'
        };
      }

      return {
        tier: 'free',
        label: '渠道',
        desc: `第三方通道（计费倍率 ${multiplier}）`,
        cls: 'dsh-sm-tier-free'
      };
    }

    // ── 模型名智能归一化（去除末尾倍率后缀与组织前缀）───────────────────────────
    function canonicalize(rawId, rawName) {
      let name = (rawName || rawId || '').trim();
      name = name.replace(/^(deepseek-ai|anthropic|openai|meta-llama|google|qwen|moonshotai|z-ai)\//i, '');
      // 剥离末尾的倍率后缀，使同名模型整齐聚类
      name = name
        .replace(/[\s·\-\–\—]+(?:x\d+(?:\.\d+)?(?:\s*(?:→|->)\s*(?:x\d+(?:\.\d+)?|免费))?|\d+(?:\.\d+)?x|免费)\s*$/gi, '')
        .replace(/\s*[\(\[]\s*(?:x\d+(?:\.\d+)?|\d+(?:\.\d+)?x|免费)\s*[\)\]]\s*$/gi, '')
        .trim();

      if (/^deepseek[-_]v?4\.1[-_]flash/i.test(name)) return 'DeepSeek-V4.1-Flash';
      if (/^deepseek[-_]v?4[-_]pro/i.test(name)) return 'DeepSeek-V4-Pro';
      if (/^deepseek[-_]v?3/i.test(name)) return 'DeepSeek-V3';
      if (/^deepseek[-_]r?1/i.test(name)) return 'DeepSeek-R1';
      return name;
    }

    // ── 默认模型、渠道与偏好存储（localStorage + 本地磁盘双重持久化）─────────────────
    const STORAGE_DEFAULT_KEY = 'dsh_sm_default_target_v3';
    const STORAGE_MODEL_DEFAULTS_KEY = 'dsh_sm_model_channel_defaults_v3';
    const STORAGE_FAVORITES_KEY = 'dsh_sm_favorited_models_v3';

    function loadModelChannelDefaults() {
      try {
        const raw = localStorage.getItem(STORAGE_MODEL_DEFAULTS_KEY);
        if (raw) return JSON.parse(raw);
        // 兼容迁移：若旧版 defaultTarget 存在，先作为初始映射
        const oldDefRaw = localStorage.getItem('dsh_sm_default_target_v2');
        if (oldDefRaw) {
          const old = JSON.parse(oldDefRaw);
          if (old?.canonName && old?.providerId) {
            return {
              [old.canonName.toLowerCase()]: {
                providerId: old.providerId,
                modelId: old.modelId,
                providerName: old.providerName,
                multiplier: old.multiplier,
                effort: old.effort
              }
            };
          }
        }
        return {};
      } catch (e) {
        return {};
      }
    }

    function saveModelChannelDefaults(map) {
      try {
        localStorage.setItem(STORAGE_MODEL_DEFAULTS_KEY, JSON.stringify(map));
      } catch (e) {}
    }

    function loadDefaultTarget() {
      try {
        const raw = localStorage.getItem(STORAGE_DEFAULT_KEY) || localStorage.getItem('dsh_sm_default_target_v2');
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        return null;
      }
    }

    function saveDefaultTarget(target) {
      try {
        if (!target) localStorage.removeItem(STORAGE_DEFAULT_KEY);
        else localStorage.setItem(STORAGE_DEFAULT_KEY, JSON.stringify(target));
      } catch (e) {}
    }

    function loadFavoritedModels() {
      try {
        const raw = localStorage.getItem(STORAGE_FAVORITES_KEY) || localStorage.getItem('dsh_sm_favorited_models_v2');
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        return [];
      }
    }

    function saveFavoritedModels(list) {
      try {
        localStorage.setItem(STORAGE_FAVORITES_KEY, JSON.stringify(list));
      } catch (e) {}
    }

    // 后台向本地磁盘 /api/smart-models/preferences 双向同步，确保持久化永不丢失
    async function syncPreferencesToDisk(payload) {
      try {
        await fetch('/api/smart-models/preferences', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } catch (e) {}
    }

    // ── 错误边界容灾容器（确保组件发生任何未预料异常时不被 DSH 宿主卸载）─────────────
    class SmartModelErrorBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
      }
      static getDerivedStateFromError(error) {
        return { hasError: true, error };
      }
      componentDidCatch(error, errorInfo) {
        console.error('[SmartModels] Error caught by boundary:', error, errorInfo);
      }
      render() {
        if (this.state.hasError) {
          return h('button', {
            type: 'button',
            className: 'dsh-sm-trigger',
            onClick: () => this.setState({ hasError: false, error: null }),
            title: `模型选择器遇到异常（点击可重试）：${this.state.error?.message || ''}`
          }, [
            h('span', { className: 'dsh-sm-trigger-text' }, '智能模型 (点击恢复)')
          ]);
        }
        return this.props.children;
      }
    }

    // ── SmartModelSelect React 组件 ──────────────────────────────────────────────
    function SmartModelSelect(props) {
      const effectiveCtx = props.ctx || rootCtx;
      const sessionId = props.sessionId;
      const [open, setOpen] = useState(false);
      const [query, setQuery] = useState('');
      const [catalog, setCatalog] = useState(null);
      const [currentSelection, setCurrentSelection] = useState(null);
      const [modelChannelDefaults, setModelChannelDefaults] = useState(() => loadModelChannelDefaults());
      const [favoritedModels, setFavoritedModels] = useState(() => new Set(loadFavoritedModels()));
      const [hoveredModel, setHoveredModel] = useState(null);
      const [flyoutPos, setFlyoutPos] = useState({ top: 8, flipLeft: false });
      const [popoverCoords, setPopoverCoords] = useState(null);
      const [dynamicChannelInfo, setDynamicChannelInfo] = useState({});

      const triggerRef = useRef(null);
      const popoverRef = useRef(null);
      const searchInputRef = useRef(null);
      const leaveTimerRef = useRef(null);

      // 1. 获取本地 channel-status (签到积分与账号健康度)
      const refreshChannelStatus = useCallback(async () => {
        try {
          const resp = await fetch('/api/smart-models/channel-status');
          if (resp.ok) {
            const data = await resp.json();
            if (data?.ok) {
              const map = {};
              const checkins = data.autoCheckin?.channels || [];
              const accounts = data.state?.accounts || [];

              for (const ch of checkins) {
                map[ch.provider] = {
                  points: ch.text?.match(/\+?\d+积分/)?.[0] || ch.text,
                  rawText: ch.text
                };
              }

              for (const acct of accounts) {
                if (acct.provider) {
                  if (!map[acct.provider]) map[acct.provider] = {};
                  map[acct.provider].accounts = (map[acct.provider].accounts || 0) + 1;
                }
              }

              setDynamicChannelInfo(map);
            }
          }
        } catch (e) {}
      }, []);

      useEffect(() => {
        refreshChannelStatus();
        const timer = setInterval(refreshChannelStatus, 30_000);
        return () => clearInterval(timer);
      }, [refreshChannelStatus]);

      // 1.1 从本地磁盘文件 /api/smart-models/preferences 水合偏好（永久持久化防丢）
      useEffect(() => {
        (async () => {
          try {
            const resp = await fetch('/api/smart-models/preferences');
            if (resp.ok) {
              const res = await resp.json();
              if (res?.ok && res.data) {
                const disk = res.data;
                if (disk.modelChannelDefaults && typeof disk.modelChannelDefaults === 'object') {
                  setModelChannelDefaults(prev => {
                    const merged = { ...disk.modelChannelDefaults, ...prev };
                    saveModelChannelDefaults(merged);
                    return merged;
                  });
                }
                if (Array.isArray(disk.favoritedModels) && disk.favoritedModels.length > 0) {
                  setFavoritedModels(prev => {
                    const next = new Set([...prev, ...disk.favoritedModels]);
                    saveFavoritedModels(Array.from(next));
                    return next;
                  });
                }
              }
            }
          } catch (e) {}
        })();
      }, []);

      // 2. 获取会话与模型目录
      const sessions = effectiveCtx?.sessions;
      const remoteSession = effectiveCtx?.remote?.session;

      const refreshCatalog = useCallback(async () => {
        if (!remoteSession?.modelCatalog) return;
        try {
          const resp = await remoteSession.modelCatalog();
          if (resp?.ok && resp.value) {
            setCatalog(resp.value);
          }
        } catch (e) {
          console.warn('[SmartModels] 加载模型目录失败:', e);
        }
      }, [remoteSession]);

      useEffect(() => {
        refreshCatalog();
        const un1 = effectiveCtx?.remote?.$on?.('llm/adapters-updated', refreshCatalog);
        const un2 = effectiveCtx?.remote?.$on?.('settings/document-updated', refreshCatalog);
        const un3 = effectiveCtx?.remote?.$on?.('credentials/record-updated', refreshCatalog);
        return () => {
          if (typeof un1 === 'function') un1();
          if (typeof un2 === 'function') un2();
          if (typeof un3 === 'function') un3();
        };
      }, [effectiveCtx, refreshCatalog]);

      // 安全调用底层 RPC 选择模型
      const invokeSelectModel = useCallback(async (payload) => {
        try {
          if (typeof remoteSession?.selectModel === 'function') {
            return await remoteSession.selectModel(payload);
          }
          if (typeof sessions?.selectModel === 'function') {
            return await sessions.selectModel(payload);
          }
          if (typeof effectiveCtx?.remote?.session?.selectModel === 'function') {
            return await effectiveCtx.remote.session.selectModel(payload);
          }
          console.warn('[SmartModels] 未能找到有效的 selectModel RPC 接口');
        } catch (e) {
          console.error('[SmartModels] selectModel RPC 执行异常:', e);
        }
      }, [remoteSession, sessions, effectiveCtx]);

      // 3. 观察当前会话选择（每个窗口独立隔离，完全由会话自身状态决定）
      useEffect(() => {
        if (!sessions || !sessionId) return;
        let binding = null;
        try {
          binding = sessions.binding?.(sessionId);
        } catch (e) {
          return;
        }
        if (!binding?.session?.projections?.faceOf) return;

        let projection = null;
        try {
          projection = binding.session.projections.faceOf('modelSelection');
        } catch (e) {
          return;
        }
        if (!projection) return;

        const updateCurrent = () => {
          try {
            const snapshot = projection.getSnapshot?.();
            const sel = snapshot?.next || snapshot?.current || null;
            setCurrentSelection(sel);
          } catch (err) {
            console.warn('[SmartModels] updateCurrent 异常已静默兜底:', err);
          }
        };

        updateCurrent();
        const unsub = projection.subscribe?.(updateCurrent);
        return () => {
          if (typeof unsub === 'function') unsub();
        };
      }, [sessions, sessionId]);

    // 思考档位中文化显示
    function formatEffortLabel(effort) {
      if (!effort) return '';
      const map = {
        high: '高',
        medium: '中',
        low: '低',
        max: '极高',
        off: '关闭'
      };
      return map[String(effort).toLowerCase()] || effort;
    }

    // ── 模型归一化聚类、倍率计算与渠道智能去重
      const aggregatedModels = useMemo(() => {
        if (!catalog?.groups) return [];
        const map = new Map();

        for (const group of catalog.groups) {
          const providerId = group.id;
          let providerName = formatProviderName(providerId, group.name);

          for (const m of (group.models || [])) {
            const canonName = canonicalize(m.id, m.name);
            const key = canonName.toLowerCase();
            const multiplier = extractMultiplier(m, providerId);
            const rateCls = getRateClass(multiplier);

            if (!map.has(key)) {
              map.set(key, {
                canonName,
                providers: []
              });
            }

            const existing = map.get(key).providers;
            // 解决多账号重复 Badge 问题：按 providerId 去重并计数
            const duplicate = existing.find(p => p.providerId === providerId);
            if (!duplicate) {
              existing.push({
                providerId,
                providerName,
                modelId: m.id,
                modelName: m.name || m.id,
                multiplier,
                rateCls,
                reasoning: m.reasoning || null,
                accountCount: 1,
                tierInfo: getProviderTierInfo(providerId, multiplier, dynamicChannelInfo)
              });
            } else {
              duplicate.accountCount = (duplicate.accountCount || 1) + 1;
              // 优先保留更优惠的倍率展示
              if (multiplier && multiplier !== duplicate.multiplier) {
                duplicate.multiplier = multiplier;
                duplicate.rateCls = rateCls;
              }
            }
          }
        }

        return Array.from(map.values());
      }, [catalog, dynamicChannelInfo]);

      // 5. 计算当前选中的详情（包含倍率）
      const activeInfo = useMemo(() => {
        if (!currentSelection || !catalog) {
          const def = catalog?.default;
          if (def) {
            const grp = catalog.groups?.find(g => g.id === def.provider);
            const rawM = grp?.models?.find(m => m.id === def.model);
            const canon = rawM ? canonicalize(rawM.id, rawM.name) : canonicalize(def.model, def.model);
            const multiplier = rawM ? extractMultiplier(rawM, def.provider) : 'x1.00';
            return {
              canonName: canon,
              providerId: def.provider,
              providerName: formatProviderName(def.provider, grp?.name || def.provider),
              modelId: def.model,
              multiplier,
              effort: def.reasoningEffort
            };
          }
          return null;
        }

        const grp = catalog.groups?.find(g => g.id === currentSelection.provider);
        let pName = formatProviderName(currentSelection.provider, grp?.name);
        let multiplier = 'x1.00';
        let canon = canonicalize(currentSelection.model, currentSelection.model);
        if (grp) {
          const rawM = grp.models?.find(m => m.id === currentSelection.model);
          if (rawM) {
            canon = canonicalize(rawM.id, rawM.name);
            multiplier = extractMultiplier(rawM, currentSelection.provider);
          }
        }

        return {
          canonName: canon,
          providerId: currentSelection.provider,
          providerName: pName,
          modelId: currentSelection.model,
          multiplier,
          effort: currentSelection.reasoningEffort
        };
      }, [currentSelection, catalog]);

      // 6. 切换模型操作（加锁防重置 + 乐观更新）
      const handleSelect = useCallback(async (providerId, modelId, effort) => {
        if (!sessionId) return;
        try {
          const payload = {
            sessionId,
            provider: providerId,
            model: modelId,
            ...(effort !== undefined ? { reasoningEffort: effort } : {})
          };
          setCurrentSelection({ provider: providerId, model: modelId, reasoningEffort: effort });
          await invokeSelectModel(payload);
        } catch (e) {
          console.error('[SmartModels] 切换模型失败:', e);
        }
      }, [sessionId, invokeSelectModel]);

      // 7. 渠道级星标：收藏该模型的首选渠道（纯收藏记忆，不执行即时切换，不影响其他会话）
      const handleSetDefault = useCallback((item, p) => {
        const canonKey = item.canonName.toLowerCase();
        const currentStarred = modelChannelDefaults[canonKey];
        const isCurrentChannelStarred = isSameProvider(currentStarred?.providerId, p.providerId);

        if (isCurrentChannelStarred) {
          // 点击已选中的星标：取消该模型的偏好渠道
          const nextMap = { ...modelChannelDefaults };
          delete nextMap[canonKey];
          setModelChannelDefaults(nextMap);
          saveModelChannelDefaults(nextMap);

          syncPreferencesToDisk({
            modelChannelDefaults: nextMap,
            favoritedModels: Array.from(favoritedModels)
          });
        } else {
          // 设为该模型的永久默认渠道
          const channelInfo = {
            canonName: item.canonName,
            providerId: p.providerId,
            providerName: p.providerName,
            modelId: p.modelId,
            multiplier: p.multiplier,
            effort: p.reasoning?.defaultEffort || 'high'
          };
          const nextMap = {
            ...modelChannelDefaults,
            [canonKey]: channelInfo
          };
          setModelChannelDefaults(nextMap);
          saveModelChannelDefaults(nextMap);

          // 核心要求：星标主要是收藏，不是确认使用，因此不调用 handleSelect()
          // 且绝对不强制设为全局新会话默认，保障多会话独立隔离

          syncPreferencesToDisk({
            modelChannelDefaults: nextMap,
            favoritedModels: Array.from(favoritedModels)
          });
        }
      }, [modelChannelDefaults, favoritedModels]);

      // 打开时自动聚焦搜索框
      useEffect(() => {
        if (open) {
          setTimeout(() => searchInputRef.current?.focus(), 60);
        }
      }, [open]);

      // 点击外侧或按 Esc 自动关闭
      useEffect(() => {
        if (!open) return;
        const handleDown = (e) => {
          if (
            triggerRef.current?.contains(e.target) ||
            popoverRef.current?.contains(e.target)
          ) {
            return;
          }
          setOpen(false);
        };
        const handleKeyDown = (e) => {
          if (e.key === 'Escape') {
            setOpen(false);
          }
        };
        document.addEventListener('pointerdown', handleDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
          document.removeEventListener('pointerdown', handleDown);
          document.removeEventListener('keydown', handleKeyDown);
        };
      }, [open]);

      // 8. 切换模型收藏状态（复数收藏并置顶）
      const handleToggleFavorite = useCallback((canonName) => {
        const key = canonName.toLowerCase();
        setFavoritedModels(prev => {
          const next = new Set(prev);
          if (next.has(key)) {
            next.delete(key);
          } else {
            next.add(key);
          }
          const arr = Array.from(next);
          saveFavoritedModels(arr);
          syncPreferencesToDisk({
            modelChannelDefaults,
            favoritedModels: arr
          });
          return next;
        });
      }, [modelChannelDefaults]);


      // 10. 过滤主列表并根据置顶状态与当前会话激活状态智能排序
      // 排序规则：
      // Rank 1: 置顶模型且为当前选中的模型 -> 保持在置顶模型的最上方
      // Rank 2: 其他置顶模型 -> 排在置顶区域
      // Rank 3: 未置顶但当前选中的模型 -> 排序挪上来，保持在置顶模型的下方、普通模型的最上方
      // Rank 4: 普通未置顶模型 -> 保持原始目录顺序
      const filteredList = useMemo(() => {
        const q = query.trim().toLowerCase();
        let list = aggregatedModels;
        if (q) {
          list = aggregatedModels.filter(m => {
            if (m.canonName.toLowerCase().includes(q)) return true;
            return m.providers.some(p =>
              p.providerName.toLowerCase().includes(q) ||
              p.modelId.toLowerCase().includes(q) ||
              (p.multiplier && p.multiplier.toLowerCase().includes(q))
            );
          });
        }

        const activeCanonKey = activeInfo?.canonName ? activeInfo.canonName.toLowerCase() : null;

        return [...list].sort((a, b) => {
          const aKey = a.canonName.toLowerCase();
          const bKey = b.canonName.toLowerCase();
          const aFav = favoritedModels.has(aKey);
          const bFav = favoritedModels.has(bKey);
          const aActive = Boolean(activeCanonKey && aKey === activeCanonKey);
          const bActive = Boolean(activeCanonKey && bKey === activeCanonKey);

          let aRank = 4;
          if (aFav && aActive) aRank = 1;
          else if (aFav) aRank = 2;
          else if (aActive) aRank = 3;

          let bRank = 4;
          if (bFav && bActive) bRank = 1;
          else if (bFav) bRank = 2;
          else if (bActive) bRank = 3;

          if (aRank !== bRank) return aRank - bRank;
          return 0;
        });
      }, [aggregatedModels, query, favoritedModels, activeInfo?.canonName]);

      // 当前伴随卡片对应的模型对象
      const activeCompanionItem = useMemo(() => {
        if (!hoveredModel) return null;
        return aggregatedModels.find(m => m.canonName.toLowerCase() === hoveredModel.canonName.toLowerCase()) || hoveredModel;
      }, [hoveredModel, aggregatedModels]);

      // 动态测量计算伴随卡片的 Y 轴动态对齐与屏幕贴边避障 (方案 2 核心)
      const calculateFlyoutPos = useCallback((rowEl, popoverEl, providerCount) => {
        if (!rowEl || !popoverEl) return { top: 0, flipLeft: false };
        const popoverRect = popoverEl.getBoundingClientRect();
        const rowRect = rowEl.getBoundingClientRect();
        const flyoutWidth = 245;
        const estFlyoutHeight = Math.min(380, 52 + providerCount * 42);

        // 1. 水平避障：右侧不够空间则翻转到左侧
        const flipLeft = (popoverRect.right + flyoutWidth + 12) > window.innerWidth;

        // 2. 垂直 Y 轴跟随与视口防溢出 (Viewport Clamping)
        const minGlobalTop = 12;
        const maxGlobalTop = window.innerHeight - estFlyoutHeight - 12;
        const targetGlobalTop = Math.max(minGlobalTop, Math.min(rowRect.top - 4, maxGlobalTop));

        // 转换为主卡片内的相对 top
        const topRel = targetGlobalTop - popoverRect.top;
        return { top: Math.round(topRel), flipLeft };
      }, []);

      const handleRowMouseEnter = useCallback((item, e) => {
        if (leaveTimerRef.current) {
          clearTimeout(leaveTimerRef.current);
          leaveTimerRef.current = null;
        }
        const pos = calculateFlyoutPos(e.currentTarget, popoverRef.current, item.providers.length);
        setFlyoutPos(pos);
        setHoveredModel(item);
      }, [calculateFlyoutPos]);

      const handleRowMouseLeave = useCallback(() => {
        if (leaveTimerRef.current) {
          clearTimeout(leaveTimerRef.current);
        }
        leaveTimerRef.current = setTimeout(() => {
          setHoveredModel(null);
        }, 150);
      }, []);

      const handleFlyoutMouseEnter = useCallback(() => {
        if (leaveTimerRef.current) {
          clearTimeout(leaveTimerRef.current);
          leaveTimerRef.current = null;
        }
      }, []);

      const handleFlyoutMouseLeave = useCallback(() => {
        if (leaveTimerRef.current) {
          clearTimeout(leaveTimerRef.current);
        }
        leaveTimerRef.current = setTimeout(() => {
          setHoveredModel(null);
        }, 150);
      }, []);

      // 动态精确测量触发器位置，确保 popover fixed 挂载在 body 上时位置精准 (黄金单列 270px)
      const updatePopoverPosition = useCallback(() => {
        if (!triggerRef.current) return;
        const rect = triggerRef.current.getBoundingClientRect();
        const popoverWidth = 270;
        const left = Math.max(12, Math.min(rect.left, window.innerWidth - popoverWidth - 12));
        const bottom = Math.max(12, window.innerHeight - rect.top + 8);
        setPopoverCoords({ left, bottom });
      }, []);

      useEffect(() => {
        if (open) {
          updatePopoverPosition();
          setHoveredModel(null);
          window.addEventListener('resize', updatePopoverPosition);
          window.addEventListener('scroll', updatePopoverPosition, true);
          return () => {
            window.removeEventListener('resize', updatePopoverPosition);
            window.removeEventListener('scroll', updatePopoverPosition, true);
          };
        } else {
          setHoveredModel(null);
          if (leaveTimerRef.current) {
            clearTimeout(leaveTimerRef.current);
            leaveTimerRef.current = null;
          }
        }
      }, [open, updatePopoverPosition]);

      // 当前激活的推理档位配置
      const activeReasoning = useMemo(() => {
        if (!activeInfo || !catalog?.groups) return null;
        const grp = catalog.groups.find(g => g.id === activeInfo.providerId);
        const mdl = grp?.models?.find(m => m.id === activeInfo.modelId);
        return mdl?.reasoning || null;
      }, [activeInfo, catalog]);

      // ── 触发器按钮（极致紧凑设计，避免挤占输入框空间）──
      const triggerButton = h('button', {
        ref: triggerRef,
        className: `dsh-sm-trigger ${open ? 'open' : ''}`,
        onClick: () => setOpen(!open),
        title: activeInfo
          ? `模型：${activeInfo.canonName}\n渠道：${activeInfo.providerName}\n计费倍率：${activeInfo.multiplier}${activeInfo.effort ? `\n思考档位：${formatEffortLabel(activeInfo.effort)} (${activeInfo.effort})` : ''}\n点击打开选择面板`
          : '智能模型聚合与切换（点击打开面板）'
      }, [
        // Sparkle 图标
        h('svg', {
          style: { flexShrink: 0 },
          viewBox: '0 0 24 24',
          width: 14,
          height: 14,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round'
        }, [
          h('path', { d: 'm12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z' })
        ]),
        // 文字展示：模型名（超长截断） + 渠道极简缩写 (如 agy) + 紧凑倍率 (如 [1x]) + 思考档位
        h('span', { className: 'dsh-sm-trigger-text' },
          activeInfo ? activeInfo.canonName : '选择模型'
        ),
        activeInfo && h('span', { className: 'dsh-sm-trigger-provider' },
          `· ${formatTriggerProviderName(activeInfo.providerId, activeInfo.providerName)}`
        ),
        activeInfo?.multiplier && h('span', {
          className: 'dsh-sm-trigger-rate',
          style: {
            color: getRateColor(activeInfo.multiplier)
          }
        }, `[${formatCompactRate(activeInfo.multiplier)}]`),
        activeInfo?.effort && h('span', { className: 'dsh-sm-trigger-effort' },
          `· ${formatEffortLabel(activeInfo.effort)}`
        ),
        // 箭头
        h('svg', {
          className: `dsh-sm-chevron ${open ? 'open' : ''}`,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2.5
        }, [
          h('path', { d: 'm6 9 6 6 6-6' })
        ])
      ]);

      // ── 浮层主面板（方案 2：动态伴随卡片，左侧主卡片 270px + 右侧动态伴随 245px）──
      const popoverElement = open && h('div', {
        ref: popoverRef,
        className: 'dsh-sm-popover',
        style: popoverCoords ? {
          position: 'fixed',
          left: `${popoverCoords.left}px`,
          bottom: `${popoverCoords.bottom}px`,
          zIndex: 999999
        } : {
          position: 'absolute',
          bottom: 'calc(100% + 8px)',
          left: 0,
          zIndex: 999999
        }
      }, [
        // ── 主卡片 (宽 270px) ──
        h('div', { key: 'main-card', className: 'dsh-sm-main-card' }, [
          // 搜索栏
          h('div', { key: 'search', className: 'dsh-sm-search-row' }, [
            h('svg', {
              className: 'dsh-sm-search-icon',
              viewBox: '0 0 24 24',
              fill: 'none',
              stroke: 'currentColor',
              strokeWidth: 2
            }, [
              h('circle', { cx: 11, cy: 11, r: 8 }),
              h('path', { d: 'm21 21-4.35-4.35' })
            ]),
            h('input', {
              ref: searchInputRef,
              className: 'dsh-sm-search-input',
              placeholder: '搜索模型或渠道...',
              value: query,
              onChange: (e) => setQuery(e.target.value)
            }),
            query && h('button', {
              className: 'dsh-sm-search-clear',
              onClick: () => setQuery('')
            }, '×')
          ]),

          // 模型列表 (严格 32px 定高，零位移)
          h('div', { key: 'models-view', className: 'dsh-sm-models-view' }, [
            h('div', { className: 'dsh-sm-master-col' }, [
              filteredList.length === 0
                ? h('div', { className: 'dsh-sm-empty' }, '未找到匹配模型')
                : filteredList.map(item => {
                    const canonKey = item.canonName.toLowerCase();
                    const isSessionModel = activeInfo?.canonName && activeInfo.canonName.toLowerCase() === canonKey;
                    const isHovered = hoveredModel?.canonName && hoveredModel.canonName.toLowerCase() === canonKey;
                    const isFav = favoritedModels.has(canonKey);

                    // 核心逻辑：若为当前会话激活模型，显示当前会话实际使用的渠道与倍率；否则显示该模型的首选默认渠道与倍率
                    const defProvider = getModelDefaultProvider(item, modelChannelDefaults);
                    const activeProvider = isSessionModel
                      ? (item.providers.find(p => isSameProvider(p.providerId, activeInfo.providerId) && p.modelId === activeInfo.modelId) || defProvider)
                      : null;
                    const displayProvider = isSessionModel ? activeProvider : defProvider;
                    const displayRate = displayProvider?.multiplier || getLowestRate(item.providers);
                    const displayShortChannel = displayProvider
                      ? formatTriggerProviderName(displayProvider.providerId, displayProvider.providerName)
                      : '';

                    return h('div', {
                      key: item.canonName,
                      className: `dsh-sm-master-item ${isSessionModel ? 'is-active-session' : ''} ${isHovered ? 'is-hovered' : ''} ${isFav ? 'is-favorited' : ''}`,
                      title: isSessionModel
                        ? `当前会话正在使用: ${displayProvider?.providerName || ''} [${displayProvider?.multiplier || ''}]\n鼠标悬停查看全部 ${item.providers.length} 个渠道`
                        : `默认渠道: ${displayProvider?.providerName || ''} [${displayProvider?.multiplier || ''}]\n鼠标悬停查看全部 ${item.providers.length} 个渠道`,
                      onMouseEnter: (e) => handleRowMouseEnter(item, e),
                      onMouseLeave: handleRowMouseLeave,
                      onClick: () => {
                        const targetProvider = isSessionModel ? (activeProvider || defProvider) : defProvider;
                        if (targetProvider) {
                          if (!isSessionModel || !isSameProvider(targetProvider.providerId, activeInfo?.providerId) || targetProvider.modelId !== activeInfo?.modelId) {
                            handleSelect(targetProvider.providerId, targetProvider.modelId, activeInfo?.effort || targetProvider.reasoning?.defaultEffort);
                          }
                        }
                      }
                    }, [
                      // 左侧：收藏星标开关（激活显示实心星，未激活hover显示空心星开关） + 模型名
                      h('div', { className: 'dsh-sm-master-left' }, [
                        h('button', {
                          type: 'button',
                          className: `dsh-sm-master-fav-btn ${isFav ? 'is-fav' : ''}`,
                          title: isFav ? '取消收藏该模型' : '收藏该模型并置顶',
                          onClick: (e) => {
                            e.stopPropagation();
                            handleToggleFavorite(item.canonName);
                          }
                        }, isFav ? '★' : '☆'),
                        h('span', { className: 'dsh-sm-master-name', title: item.canonName }, item.canonName)
                      ]),
                      // 右侧：渠道极简缩写 (如 agy) + 倍率微标 + 箭头
                      h('div', { className: 'dsh-sm-master-right' }, [
                        displayShortChannel && h('span', {
                          className: 'dsh-sm-master-channel-name',
                          title: `渠道: ${displayProvider?.providerName || displayShortChannel}`
                        }, displayShortChannel),
                        h('span', { className: `dsh-sm-rate-tag ${getRateClass(displayRate)}` }, formatCompactRate(displayRate)),
                        h('span', { className: 'dsh-sm-master-arrow' }, '›')
                      ])
                    ]);
                  })
            ])
          ]),

          // 底部思考档位栏（当当前激活模型支持思考时）
          activeReasoning?.efforts && activeReasoning.efforts.length > 0 && h('div', { key: 'effort-row', className: 'dsh-sm-effort-row' }, [
            h('span', { className: 'dsh-sm-effort-label' }, '思考档位:'),
            h('div', { className: 'dsh-sm-effort-pills' },
              activeReasoning.efforts.map(eff => {
                const isEffActive = (activeInfo?.effort ?? activeReasoning.defaultEffort) === eff.id;
                return h('button', {
                  key: eff.id,
                  type: 'button',
                  className: `dsh-sm-effort-pill ${isEffActive ? 'active' : ''}`,
                  onClick: () => handleSelect(activeInfo.providerId, activeInfo.modelId, eff.id)
                }, eff.name || eff.id);
              })
            )
          ])
        ]),

        // ── 方案 2：动态伴随渠道卡片 (浮动在右侧/左侧，动态 Y 轴跟随) ──
        activeCompanionItem && h('div', {
          key: 'companion-flyout',
          className: `dsh-sm-companion-flyout ${flyoutPos.flipLeft ? 'flip-left' : ''}`,
          style: {
            top: `${flyoutPos.top}px`
          },
          onMouseEnter: handleFlyoutMouseEnter,
          onMouseLeave: handleFlyoutMouseLeave
        }, [
          // 头部：模型名 + 渠道总数（移除右侧多余的模型收藏按钮）
          h('div', { className: 'dsh-sm-companion-head' }, [
            h('div', { className: 'dsh-sm-companion-title-wrap' }, [
              h('div', { className: 'dsh-sm-companion-title', title: activeCompanionItem.canonName }, activeCompanionItem.canonName),
              h('span', { className: 'dsh-sm-companion-count' }, `${activeCompanionItem.providers.length}渠道`)
            ])
          ]),

          // 渠道列表：纯净化极简卡片（仅渠道名 + 倍率 + [使用中] + 默认渠道星标）
          h('div', { className: 'dsh-sm-companion-channels' },
            activeCompanionItem.providers.map(p => {
              const isThisActive = isSameProvider(activeInfo?.providerId, p.providerId) && activeInfo?.modelId === p.modelId;
              const canonKey = activeCompanionItem.canonName.toLowerCase();
              const starredSetting = modelChannelDefaults[canonKey];
              const isThisStarred = Boolean(starredSetting && isSameProvider(starredSetting.providerId, p.providerId));

              return h('div', {
                key: `${p.providerId}-${p.modelId}`,
                className: `dsh-sm-detail-card ${isThisActive ? 'active' : ''}`,
                title: `点击切换至 ${p.providerName} [${formatCompactRate(p.multiplier)}]`,
                onClick: () => {
                  handleSelect(p.providerId, p.modelId, activeInfo?.effort || p.reasoning?.defaultEffort);
                }
              }, [
                h('div', { className: 'dsh-sm-detail-left' }, [
                  h('span', { className: 'dsh-sm-detail-provider-name' }, p.providerName),
                  h('span', { className: `dsh-sm-rate-tag ${p.rateCls}` }, formatCompactRate(p.multiplier))
                ]),
                h('div', { className: 'dsh-sm-detail-right' }, [
                  isThisActive && h('span', { className: 'dsh-sm-detail-active-badge' }, '使用中'),
                  h('button', {
                    type: 'button',
                    className: `dsh-sm-badge-star ${isThisStarred ? 'is-default' : ''}`,
                    title: isThisStarred
                      ? '★ 当前默认首选渠道（点击取消）'
                      : '☆ 设为该模型的默认偏好渠道',
                    onClick: (e) => {
                      e.stopPropagation();
                      handleSetDefault(activeCompanionItem, p);
                    }
                  }, isThisStarred ? '★' : '☆')
                ])
              ]);
            })
          )
        ])
      ]);

      const renderedPopover = (open && createPortal)
        ? createPortal(popoverElement, document.body)
        : popoverElement;

      return h('div', { className: 'dsh-sm-root' }, [
        triggerButton,
        renderedPopover
      ]);
    }

    // ── 容灾安全包装组件 ────────────────────────────────────────────────────────
    function SafeSmartModelSelect(props) {
      return h(SmartModelErrorBoundary, null, h(SmartModelSelect, props));
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 渠道积分透视 HUD（由独立插件 dsh-channel-credits-hud 聚合而来）
    //   · 跟随当前会话所选模型，展示该渠道所有账号的积分总余额；
    //   · 任务开始快照、任务结束强制重查并结算本轮消耗差值；
    //   · 只读消费 our-free-model 的 channel-pack RPC，不修改其任何状态。
    // ══════════════════════════════════════════════════════════════════════════

    // ── 渠道显示名称规范化（模块级：SmartModelSelect 与 CreditsHud 共用）──────
    function formatProviderName(providerId, rawName) {
      const id = (providerId || '').toLowerCase();
      if (id.includes('agy') || id.includes('antigravity')) return 'Antigravity (agy CLI)';
      if (id === 'gemini') return 'Google Gemini (官方)';
      if (id === 'gemini-code-assist') return 'Gemini Code Assist';
      if (id === 'buddy') return 'WorkBuddy (国内)';
      if (id === 'workbuddy') return 'WorkBuddy (国际版)';
      if (id === 'deepseek-account') return '官方账号';
      if (id === 'deepseek-official') return '官方 API';
      if (id === 'our-free-model') return '免算力车道';
      if (id === 'trae') return 'TRAE (字节)';
      if (id === 'lobsterai') return 'LobsterAI (有道)';
      if (id === 'codearts') return 'CodeArts Agent';
      if (id === 'qodercn' || id === 'qoder') return 'Qoder (中国版)';
      if (id === 'siliconflow') return 'Siliconflow';
      return rawName || providerId;
    }

    // 渠道极简缩写（专门用于底部狭窄的触发器按钮展示，杜绝换行溢出）
    function formatTriggerProviderName(providerId, rawName) {
      const id = (providerId || '').toLowerCase();
      const raw = (rawName || '').toLowerCase();
      if (id.includes('agy') || id.includes('antigravity') || raw.includes('antigravity')) return 'agy';
      if (id === 'gemini') return 'Gemini';
      if (id === 'gemini-code-assist') return 'GCA';
      if (id === 'workbuddy') return 'WB国际';
      if (id === 'buddy') return 'WB国内';
      if (id === 'deepseek-account') return '官网';
      if (id === 'deepseek-official') return '官方API';
      if (id === 'our-free-model') return '免算力';
      if (id === 'trae') return 'TRAE';
      if (id === 'lobsterai') return 'Lobster';
      if (id === 'codearts') return 'CodeArts';
      if (id.startsWith('qoder')) return 'Qoder';
      if (id === 'siliconflow') return '硅基';
      const cleaned = (rawName || providerId || '').replace(/\(.*?\)/g, '').trim();
      const first = cleaned.split(/[\s_-]+/)[0] || cleaned;
      // 未知渠道兜底：最多 8 个字符，避免撑破输入栏
      return first.length > 8 ? first.slice(0, 8) : first;
    }

    // 余额结果缓存有效期：60 秒内切换模型复用上次结果，避免反复触发昂贵的串行查询
    const CREDITS_CACHE_TTL_MS = 60_000;

    // 是否为 agy（Antigravity CLI）渠道：它的额度不走 channel-pack
    function isAgyProvider(providerId) {
      const id = String(providerId || '').toLowerCase();
      return id.includes('agy') || id.includes('antigravity');
    }

    // 汇总宿主 /api/smart-models/agy-quota 返回的窗口额度
    function summarizeAgyQuota(data) {
      const rows = Array.isArray(data?.accounts) ? data.accounts : [];
      let worstQuota = null;
      let worstAccount = '';
      let windows = [];
      let resetAt = '';
      let reason = '';
      let known = 0;

      for (const row of rows) {
        const ws = Array.isArray(row?.windows) ? row.windows : [];
        if (ws.length === 0) continue;
        known += 1;
        const rowWorst = ws.reduce((m, w) => {
          const r = Number(w?.remaining);
          if (!Number.isFinite(r)) return m;
          return m === null ? r : Math.min(m, r);
        }, null);
        if (rowWorst !== null && (worstQuota === null || rowWorst < worstQuota)) {
          worstQuota = rowWorst;
          worstAccount = row.nickname || row.accountId || '';
          windows = ws.map(w => ({
            name: typeof w?.name === 'string' ? w.name : '窗口',
            remaining: Number(w?.remaining),
            resetTime: typeof w?.resetTime === 'string' ? w.resetTime : ''
          }));
          resetAt = windows.find(w => w.resetTime)?.resetTime || '';
        }
      }

      if (known === 0) reason = data?.accounts?.length ? '账号尚未同步额度' : '没有启用的 agy 账号';

      return {
        total: 0,
        known,
        failed: 0,
        unit: '%',
        reason,
        accounts: rows.length,
        quotaMode: true,
        worstQuota,
        worstAccount,
        windows,
        resetAt
      };
    }

    // 渠道图标（展示名统一复用 formatTriggerProviderName，保证与触发器一致）
    const CCHUD_PROVIDER_ICONS = {
      codearts: '🅲',
      buddy: '🐧',
      workbuddy: '🐧',
      lobsterai: '🦞',
      trae: '🅣',
      qoder: '🆀',
      qodercn: '🆀',
      cline: '🅲',
      loomy: '🅻',
      raccoon: '🦝',
      minimax: '🅼',
      zcode: '🆉',
      gemini: '✦'
    };

    // 该渠道是否计入积分体系（决定 HUD 是否显示）
    // 渠道图标解析：白名单给专属图标，未知渠道返回通用图标
    // ⚠️ 不返回 null —— 否则新接入的积分渠道会静默不显示。
    // 真正决定「显不显示」的是能否查到有效余额，而不是这个白名单。
    function cchudProviderIcon(providerId) {
      const id = String(providerId || '').toLowerCase();
      if (id.includes('agy') || id.includes('antigravity')) return '✦';
      if (CCHUD_PROVIDER_ICONS[id]) return CCHUD_PROVIDER_ICONS[id];
      for (const key of Object.keys(CCHUD_PROVIDER_ICONS)) {
        if (id.includes(key)) return CCHUD_PROVIDER_ICONS[key];
      }
      // 未知渠道：用通用圆点作为图标，仍可显示余额
      return '●';
    }

    // 单位中文化：服务端下发的是 "credit" / "token" / "%" 这类标识
    function formatCreditUnitLabel(unit) {
      const u = String(unit || '').toLowerCase();
      if (u === 'token' || u === 'tokens') return 'Token';
      if (u === '%' || u === 'percent') return '%';
      return '分';
    }

    // 百分比格式化：保留最多 1 位小数
    function formatPercent(value) {
      if (!Number.isFinite(value)) return '—';
      const rounded = Math.round(value * 10) / 10;
      return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`;
    }

    // 重置时间格式化：今天/明天 HH:mm，其余显示 M月D日 HH:mm
    function formatResetTime(iso) {
      if (typeof iso !== 'string' || iso === '') return '';
      const t = Date.parse(iso);
      if (!Number.isFinite(t)) return '';
      const d = new Date(t);
      const now = new Date();
      const sameDay = d.toDateString() === now.toDateString();
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      if (sameDay) return `今天 ${hh}:${mm}`;
      const tomorrow = new Date(now);
      tomorrow.setDate(now.getDate() + 1);
      if (d.toDateString() === tomorrow.toDateString()) return `明天 ${hh}:${mm}`;
      return `${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}`;
    }

    // 千分位格式化：12345 -> 12,345
    function formatCreditsAmount(value) {
      if (!Number.isFinite(value)) return '—';
      const rounded = Math.round(value * 100) / 100;
      const text = Number.isInteger(rounded)
        ? String(rounded)
        : rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
      const [intPart, decPart] = text.split('.');
      const withSeparators = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      return decPart ? `${withSeparators}.${decPart}` : withSeparators;
    }

    // 汇总 credits.balances 返回的账号余额
    // ⚠️ 两种语义必须区分：
    //   1. 积分型（codearts/buddy/trae/...）：balance.total 是可相加的积分数量，unit='credit'
    //   2. 配额型（gemini 等）：balance.total 是各窗口剩余百分比的均值，unit='%'
    //      跨账号相加百分比毫无意义，因此配额型改为「取最低账号百分比」作为健康度
    function summarizeCreditsBalances(value) {
      const accounts = Array.isArray(value?.accounts) ? value.accounts : [];
      let total = 0;
      let known = 0;
      let failed = 0;
      let unit = '';
      let reason = '';
      let quotaMode = false;
      let worstQuota = null;
      let worstAccount = '';
      const windows = [];   // 配额型的窗口明细（取第一个可用账号）
      let resetAt = '';

      for (const row of accounts) {
        const balance = row?.balance;
        if (balance && Number.isFinite(balance.total)) {
          known += 1;
          const pkgs = Array.isArray(balance.packages) ? balance.packages : [];
          const pkgUnit = pkgs.find(p => typeof p?.unit === 'string' && p.unit !== '')?.unit;
          if (!unit && pkgUnit) unit = pkgUnit;
          const isQuota = pkgUnit === '%' || pkgUnit === 'percent';
          if (isQuota) {
            quotaMode = true;
            // 该账号取所有窗口里的最低剩余百分比作为它的健康度
            const rowWorst = pkgs.reduce((min, p) => {
              const r = Number(p?.remaining);
              if (!Number.isFinite(r)) return min;
              return min === null ? r : Math.min(min, r);
            }, null);
            if (rowWorst !== null && (worstQuota === null || rowWorst < worstQuota)) {
              worstQuota = rowWorst;
              worstAccount = row.nickname || row.accountId || '';
              // 窗口明细必须与最低值同源，否则会出现「显示 A 账号的最低值、却列 B 账号的窗口」
              windows.length = 0;
              resetAt = '';
              for (const p of pkgs) {
                const r = Number(p?.remaining);
                if (!Number.isFinite(r)) continue;
                windows.push({
                  name: typeof p?.name === 'string' ? p.name : '窗口',
                  remaining: r,
                  resetTime: typeof p?.cycleEndTime === 'string' ? p.cycleEndTime : ''
                });
                if (!resetAt && p?.cycleEndTime) resetAt = String(p.cycleEndTime);
              }
            }
          } else {
            total += balance.total;
          }
        } else {
          failed += 1;
          if (!reason && typeof row?.error === 'string' && row.error !== '') reason = row.error;
        }
      }

      return {
        total,
        known,
        failed,
        unit,
        reason,
        accounts: accounts.length,
        quotaMode,
        worstQuota,
        worstAccount,
        windows,
        resetAt
      };
    }

    // ── HUD 组件 ──────────────────────────────────────────────────────────────
    function CreditsHud(props) {
      const ctx = props.ctx || rootCtx;
      const sessionId = props.sessionId;

      const [providerId, setProviderId] = useState(null);
      const [snapshot, setSnapshot] = useState(null);
      const [loading, setLoading] = useState(false);
      const [error, setError] = useState('');
      const [running, setRunning] = useState(false);
      const [delta, setDelta] = useState(null);

      const beforeRef = useRef(null);
      const settleTimerRef = useRef(null);
      const retryTimerRef = useRef(null);
      const creditsCacheRef = useRef(new Map());
      const requestSeq = useRef(0);
      const currentModelIdRef = useRef('');

      const sessions = ctx?.sessions;

      // ⚠️ 不要 useMemo 缓存 connection：composer 在启动瞬间挂载时，
      // connection 服务可能尚未注册，缓存成 undefined 会永久失效。
      const resolveConnection = useCallback(() => {
        let conn;
        try { conn = ctx?.connection; } catch { conn = undefined; }
        if (!conn && typeof ctx?.get === 'function') {
          try { conn = ctx.get('connection'); } catch { conn = undefined; }
        }
        if (!conn && rootCtx && rootCtx !== ctx) {
          try { conn = rootCtx.connection; } catch { conn = undefined; }
          if (!conn && typeof rootCtx?.get === 'function') {
            try { conn = rootCtx.get('connection'); } catch { conn = undefined; }
          }
        }
        return conn;
      }, [ctx]);

      const callPack = useCallback(async (method, payload, timeoutMs = 120_000) => {
        const connection = resolveConnection();
        if (typeof connection?.rpc?.call !== 'function') {
          console.warn('[SmartModels] CreditsHud 无法取得 connection.rpc，ctx keys:',
            (() => { try { return Object.keys(ctx || {}).slice(0, 40); } catch { return 'n/a'; } })());
          throw new Error('no-connection');
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const result = await connection.rpc.call('/api', 'channel-pack', { method, payload }, controller.signal);
          if (result?.ok === true) return result.value;
          if (result?.ok === false) throw new Error(result.error?.message ?? result.error?.code ?? 'rpc-failed');
          return result;
        } finally {
          clearTimeout(timer);
        }
      }, [resolveConnection]);

      const fetchBalance = useCallback(async (provider, force) => {
        if (!provider) return null;

        // 命中缓存（非强制刷新时）：避免每次切换模型都触发一次昂贵的串行查询
        if (force !== true) {
          const cached = creditsCacheRef.current.get(provider);
          if (cached && Date.now() - cached.at < CREDITS_CACHE_TTL_MS) {
            setSnapshot(cached.summary);
            setError('');
            return cached.summary;
          }
          // 有陈旧缓存时先展示，避免界面空白
          if (cached) setSnapshot(cached.summary);
        }

        const seq = ++requestSeq.current;
        setLoading(true);
        setError('');
        try {
          let summary;
          if (isAgyProvider(provider)) {
            // agy 没有 channel-pack 额度接口，改读宿主暴露的 pool.json 视图
            const resp = await fetch('/api/smart-models/agy-quota', { cache: 'no-store' });
            if (!resp.ok) throw new Error(`agy 额度接口 HTTP ${resp.status}`);
            const data = await resp.json();
            if (data?.ok !== true) throw new Error(data?.error || 'agy 额度读取失败');
            summary = summarizeAgyQuota(data);
          } else {
            const value = await callPack('credits.balances', { provider, ...(force === true ? { force: true } : {}) });
            summary = summarizeCreditsBalances(value);
          }
          if (seq !== requestSeq.current) return null;
          creditsCacheRef.current.set(provider, { summary, at: Date.now() });
          setSnapshot(summary);
          return summary;
        } catch (err) {
          if (seq === requestSeq.current) {
            const message = String(err?.message ?? err);
            // 上游明确说「不支持该渠道」：这不是错误，只是该渠道没有积分概念
            const unsupported = /unsupported provider|not support/i.test(message);
            // 超时 / 中止：保留已有数值，仅标记过期，不把界面打成错误态
            const aborted = /abort|timeout|timed out/i.test(message);
            if (unsupported) {
              // 标记为「非积分渠道」，渲染层据此静默隐藏
              setError('');
              setSnapshot({ total: 0, known: 0, failed: 0, unit: '', reason: message, accounts: 0, quotaMode: false, unsupported: true, windows: [] });
            } else if (aborted && creditsCacheRef.current.has(provider)) {
              setError('');
            } else {
              setError(aborted ? '查询超时' : message);
              if (!creditsCacheRef.current.has(provider)) setSnapshot(null);
            }
          }
          return null;
        } finally {
          if (seq === requestSeq.current) setLoading(false);
        }
      }, [callPack]);

      // 1. 跟随会话模型选择
      useEffect(() => {
        if (!sessions || !sessionId) return undefined;
        let binding = null;
        try { binding = sessions.binding?.(sessionId); } catch { return undefined; }
        if (!binding?.session?.projections?.faceOf) return undefined;

        let projection = null;
        try { projection = binding.session.projections.faceOf('modelSelection'); } catch { return undefined; }
        if (!projection) return undefined;

        const read = () => {
          try {
            const snap = projection.getSnapshot?.();
            const sel = snap?.next ?? snap?.lastUsed ?? snap?.current ?? null;
            const next = sel?.provider ? String(sel.provider) : null;
            // 同步记录模型 id，供用量台账归属
            if (sel?.model) currentModelIdRef.current = String(sel.model);
            setProviderId(prev => (prev === next ? prev : next));
          } catch { /* 静默 */ }
        };

        read();
        const unsub = projection.subscribe?.(read);
        return () => { if (typeof unsub === 'function') unsub(); };
      }, [sessions, sessionId]);

      // 2. 渠道变化时刷新（连接服务可能尚未就绪，失败后延迟重试一次）
      // 不再用白名单拦截：任何渠道都去查一次，查到余额就显示、查不到才隐藏。
      useEffect(() => {
        setDelta(null);
        if (settleTimerRef.current) { clearTimeout(settleTimerRef.current); settleTimerRef.current = null; }
        if (!providerId) {
          setSnapshot(null);
          setError('');
          return undefined;
        }
        let cancelled = false;
        void fetchBalance(providerId, false).then(sum => {
          if (cancelled || sum) return;
          // 首次失败：800ms 后再试一次（覆盖 connection 晚注册的情况）
          const timer = setTimeout(() => {
            if (!cancelled) void fetchBalance(providerId, false);
          }, 800);
          retryTimerRef.current = timer;
        });
        return () => {
          cancelled = true;
          if (retryTimerRef.current) {
            clearTimeout(retryTimerRef.current);
            retryTimerRef.current = null;
          }
        };
      }, [providerId, fetchBalance]);

      // 3. 运行状态监听：开始快照 / 结束结算
      useEffect(() => {
        if (!sessions || !sessionId || !providerId) return undefined;
        let binding = null;
        try { binding = sessions.binding?.(sessionId); } catch { return undefined; }
        if (!binding?.session?.subscribe) return undefined;

        const readRunning = () => {
          try { return binding.session.getSnapshot?.()?.running === true; } catch { return false; }
        };

        let wasRunning = readRunning();
        setRunning(wasRunning);
        if (wasRunning && beforeRef.current === null) beforeRef.current = snapshot?.total ?? null;

        const onState = () => {
          const nowRunning = readRunning();
          setRunning(prev => (prev === nowRunning ? prev : nowRunning));

          if (nowRunning && !wasRunning) {
            beforeRef.current = snapshot?.total ?? null;
            if (beforeRef.current === null) {
              void fetchBalance(providerId, false).then(sum => {
                if (sum && beforeRef.current === null) beforeRef.current = sum.total;
              });
            }
            setDelta(null);
            if (settleTimerRef.current) { clearTimeout(settleTimerRef.current); settleTimerRef.current = null; }
          } else if (!nowRunning && wasRunning) {
            const before = beforeRef.current;
            beforeRef.current = null;
            void fetchBalance(providerId, true).then(after => {
              if (!after || before === null || !Number.isFinite(before)) return;
              const consumed = before - after.total;
              if (!Number.isFinite(consumed)) return;
              setDelta({ consumed, afterTotal: after.total, at: Date.now() });
              if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
              settleTimerRef.current = setTimeout(() => {
                setDelta(null);
                settleTimerRef.current = null;
              }, 8000);

              // 上报用量台账（供设置页统计）。只记「测得积分」的轮次，
              // 免费/无积分渠道也记一条 credits=0，保证请求数统计完整。
              void recordUsage({
                provider: providerId,
                model: currentModelIdRef.current || '',
                credits: consumed > 0 ? consumed : 0,
                creditsKnown: true,
                requests: 1
              });
            });
          }
          wasRunning = nowRunning;
        };

        const unsub = binding.session.subscribe?.(onState);
        return () => {
          if (typeof unsub === 'function') unsub();
          if (settleTimerRef.current) { clearTimeout(settleTimerRef.current); settleTimerRef.current = null; }
        };
      }, [sessions, sessionId, providerId, snapshot?.total, fetchBalance]);

      useEffect(() => () => {
        if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      }, []);

      const icon = providerId ? cchudProviderIcon(providerId) : null;
      if (!icon) return null;

      // 复用触发器的渠道简称（WB国际 / CodeArts / Lobster …），保持全站一致
      const shortName = formatTriggerProviderName(providerId, providerId);
      const fullName = formatProviderName(providerId, providerId);

      const hasData = snapshot !== null && snapshot.known > 0;
      // 该渠道本身没有积分概念（上游明确不支持）→ 静默隐藏，不打扰
      if (snapshot?.unsupported) return null;
      // 无数据、非加载中、无结算提示、且无错误 → 静默隐藏
      if (!hasData && !loading && !delta && !error) return null;

      const handleRefresh = () => {
        if (loading) return;
        void fetchBalance(providerId, true);
      };

      const className = [
        'dsh-cchud-pill',
        running ? 'is-running' : '',
        delta ? 'is-settled' : '',
        loading && !delta ? 'is-loading' : ''
      ].filter(Boolean).join(' ');

      const titleParts = [`渠道：${fullName}`];
      if (snapshot) {
        if (snapshot.known > 0) {
          titleParts.push(`可用账号：${snapshot.known}/${snapshot.accounts}`);
          if (snapshot.quotaMode) {
            titleParts.push(`最低剩余窗口：${formatPercent(snapshot.worstQuota)}${snapshot.worstAccount ? `（${snapshot.worstAccount}）` : ''}`);
            for (const w of snapshot.windows) {
              const reset = w.resetTime ? ` · 重置于 ${formatResetTime(w.resetTime)}` : '';
              titleParts.push(`  ${w.name}：${formatPercent(w.remaining)} 剩余${reset}`);
            }
          } else {
            titleParts.push(`总余额：${formatCreditsAmount(snapshot.total)} ${formatCreditUnitLabel(snapshot.unit)}`);
          }
        } else {
          titleParts.push(`共 ${snapshot.accounts} 个账号，均未返回余额`);
        }
        if (snapshot.failed > 0) {
          titleParts.push(`${snapshot.failed} 个账号查询失败${snapshot.reason ? `：${snapshot.reason}` : ''}`);
        }
      }
      if (error) titleParts.push(`查询异常：${error}`);
      if (running) titleParts.push('任务进行中…');
      if (delta && !snapshot?.quotaMode) {
        titleParts.push(
          delta.consumed > 0
            ? `上一轮消耗：${formatCreditsAmount(delta.consumed)}（剩余 ${formatCreditsAmount(delta.afterTotal)}）`
            : '上一轮未检测到积分消耗（可能由免费额度或其它渠道承接）'
        );
      }
      titleParts.push('点击强制刷新余额');

      const children = [];
      if (delta) {
        children.push(h('span', { key: 'icon', className: 'dsh-cchud-icon' }, '⚡'));
        children.push(h('span', {
          key: 'delta',
          className: 'dsh-cchud-delta'
        }, delta.consumed > 0 ? `-${formatCreditsAmount(delta.consumed)}` : '0'));
        children.push(h('span', {
          key: 'after',
          className: 'dsh-cchud-unit'
        }, `余 ${formatCreditsAmount(delta.afterTotal)}`));
      } else {
        children.push(h('span', { key: 'icon', className: 'dsh-cchud-icon' }, icon));
        children.push(h('span', { key: 'label', className: 'dsh-cchud-label' }, shortName));
        if (loading && !snapshot) {
          children.push(h('span', { key: 'amount', className: 'dsh-cchud-amount' }, '…'));
        } else if (snapshot && snapshot.known > 0 && snapshot.quotaMode) {
          // 配额型（Gemini / 周窗口）：显示最低剩余窗口百分比，颜色按健康度分级
          const pct = snapshot.worstQuota;
          const tone = !Number.isFinite(pct) ? '' : pct <= 10 ? 'is-low' : pct <= 30 ? 'is-mid' : '';
          children.push(h('span', {
            key: 'amount',
            className: `dsh-cchud-amount ${tone}`
          }, formatPercent(pct)));
        } else if (snapshot && snapshot.known > 0) {
          children.push(h('span', {
            key: 'amount',
            className: 'dsh-cchud-amount'
          }, formatCreditsAmount(snapshot.total)));
          children.push(h('span', {
            key: 'unit',
            className: 'dsh-cchud-unit'
          }, formatCreditUnitLabel(snapshot.unit)));
        } else {
          // 明确区分三种情况：无账号 / 渠道无余额概念 / 查询失败
          const noAccounts = snapshot !== null && snapshot.accounts === 0;
          children.push(h('span', {
            key: 'amount',
            className: 'dsh-cchud-error'
          }, noAccounts ? '无账号' : '—'));
        }
      }

      return h('button', {
        type: 'button',
        className,
        title: titleParts.join('\n'),
        onClick: handleRefresh,
        disabled: loading && !delta
      }, children);
    }

    // HUD 独立错误边界：异常时静默隐藏，绝不影响模型选择器
    class CreditsHudErrorBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { hasError: false };
      }
      static getDerivedStateFromError() {
        return { hasError: true };
      }
      componentDidCatch(err) {
        console.warn('[SmartModels] CreditsHud 已捕获异常并降级隐藏:', err);
      }
      render() {
        if (this.state.hasError) return null;
        return this.props.children;
      }
    }

    function SafeCreditsHud(props) {
      return h(CreditsHudErrorBoundary, null, h(CreditsHud, props));
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 设置页「用量统计」
    //   · 数据来自宿主台账 /api/smart-models/usage（HUD 结算时上报）
    //   · 按模型 / 渠道 / 日期三个维度汇总
    //   · 「换算≈token」按实测均值反推，样本不足时显示 —
    // ══════════════════════════════════════════════════════════════════════════

    const USAGE_RANGES = [
      { id: 'today', label: '今天', days: 1 },
      { id: '7d', label: '近 7 天', days: 7 },
      { id: '30d', label: '近 30 天', days: 30 },
      { id: 'all', label: '全部', days: 0 }
    ];

    // 把事件按某个 key 聚合
    function aggregateUsage(events, keyOf) {
      const map = new Map();
      for (const e of events) {
        if (!e) continue;
        const key = keyOf(e);
        if (key === null || key === undefined || key === '') continue;
        let row = map.get(key);
        if (!row) {
          row = { key, requests: 0, credits: 0, creditsKnown: 0, tokens: 0 };
          map.set(key, row);
        }
        row.requests += Number.isFinite(e.requests) ? e.requests : 1;
        if (e.creditsKnown === true && Number.isFinite(e.credits)) {
          row.credits += e.credits;
          row.creditsKnown += 1;
        }
        row.tokens += (Number.isFinite(e.inputTokens) ? e.inputTokens : 0)
          + (Number.isFinite(e.outputTokens) ? e.outputTokens : 0);
      }
      return Array.from(map.values()).sort((a, b) => b.requests - a.requests);
    }

    // 换算：用范围内实测均值反推，而非固定常量
    // 返回 null 表示无法换算（累计积分为 0 或数据不足）
    function estimateTokens(credits, totalCredits, totalTokens) {
      if (!Number.isFinite(credits) || credits <= 0) return null;
      if (!Number.isFinite(totalCredits) || totalCredits <= 0) return null;
      if (!Number.isFinite(totalTokens) || totalTokens <= 0) return null;
      return credits * (totalTokens / totalCredits);
    }

    // 大数字紧凑显示：1234567 -> 1.23M
    function compactNumber(value) {
      if (!Number.isFinite(value)) return '—';
      const abs = Math.abs(value);
      if (abs >= 1e9) return (value / 1e9).toFixed(2) + 'B';
      if (abs >= 1e6) return (value / 1e6).toFixed(2) + 'M';
      if (abs >= 1e3) return (value / 1e3).toFixed(1) + 'K';
      return String(Math.round(value));
    }

    function formatDayKey(ts) {
      const d = new Date(ts);
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${mm}-${dd}`;
    }

    function formatSinceDate(ts) {
      if (!Number.isFinite(ts)) return '—';
      const d = new Date(ts);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    // 上报一轮消耗到宿主台账。失败静默（统计不该影响主流程）
    async function recordUsage(row) {
      try {
        await fetch('/api/smart-models/usage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...row, at: Date.now() })
        });
      } catch (e) {
        console.warn('[SmartModels] 用量台账上报失败（不影响使用）:', e);
      }
    }

    // ── 设置页组件 ────────────────────────────────────────────────────────────
    function UsageStatsPage(props) {
      const [events, setEvents] = useState(null);
      const [since, setSince] = useState(0);
      const [range, setRange] = useState('7d');
      const [error, setError] = useState('');
      const [openTable, setOpenTable] = useState('model');

      useEffect(() => {
        let cancelled = false;
        (async () => {
          try {
            const resp = await fetch('/api/smart-models/usage', { cache: 'no-store' });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            if (cancelled) return;
            if (data?.ok !== true) throw new Error(data?.error || '读取失败');
            setEvents(Array.isArray(data.events) ? data.events : []);
            setSince(Number.isFinite(data.since) ? data.since : 0);
            setError('');
          } catch (err) {
            if (!cancelled) {
              setEvents([]);
              setError(String(err?.message ?? err));
            }
          }
        })();
        return () => { cancelled = true; };
      }, []);

      const filtered = useMemo(() => {
        if (!Array.isArray(events)) return [];
        const cfg = USAGE_RANGES.find(r => r.id === range);
        if (!cfg || cfg.days === 0) return events;
        if (range === 'today') {
          const d = new Date();
          d.setHours(0, 0, 0, 0);
          return events.filter(e => e && e.at >= d.getTime());
        }
        const cutoff = Date.now() - cfg.days * 24 * 60 * 60 * 1000;
        return events.filter(e => e && e.at >= cutoff);
      }, [events, range]);

      const totals = useMemo(() => {
        let requests = 0, credits = 0, tokens = 0;
        for (const e of filtered) {
          requests += Number.isFinite(e.requests) ? e.requests : 1;
          if (e.creditsKnown === true && Number.isFinite(e.credits)) credits += e.credits;
          tokens += (Number.isFinite(e.inputTokens) ? e.inputTokens : 0)
            + (Number.isFinite(e.outputTokens) ? e.outputTokens : 0);
        }
        return { requests, credits, tokens };
      }, [filtered]);

      const byModel = useMemo(() => aggregateUsage(filtered, e => e.model || ''), [filtered]);
      const byProvider = useMemo(() => aggregateUsage(filtered, e => e.provider || ''), [filtered]);
      const byDay = useMemo(() => {
        const rows = aggregateUsage(filtered, e => (e.at ? formatDayKey(e.at) : ''));
        return rows.sort((a, b) => (a.key < b.key ? 1 : -1));
      }, [filtered]);

      const tables = [
        { id: 'model', title: '按模型', rows: byModel, labelOf: r => r.key || '（未知模型）' },
        { id: 'provider', title: '按渠道', rows: byProvider, labelOf: r => formatProviderName(r.key, r.key) || r.key || '（未知渠道）' },
        { id: 'day', title: '按日期', rows: byDay, labelOf: r => r.key || '（未知日期）' }
      ];

      const cell = { padding: '6px 8px', fontSize: '12px', borderBottom: '1px solid rgba(255,255,255,0.06)' };
      const headCell = { ...cell, opacity: 0.6, fontWeight: 600, textAlign: 'left' };
      const numCell = { ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

      const renderTable = (tbl) => {
        const isOpen = openTable === tbl.id;
        const rows = tbl.rows;
        return h('div', { key: tbl.id, style: { marginBottom: '8px' } }, [
          h('button', {
            key: 'h',
            type: 'button',
            onClick: () => setOpenTable(isOpen ? null : tbl.id),
            style: {
              width: '100%', display: 'flex', alignItems: 'center', gap: '6px',
              padding: '8px 10px', background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px',
              color: 'inherit', cursor: 'pointer', fontSize: '12.5px', fontWeight: 600
            }
          }, [
            h('span', { key: 'a', style: { opacity: 0.6, fontSize: '10px' } }, isOpen ? '▼' : '▶'),
            h('span', { key: 't' }, tbl.title),
            h('span', { key: 'c', style: { opacity: 0.5, fontWeight: 400, marginLeft: 'auto' } }, `${rows.length} 项`)
          ]),
          isOpen && rows.length > 0 && h('table', {
            key: 't',
            style: { width: '100%', borderCollapse: 'collapse', marginTop: '4px' }
          }, [
            h('thead', { key: 'thead' }, h('tr', null, [
              h('th', { key: 'n', style: headCell }, tbl.id === 'day' ? '日期' : tbl.id === 'model' ? '模型' : '渠道'),
              h('th', { key: 'r', style: { ...headCell, textAlign: 'right' } }, '请求'),
              h('th', { key: 'k', style: { ...headCell, textAlign: 'right' } }, 'Token'),
              h('th', { key: 'c', style: { ...headCell, textAlign: 'right' } }, '积分'),
              h('th', { key: 'e', style: { ...headCell, textAlign: 'right' } }, '换算≈token')
            ])),
            h('tbody', { key: 'tbody' }, rows.map((r, i) => {
              const est = estimateTokens(r.credits, totals.credits, totals.tokens);
              return h('tr', { key: i }, [
                h('td', { key: 'n', style: cell }, tbl.labelOf(r)),
                h('td', { key: 'r', style: numCell }, String(r.requests)),
                h('td', { key: 'k', style: numCell }, compactNumber(r.tokens)),
                h('td', { key: 'c', style: numCell }, r.creditsKnown > 0 ? compactNumber(r.credits) : '—'),
                h('td', { key: 'e', style: numCell }, est === null ? '—' : compactNumber(est) + '*')
              ]);
            }))
          ]),
          isOpen && rows.length === 0 && h('p', {
            key: 'empty',
            style: { margin: '6px 10px', fontSize: '12px', opacity: 0.5 }
          }, '该时间范围内暂无数据')
        ]);
      };

      const perCredit = totals.credits > 0 ? totals.tokens / totals.credits : null;

      return h('div', { style: { padding: '4px 2px' } }, [
        h('h2', { key: 'title', style: { margin: '0 0 4px', fontSize: '15px' } }, '用量统计'),
        h('p', { key: 'sub', style: { margin: '0 0 12px', fontSize: '12px', opacity: 0.55 } },
          `统计起始：${formatSinceDate(since)}（积分消耗自本功能安装后开始记录）`),

        h('div', { key: 'range', style: { display: 'flex', gap: '6px', marginBottom: '12px' } },
          USAGE_RANGES.map(r => h('button', {
            key: r.id,
            type: 'button',
            onClick: () => setRange(r.id),
            style: {
              padding: '4px 10px', borderRadius: '999px', fontSize: '12px', cursor: 'pointer',
              border: '1px solid ' + (range === r.id ? 'rgba(56,189,248,0.6)' : 'rgba(255,255,255,0.1)'),
              background: range === r.id ? 'rgba(56,189,248,0.15)' : 'transparent',
              color: range === r.id ? '#7dd3fc' : 'inherit'
            }
          }, r.label))
        ),

        h('div', { key: 'summary', style: {
          display: 'flex', gap: '18px', flexWrap: 'wrap',
          padding: '10px 12px', marginBottom: '12px',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px'
        } }, [
          h('div', { key: 'q' }, [h('div', { style: { fontSize: '11px', opacity: 0.55 } }, '请求'), h('div', { style: { fontSize: '16px', fontWeight: 700 } }, String(totals.requests))]),
          h('div', { key: 't' }, [h('div', { style: { fontSize: '11px', opacity: 0.55 } }, 'Token'), h('div', { style: { fontSize: '16px', fontWeight: 700 } }, compactNumber(totals.tokens))]),
          h('div', { key: 'c' }, [h('div', { style: { fontSize: '11px', opacity: 0.55 } }, '积分'), h('div', { style: { fontSize: '16px', fontWeight: 700 } }, totals.credits > 0 ? compactNumber(totals.credits) : '—')]),
          h('div', { key: 'e' }, [h('div', { style: { fontSize: '11px', opacity: 0.55 } }, '换算≈token'), h('div', { style: { fontSize: '16px', fontWeight: 700 } }, perCredit === null ? '—' : compactNumber(totals.credits * perCredit))])
        ]),

        error !== '' && h('p', { key: 'err', style: { fontSize: '12px', color: '#f87171' } }, `读取失败：${error}`),

        events === null && h('p', { key: 'loading', style: { fontSize: '12px', opacity: 0.5 } }, '加载中…'),
        events !== null && events.length === 0 && h('p', { key: 'nodata', style: { fontSize: '12.5px', opacity: 0.6 } },
          `自 ${formatSinceDate(since)} 起统计，暂无数据。发起一次对话后这里会出现记录。`),

        events !== null && events.length > 0 && h('div', { key: 'tables' }, tables.map(renderTable)),

        h('p', { key: 'note', style: { marginTop: '10px', fontSize: '11px', opacity: 0.45, lineHeight: 1.6 } }, [
          '* 换算≈token 按当前范围内实测均值反推（',
          perCredit === null ? '样本不足' : `1 积分 ≈ ${perCredit.toFixed(1)} token`,
          '），并非官方汇率。不同渠道计费规则不同，仅供粗略参考。'
        ])
      ]);
    }

    // 统计页独立错误边界：异常不影响设置页其他分区
    class UsageStatsErrorBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { hasError: false };
      }
      static getDerivedStateFromError() {
        return { hasError: true };
      }
      componentDidCatch(err) {
        console.warn('[SmartModels] UsageStatsPage 已捕获异常:', err);
      }
      render() {
        if (this.state.hasError) {
          return h('p', { style: { fontSize: '12px', opacity: 0.6 } }, '用量统计加载失败');
        }
        return this.props.children;
      }
    }

    function SafeUsageStatsPage(props) {
      return h(UsageStatsErrorBoundary, null, h(UsageStatsPage, props));
    }

    // ── 插件装配入口 ────────────────────────────────────────────────────────────
    const inject = ['slots', 'sessions', 'remote', 'remote.session'];

    function apply(ctx) {
      rootCtx = ctx;
      injectStyles();

      ctx.slots.inject('conversation.input.model', () => {
        return ctx.slots.register({
          name: 'conversation.input.model',
          children: {
            'conversation.input.model.label': {
              kind: 'single',
              scope: 'session',
              inline: true
            }
          },
          inject: (sessionId) => ({
            sessionId,
            ctx
          })
        }, SafeSmartModelSelect);
      });

      // 渠道积分透视 HUD：挂在输入框左侧列表插槽
      ctx.slots.inject('conversation.input.left', () => {
        return ctx.slots.register({
          name: 'conversation.input.left',
          id: 'smart-models-credits-hud',
          order: 40,
          inject: (sessionId) => ({
            sessionId,
            ctx
          })
        }, SafeCreditsHud);
      });

      // 设置页「用量统计」分区：排在「免费模型」(order 35) 之后
      ctx.slots.inject('settings.section', () => {
        return ctx.slots.register({
          name: 'settings.section',
          id: 'smart-models-usage',
          order: 36,
          label: () => '用量统计'
        }, SafeUsageStatsPage);
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
