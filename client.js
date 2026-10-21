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
      /* 根源治本：禁止 DSH 输入底栏换行断层，强制单行水平排列 */
      div[class*="_row"] {
        flex-wrap: nowrap !important;
      }
      div[class*="_trailing"] {
        min-width: 0 !important;
        flex-shrink: 1 !important;
      }

      .dsh-sm-root {
        position: relative;
        display: inline-flex;
        align-items: center;
        min-width: 0;
        flex-shrink: 1;
      }

      /* 触发器按钮：弹性自适应防撑爆 */
      .dsh-sm-trigger {
        min-width: 0;
        max-width: min(340px, 45cqw);
        height: 28px;
        border-radius: var(--dsw-radius-sm, 6px);
        color: var(--dsw-alias-label-secondary, #94a3b8);
        background: transparent;
        border: 1px solid transparent;
        outline: none;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 0 6px;
        font-size: 13px;
        font-weight: 500;
        line-height: 20px;
        user-select: none;
        white-space: nowrap;
        flex-shrink: 1;
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
        flex: 0 1 auto;
        min-width: 40px;
        max-width: 125px;
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
      /* 紧凑精致型待生效徽章：仅占极小宽度，防止撑破底栏 */
      .dsh-sm-trigger-pending {
        margin-left: 2px;
        padding: 0 3px;
        border-radius: 3px;
        font-size: 9.5px;
        line-height: 13px;
        font-weight: 600;
        color: #fbbf24;
        background: rgba(245, 158, 11, 0.18);
        border: 1px solid rgba(245, 158, 11, 0.4);
        white-space: nowrap;
        flex-shrink: 0;
        cursor: help;
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
        /* maxHeight 由 JS 动态下发（锚定悬停行后的剩余视口高度）；
           内容超出时内部滚动，卡片本身不再上移，首行才能与激活行严格对齐。 */
        overflow-y: auto;
        overscroll-behavior: contain;
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
      /* 隐形安全桥接通道：解决鼠标从主卡片移到伴随卡时中间缝隙失焦问题。
         ⚠️ 必须竖向覆盖足够大：伴随卡的 Y 位置是「动态钳制」的
            （calculateFlyoutPos 会把它夹在视口内），被钳制后卡片可能与
            悬停行相差几百像素，鼠标走的是对角线。旧的 top/bottom:-10px
            只覆盖 20px 高的水平走廊，完全挡不住斜向移动 —— 这正是
            「还没划到二级卡片就消失」的根因。
         横向只占 8px（压住 6px 间隙），不侵入主卡片的可点区域。 */
      .dsh-sm-companion-flyout::before {
        content: '';
        position: absolute;
        left: -6px;
        width: 8px;
        top: -600px;
        bottom: -600px;
        background: transparent;
        pointer-events: auto;
      }
      .dsh-sm-companion-flyout.flip-left::before {
        left: auto;
        right: -6px;
      }
      /* ⚠️ 头部高度必须与 JS 的 FLYOUT_OPTION_OFFSET_PX 严格对应：
         padding 8+8 + 内容行高 + 下边框 1 = 32px。
         这里显式锁死 box-sizing 与最小高度，避免不同字体渲染导致头部忽高忽低，
         进而让「选项对齐母行」偏几个像素。 */
      .dsh-sm-companion-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        padding: 8px 10px;
        box-sizing: border-box;
        min-height: 32px;
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
        /* 不再写死 max-height：卡片高度由 JS 依「锚定悬停行后的剩余视口」动态下发，
           内层列表必须 flex 撑满剩余空间并自行滚动，否则外层加高会被这 320px 截断。 */
        flex: 1 1 auto;
        min-height: 0;
        overflow-y: auto;
        overscroll-behavior: contain;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      /* 渠道卡片：横向平铺，大点按区 */
      /* ⚠️ 卡片高度必须与 JS 的 FLYOUT_OPTION_ROW_PX(29px) 严格对应，
         否则「第一张选项卡对齐母行」会累积误差。锁死高度而不是靠 padding 撑。 */
      .dsh-sm-detail-card {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 6px 9px;
        box-sizing: border-box;
        min-height: 29px;
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

      /* ── 上行自检：状态点与标签 ─────────────────────────────────────── */
      .dsh-sm-health-dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        display: inline-block;
        flex-shrink: 0;
        margin-left: 2px;
      }
      .dsh-sm-health-ok { background: rgba(74, 222, 128, 0.9); }
      .dsh-sm-health-degraded { background: rgba(251, 191, 36, 0.95); }
      .dsh-sm-health-blocked { background: rgba(248, 113, 113, 0.95); }
      .dsh-sm-health-unknown { background: rgba(148, 163, 184, 0.7); }

      .dsh-sm-health-chip {
        font-size: 9px;
        font-weight: 600;
        padding: 1px 4px;
        border-radius: 3px;
        line-height: normal;
        letter-spacing: 0.02em;
        white-space: nowrap;
      }
      .dsh-sm-health-chip.dsh-sm-health-ok { background: rgba(34,197,94,0.2); color: #4ade80; }
      .dsh-sm-health-chip.dsh-sm-health-degraded { background: rgba(245,158,11,0.22); color: #fbbf24; }
      .dsh-sm-health-chip.dsh-sm-health-blocked { background: rgba(248,113,113,0.22); color: #f87171; }
      .dsh-sm-health-chip.dsh-sm-health-unknown { background: rgba(148,163,184,0.2); color: #94a3b8; }

      /* 会员/订阅墙：与「受限（琥珀）」「不可用（红）」区分开的第四种语义 ——
         它不会随时间恢复，充值也无效，只有升级套餐或换渠道。 */
      .dsh-sm-health-dot.is-plan {
        background: rgba(168, 85, 247, 0.95);
        box-shadow: 0 0 0 2px rgba(168, 85, 247, 0.18);
      }
      .dsh-sm-health-chip.dsh-sm-plan-chip {
        background: rgba(168,85,247,0.22);
        color: #d8b4fe;
      }

      /* ── 上行自检设置页 ─────────────────────────────────────────────── */
      .dsh-sm-uh-card {
        flex: 1 1 160px;
        min-width: 150px;
        padding: 10px 12px;
        border-radius: 8px;
        border: 1px solid rgba(255,255,255,0.08);
        background: rgba(255,255,255,0.04);
      }
      .dsh-sm-uh-card-title { font-size: 11px; opacity: 0.55; margin-bottom: 4px; }
      .dsh-sm-uh-card-value { font-size: 15px; font-weight: 700; }
      .dsh-sm-uh-card-note { font-size: 11px; opacity: 0.6; margin-top: 4px; line-height: 1.5; }
      .dsh-sm-uh-table { width: 100%; border-collapse: collapse; font-size: 12px; }
      .dsh-sm-uh-table th {
        text-align: left; font-weight: 600; font-size: 11px; opacity: 0.55;
        padding: 4px 8px; border-bottom: 1px solid rgba(255,255,255,0.1); white-space: nowrap;
      }
      .dsh-sm-uh-table td {
        padding: 4px 8px; border-bottom: 1px solid rgba(255,255,255,0.05); vertical-align: top;
      }
      .dsh-sm-uh-table tr:hover td { background: rgba(255,255,255,0.03); }
      .dsh-sm-uh-muted { opacity: 0.5; }
      .dsh-sm-uh-warn { color: #fbbf24; }
      .dsh-sm-uh-bad { color: #f87171; }
      .dsh-sm-uh-btn {
        font-size: 11px; padding: 3px 8px; border-radius: 4px; cursor: pointer;
        border: 1px solid rgba(255,255,255,0.14); background: transparent; color: inherit;
      }
      .dsh-sm-uh-btn:hover { background: rgba(255,255,255,0.08); }
      .dsh-sm-uh-btn:disabled { opacity: 0.4; cursor: not-allowed; }
      .dsh-sm-uh-btn.danger { border-color: rgba(248,113,113,0.4); color: #f87171; }

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

      /* 用量统计：每日积分柱状图（纯 SVG 自绘，零依赖） */
      .dsh-sm-usage-chart {
        display: block;
        width: 100%;
        margin: 0 0 12px;
      }
      .dsh-sm-usage-bar {
        fill: #38bdf8;
        opacity: 0.85;
        transition: opacity 0.12s ease;
      }
      .dsh-sm-usage-bar:hover {
        opacity: 1;
      }
      .dsh-sm-usage-bar.is-today {
        fill: #7dd3fc;
      }
      .dsh-sm-usage-axis {
        stroke: rgba(255, 255, 255, 0.12);
        stroke-width: 1;
      }
      .dsh-sm-usage-axis-label {
        fill: var(--dsw-alias-label-tertiary, #94a3b8);
        font-size: 9px;
      }
      .dsh-sm-usage-chart-empty {
        padding: 18px 12px;
        text-align: center;
        font-size: 12px;
        opacity: 0.5;
        border: 1px dashed rgba(255, 255, 255, 0.12);
        border-radius: 8px;
        margin-bottom: 12px;
      }
      /* 明细日志表 */
      .dsh-sm-usage-detail {
        width: 100%;
        border-collapse: collapse;
        margin-top: 4px;
        font-size: 11.5px;
      }
      .dsh-sm-usage-detail td, .dsh-sm-usage-detail th {
        padding: 4px 8px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 220px;
      }
      .dsh-sm-usage-detail .num {
        text-align: right;
        font-variant-numeric: tabular-nums;
      }
      .dsh-sm-usage-detail .suspect {
        font-size: 10px;
        opacity: 0.55;
      }
      .dsh-sm-usage-detail tr.is-suspect td {
        opacity: 0.6;
      }

      /* 设置页合并分区：内部标签页切换（原三个独立分区收拢为一行） */
      .dsh-sm-settings-tabs {
        display: flex;
        gap: 4px;
        flex-wrap: wrap;
        padding: 2px;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.1));
        margin-bottom: 12px;
      }
      .dsh-sm-settings-tab {
        flex: 0 0 auto;
        padding: 5px 14px;
        border-radius: 6px;
        font-size: 12.5px;
        line-height: 18px;
        border: none;
        background: transparent;
        color: inherit;
        opacity: 0.62;
        cursor: pointer;
        white-space: nowrap;
        transition: background 0.15s ease, opacity 0.15s ease, color 0.15s ease;
      }
      .dsh-sm-settings-tab:hover {
        opacity: 0.9;
        background: rgba(255, 255, 255, 0.08);
      }
      .dsh-sm-settings-tab.active {
        background: var(--dsw-alias-state-business-primary, #0284c7);
        color: #ffffff;
        opacity: 1;
        font-weight: 600;
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
      /* 档位按钮始终单行：不换行，但按内容宽度排列，不拉伸占满整行 */
      .dsh-sm-effort-pills {
        display: flex;
        gap: 4px;
        flex-wrap: nowrap;
        min-width: 0;
      }
      .dsh-sm-effort-pill {
        flex: 0 0 auto;
        min-width: 0;
        padding: 2px 8px;
        border-radius: 4px;
        font-size: 11px;
        line-height: 16px;
        text-align: center;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
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

      /* 常驻底栏的弹性占位：无思考档位时把开关推到最右端 */
      .dsh-sm-footer-spacer {
        flex: 1 1 auto;
        min-width: 0;
      }

      /* 视图切换开关：单按钮两态，最大程度压缩面积。
         默认态（模型）= 与思考档位胶囊一致的中性描边；
         激活态（渠道）= 蓝底白字，与 .dsh-sm-effort-pill.active 同款强调色。 */
      .dsh-sm-view-toggle {
        margin-left: auto;
        flex-shrink: 0;
        font-size: 11px;
        line-height: 16px;
        padding: 2px 8px;
        border-radius: 4px;
        border: 1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.1));
        background: transparent;
        color: inherit;
        opacity: 0.72;
        cursor: pointer;
        white-space: nowrap;
        transition: background 0.15s ease, opacity 0.15s ease, color 0.15s ease, border-color 0.15s ease;
      }
      .dsh-sm-view-toggle:hover {
        opacity: 1;
        background: rgba(255, 255, 255, 0.1);
      }
      .dsh-sm-view-toggle.is-active {
        background: var(--dsw-alias-state-business-primary, #0284c7);
        border-color: transparent;
        color: #ffffff;
        opacity: 1;
        font-weight: 600;
      }
      /* 渠道态再加一层暖色强调，避免与「High」等档位胶囊在蓝底上混淆 */
      .dsh-sm-view-toggle.is-channel {
        background: #7c3aed;
        box-shadow: 0 0 0 1px rgba(124, 58, 237, 0.35);
      }
      .dsh-sm-view-toggle.is-channel:hover {
        background: #8b5cf6;
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

      /* 「本机快照」标记：提示恢复时刻可能是本地推算，非上游权威结论 */
      .dsh-sm-uh-snapshot {
        display: inline-block;
        margin-left: 6px;
        padding: 0 5px;
        font-size: 10px;
        line-height: 15px;
        border-radius: 4px;
        border: 1px solid rgba(251, 191, 36, 0.35);
        color: #fbbf24;
        opacity: 0.9;
        white-space: nowrap;
        cursor: help;
      }

      /* ── 渠道视图（按渠道商分类排列） ─────────────────────────────── */
      /* 渠道行：单行 32px 定高，悬停即预览右侧伴随卡 */
      .dsh-sm-channel-row {
        cursor: pointer;
      }
      .dsh-sm-channel-row.is-open {
        background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.08));
      }
      /* 当前会话所在渠道：左侧青色标记，与模型行的 is-active-session 呼应 */
      .dsh-sm-channel-row.is-active-group {
        border-left: 2px solid var(--dsw-alias-state-business-primary, #0284c7);
        padding-left: 8px;
      }
      .dsh-sm-channel-row.is-active-group .dsh-sm-family-label {
        color: var(--dsw-alias-state-business-primary, #38bdf8);
      }

      /* 组标题右侧的余额标签：积分型与配额型共用，仅配色区分 */
      /* 余额列：定宽 + 右对齐 + 等宽数字，保证所有行的数字列严格对齐。
         渠道名可收缩截断，余额列绝不收缩（否则数字会被挤成两行或抖动）。
         这是本类唯一的权威定义，不要在其他地方再写一条覆盖它。 */
      .dsh-sm-channel-balance {
        margin-left: auto;
        flex: 0 0 auto;
        width: 92px;
        text-align: right;
        font-size: 10.5px;
        font-weight: 600;
        opacity: 0.78;
        font-variant-numeric: tabular-nums;
        font-feature-settings: 'tnum' 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        padding-left: 4px;
        letter-spacing: 0.01em;
      }
      /* 渠道名占据剩余空间并可截断，与定宽余额列配合形成两列对齐 */
      .dsh-sm-channel-row .dsh-sm-family-label {
        flex: 1 1 auto;
        min-width: 0;
      }
      .dsh-sm-channel-balance.is-quota {
        color: #fbbf24;
        opacity: 0.9;
      }

      /* ── 模型家族分组 ────────────────────────────────────────────── */
      .dsh-sm-pinned-section {
        padding-bottom: 4px;
        margin-bottom: 4px;
        border-bottom: 1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.08));
      }
      .dsh-sm-family-head {
        height: 32px;
        min-height: 32px;
        max-height: 32px;
        padding: 0 8px 0 10px;
        display: flex;
        align-items: center;
        gap: 6px;
        cursor: pointer;
        user-select: none;
        box-sizing: border-box;
        border-radius: 4px;
        transition: background 0.1s ease;
      }
      .dsh-sm-family-head:hover {
        background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.06));
      }
      /* 展开中的家族标题吸顶：滚动浏览长家族时始终可见，方便随时点回关闭 */
      .dsh-sm-family-head.is-sticky {
        position: sticky;
        top: 0;
        z-index: 5;
        background: color-mix(in srgb, var(--dsw-alias-bg-layer-2, #18181b) 96%, transparent);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border-radius: 0;
        box-shadow: 0 1px 0 rgba(255, 255, 255, 0.08);
      }
      .dsh-sm-family-head.is-sticky:hover {
        background: color-mix(in srgb, var(--dsw-alias-bg-layer-2, #18181b) 88%, transparent);
      }
      .dsh-sm-family-arrow {
        font-size: 10px;
        opacity: 0.45;
        flex-shrink: 0;
        width: 10px;
        text-align: center;
        transition: opacity 0.12s;
      }
      .dsh-sm-family-head:hover .dsh-sm-family-arrow,
      .dsh-sm-family-head.is-open .dsh-sm-family-arrow {
        opacity: 0.85;
      }
      .dsh-sm-family-label {
        font-size: 12px;
        font-weight: 600;
        opacity: 0.8;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dsh-sm-family-count {
        margin-left: auto;
        font-size: 10px;
        font-weight: 600;
        opacity: 0.45;
        background: rgba(255, 255, 255, 0.06);
        padding: 1px 6px;
        border-radius: 8px;
        flex-shrink: 0;
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
      const STYLE_TAG_ID = 'dsh-smart-models-styles-v21';
      const oldIds = ['dsh-smart-models-styles-v2', 'dsh-smart-models-styles-v3', 'dsh-smart-models-styles-v4', 'dsh-smart-models-styles-v5', 'dsh-smart-models-styles-v6', 'dsh-smart-models-styles-v7', 'dsh-smart-models-styles-v8', 'dsh-smart-models-styles-v9', 'dsh-smart-models-styles-v10', 'dsh-smart-models-styles-v11', 'dsh-smart-models-styles-v12', 'dsh-smart-models-styles-v13', 'dsh-smart-models-styles-v14', 'dsh-smart-models-styles-v15', 'dsh-smart-models-styles-v16', 'dsh-smart-models-styles-v17', 'dsh-smart-models-styles-v18', 'dsh-smart-models-styles-v19', 'dsh-smart-models-styles-v20'];
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
      // 极致紧凑展示（如 0x / 1x / 0.7x），为底栏节省横向空间，杜绝换行断层
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
    // ── 倍率本地覆盖表 ──────────────────────────────────────────────────────
    // 上游倍率由华为云等渠道自己下发（channel-pack 从远端目录的 meta.credits 解析，
    // 存内存 Map、不落盘），本地无法直接改。这里提供一层**显示覆盖**：
    // 命中即用本地值，未命中则沿用上游真实值。
    //
    // key 格式：'<providerId>|<modelId 小写>'
    // value：数字（如 0.5）或字符串（如 'x0.50' / '0.5→0.25'）
    //
    // ⚠️ 这是**显示层覆盖**，不改变上游真实计费。留空 = 全部显示上游值。
    const STORAGE_MULTIPLIER_OVERRIDES_KEY = 'dsh_sm_multiplier_overrides_v1';

    // 内置默认覆盖（可为空）。用户可在 设置 → Smart Models → 倍率覆盖 里增删，
    // 用户配置存 localStorage，优先级高于这份内置表。
    const MULTIPLIER_OVERRIDES_BUILTIN = {
      // 华为云 CodeArts：DeepSeek-V4.1-Flash 已于 2026-10 改为积分制，
      // 上游倍率为 0.09。这里固定它，避免上游偶尔下发 0.10/0.00 造成显示跳动。
      'codearts|deepseek-v4.1-flash': 0.09,
      // 其他模型仍显示上游真实值；需要覆盖请在 设置 → Smart Models → 倍率覆盖 添加。
    };

    // 运行时生效表 = 内置表 + 用户表（用户表覆盖内置）
    let MULTIPLIER_OVERRIDES = { ...MULTIPLIER_OVERRIDES_BUILTIN };

    function loadMultiplierOverrides() {
      try {
        const raw = localStorage.getItem(STORAGE_MULTIPLIER_OVERRIDES_KEY);
        if (!raw) return { ...MULTIPLIER_OVERRIDES_BUILTIN };
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return { ...MULTIPLIER_OVERRIDES_BUILTIN };
        const out = { ...MULTIPLIER_OVERRIDES_BUILTIN };
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof k !== 'string' || !k.includes('|')) continue;
          const num = Number(v);
          if (Number.isFinite(num) && num >= 0) out[k.toLowerCase()] = num;
        }
        return out;
      } catch (e) {
        return { ...MULTIPLIER_OVERRIDES_BUILTIN };
      }
    }

    function saveMultiplierOverrides(map) {
      try {
        // 只持久化用户表（内置表随代码走，不重复存储）
        const userOnly = {};
        for (const [k, v] of Object.entries(map || {})) {
          if (MULTIPLIER_OVERRIDES_BUILTIN[k] === v) continue;
          userOnly[k] = v;
        }
        localStorage.setItem(STORAGE_MULTIPLIER_OVERRIDES_KEY, JSON.stringify(userOnly));
      } catch (e) {}
    }

    function reloadMultiplierOverrides() {
      MULTIPLIER_OVERRIDES = loadMultiplierOverrides();
    }
    reloadMultiplierOverrides();

    function lookupMultiplierOverride(providerId, m) {
      const pid = String(providerId || '').toLowerCase();
      const mid = String(m?.id || '').toLowerCase();
      if (!pid || !mid) return null;
      const direct = MULTIPLIER_OVERRIDES[pid + '|' + mid];
      if (direct !== undefined) return direct;
      // 宽松匹配：允许 key 省略大小写/连字符差异
      const norm = (s) => s.replace(/[^a-z0-9]/g, '');
      const target = norm(mid);
      for (const [k, v] of Object.entries(MULTIPLIER_OVERRIDES)) {
        const [kp, km] = k.split('|');
        if (norm(kp) !== norm(pid)) continue;
        if (norm(km) === target) return v;
      }
      return null;
    }

    // 覆盖层：先取上游真实值，命中覆盖表则替换
    function extractMultiplier(m, providerId) {
      const upstream = extractMultiplierRaw(m, providerId);
      const override = lookupMultiplierOverride(providerId, m);
      if (override === null) return upstream;
      if (typeof override === 'number') return 'x' + override.toFixed(2);
      return formatSingleRate(String(override));
    }

    function extractMultiplierRaw(m, providerId) {
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

      // ── 命名变体归一（gpt-oss-120b / openai.gpt-oss-120b / openai/gpt-oss-120b / gpt-oss:120b）
      // 1) 剥离任意 vendor 前缀（点号或斜杠分隔，如 openai. / moonshotai/ / meta-llama/）
      name = name.replace(/^[a-z0-9][a-z0-9_-]*\s*[./]\s*(?=[a-z])/i, '').trim();
      // 2) 冒号/下划线统一为连字符（gpt-oss:120b → gpt-oss-120b）
      name = name.replace(/[:：]/g, '-').replace(/_/g, '-');

      if (/^deepseek[-_]v?4\.1[-_]flash/i.test(name)) return 'DeepSeek-V4.1-Flash';
      if (/^deepseek[-_]v?4[-_]pro/i.test(name)) return 'DeepSeek-V4-Pro';
      if (/^deepseek[-_]v?3/i.test(name)) return 'DeepSeek-V3';
      if (/^deepseek[-_]r?1/i.test(name)) return 'DeepSeek-R1';

      // 3) 已知同源别名归一（精确匹配，避免误伤其它模型）
      const lower = name.toLowerCase();
      if (/^gpt-oss-?120b(-250805)?$/.test(lower)) return 'GPT-OSS 120B';
      if (/^gpt-oss-?20b$/.test(lower)) return 'GPT-OSS 20B';

      return name;
    }

    // ── 强归一键：判断「是否同一个模型」 ──────────────────────────────────────
    // 同一模型在不同 provider 上的写法差异极大，实测 43 组被拆成多条：
    //   GPT-5.6 Sol / GPT 5.6 Sol / Gpt 5.6 Sol        ← 分隔符 + 大小写
    //   GLM-5.2 / GLM 5.2 / Glm 5.2                     ← 同上
    //   DeepSeek V4 Pro / DeepSeek V4 Pro (ClinePass)   ← 括号来源后缀
    //   Kimi K3 / Kimi K3 Free                          ← free 后缀
    // 归一键 = 小写 + 去掉所有分隔符 + 剥离来源/免费后缀。
    function normalizeKey(rawName) {
      let s = String(rawName || '').toLowerCase();
      // 剥离所有括号内容：末尾的 (ClinePass)/(LLM7)/(free)，以及中间的 (Exp)
      let prev;
      do {
        prev = s;
        s = s.replace(/[（(\[][^）)\]]*[）)\]]/g, ' ');
      } while (s !== prev);
      s = s.replace(/\s+/g, ' ').trim();
      // 剥离来源/免费后缀
      let before;
      do {
        before = s;
        s = s.replace(/[\s\-_·]+(clinepass|llm7|vercel|vertex|bedrock|wafer|openrouter|freerouter|free)$/i, '').trim();
      } while (s !== before);
      // 去掉所有分隔符与标点，得到纯压缩键
      return s.replace(/[\s\-_.:·/（）()\[\]]/g, '');
    }

    // 归一后的展示名：优先使用「无括号、无 free」的最干净写法
    function pickDisplayName(candidates) {
      const clean = candidates
        .map(c => String(c || '').trim())
        .filter(Boolean)
        .map(c => ({
          raw: c,
          penalty: (/[（(\[]/.test(c) ? 2 : 0)
            + (/\bfree\b/i.test(c) ? 2 : 0)
            + (/^[A-Z\s]+$/.test(c) ? 1 : 0)
            + (/^[a-z]/.test(c) ? 1 : 0)
        }));
      if (clean.length === 0) return '';
      clean.sort((a, b) => a.penalty - b.penalty || a.raw.length - b.raw.length);
      return clean[0].raw;
    }

    // ── 模型家族识别（用于列表折叠分组）────────────────────────────────────────
    // 顺序敏感：更具体的前缀必须排在前面（如 mimo 不能先被别的规则吃掉）
    const MODEL_FAMILIES = [
      { id: 'gpt', label: 'GPT / OpenAI', test: /^(gpt|o1|o3|o4|chatgpt)/i },
      { id: 'claude', label: 'Claude', test: /^claude/i },
      { id: 'gemini', label: 'Gemini', test: /^gemini/i },
      { id: 'deepseek', label: 'DeepSeek', test: /^deepseek/i },
      { id: 'glm', label: 'GLM / 智谱', test: /^(glm|zhipu)/i },
      { id: 'kimi', label: 'Kimi / Moonshot', test: /^(kimi|moonshot)/i },
      { id: 'qwen', label: 'Qwen / 通义', test: /^(qwen|tongyi)/i },
      { id: 'grok', label: 'Grok', test: /^grok/i },
      { id: 'mimo', label: 'MiMo', test: /^mimo/i },
      { id: 'llama', label: 'Llama / Meta', test: /^(llama|meta-)/i },
      { id: 'minimax', label: 'MiniMax', test: /^minimax/i },
      { id: 'nemotron', label: 'Nemotron / NVIDIA', test: /^(nemotron|nvidia)/i },
      { id: 'mistral', label: 'Mistral / Codestral', test: /^(mistral|codestral|devstral|magistral)/i },
      { id: 'doubao', label: 'Doubao / Seed / 豆包', test: /^(doubao|seed)/i },
      { id: 'cohere', label: 'Command / Cohere', test: /^command/i },
      { id: 'gemma', label: 'Gemma', test: /^gemma/i },
      { id: 'hunyuan', label: 'Hunyuan / 混元', test: /^(hunyuan|hy\d)/i },
      { id: 'qwq', label: 'QwQ', test: /^qwq/i },
      { id: 'muse', label: 'Muse', test: /^muse/i },
      { id: 'sonar', label: 'Sonar / Perplexity', test: /^sonar/i },
      { id: 'ling', label: 'Ling', test: /^ling/i },
      { id: 'longcat', label: 'LongCat', test: /^longcat/i },
      { id: 'hermes', label: 'Hermes', test: /^hermes/i },
      { id: 'morph', label: 'Morph', test: /^morph/i },
      { id: 'kilo', label: 'Kilo Auto', test: /^kilo/i }
    ];
    const OTHER_FAMILY = { id: 'other', label: '其他模型', test: null };

    // 模型数少于该值的家族会并入「其他」，避免折叠后仍有 20+ 个一行标题堆满面板
    const FAMILY_MERGE_THRESHOLD = 3;

    function detectFamily(canonName) {
      const n = String(canonName || '');
      for (const f of MODEL_FAMILIES) {
        if (f.test.test(n)) return f;
      }
      return OTHER_FAMILY;
    }

    // ── 默认模型、渠道与偏好存储（localStorage + 本地磁盘双重持久化）─────────────────
    const STORAGE_DEFAULT_KEY = 'dsh_sm_default_target_v3';
    const STORAGE_MODEL_DEFAULTS_KEY = 'dsh_sm_model_channel_defaults_v3';
    const STORAGE_FAVORITES_KEY = 'dsh_sm_favorited_models_v3';
    const STORAGE_VIEW_MODE_KEY = 'dsh_sm_view_mode_v1';
    const STORAGE_CHANNEL_ORDER_KEY = 'dsh_sm_channel_order_v1';

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

    // ── 视图模式（按模型 / 按渠道）与自定义渠道排序 ─────────────────────────────
    // 两者都是用户显式偏好，与 favoritedModels / modelChannelDefaults 同构：
    // localStorage 负责秒开零闪烁，磁盘 /api/smart-models/preferences 负责清缓存不丢。

    // 行→伴随卡的关闭宽限。150ms 太短：鼠标从行移到卡片要跨 6px 间隙，
    // 斜向移动时经常还没到位就超时，卡片闪断（用户实测报障）。
    const FLYOUT_CLOSE_DELAY_MS = 320;

    // 伴随卡的内部几何（必须与 CSS 严格一致，否则「选项对齐母行」会偏几个像素）：
    //   .dsh-sm-companion-head  padding 8+8 + 标题行 ~15 + 下边框 1  ≈ 32
    //   .dsh-sm-companion-channels 上内边距 6
    //   合计 38px 才是「第一张选项卡的顶边」距卡片顶部的距离。
    const FLYOUT_OPTION_OFFSET_PX = 38;
    // 单张选项卡（.dsh-sm-detail-card）的外高：padding 6+6 + 文字行 ~15 + 上下边框 2 ≈ 29
    const FLYOUT_OPTION_ROW_PX = 29;

    // 「默认按模型分类」的一次性重置标记。
    // 视图模式本身是持久化偏好（用户切到渠道后下次仍记得），
    // 但历史存量里可能已经存着 'channel'，导致「打开就是渠道」——
    // 与默认值不符。用这个标记只强制重置一次，之后用户的显式选择继续被尊重。
    const STORAGE_VIEW_MODE_DEFAULTED_KEY = 'dsh_sm_view_mode_defaulted_v1';

    // loadViewMode 执行一次性重置时置位；水合逻辑据此忽略磁盘里的旧 'channel'，
    // 否则磁盘偏好会在挂载后把刚重置的 'model' 又覆盖回去，重置等于没做。
    let viewModeResetPending = false;

    function loadViewMode() {
      try {
        // 存量数据一次性归位：只在没有标记时执行，执行后写标记永不再跑
        const defaulted = localStorage.getItem(STORAGE_VIEW_MODE_DEFAULTED_KEY);
        if (!defaulted) {
          localStorage.setItem(STORAGE_VIEW_MODE_DEFAULTED_KEY, '1');
          localStorage.setItem(STORAGE_VIEW_MODE_KEY, 'model');
          viewModeResetPending = true;
          return 'model';
        }
        const raw = localStorage.getItem(STORAGE_VIEW_MODE_KEY);
        return raw === 'channel' ? 'channel' : 'model';
      } catch (e) {
        return 'model';
      }
    }

    function saveViewMode(mode) {
      try {
        localStorage.setItem(STORAGE_VIEW_MODE_KEY, mode === 'channel' ? 'channel' : 'model');
      } catch (e) {}
    }

    function loadChannelOrder() {
      try {
        const raw = localStorage.getItem(STORAGE_CHANNEL_ORDER_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(x => typeof x === 'string' && x !== '');
      } catch (e) {
        return [];
      }
    }

    function saveChannelOrder(list) {
      try {
        localStorage.setItem(STORAGE_CHANNEL_ORDER_KEY, JSON.stringify(Array.isArray(list) ? list : []));
      } catch (e) {}
    }

    // ── 内置渠道优先序 ────────────────────────────────────────────────────────
    // 用户明确指定的顺序（自上而下）。未列出的渠道排在最后，按模型数降序。
    // 这份表只是默认值，设置页「渠道排序」可用 ↑/↓ 完全覆盖（见 ChannelOrderPage）。
    //
    // 顺序依据（2026-10-20 用户指定）：
    //   1. agy / Google Gemini —— 官方直连，配额型（百分比窗口）
    //   2. 国内大厂免费积分渠道：WorkBuddy 国际、TRAE(字节)、讯飞 Loomy、CodeArts(华为云)
    //   3. 其余第三方
    //   4. 有道 LobsterAI、Qoder —— 下调
    //   5. 官方账号（DeepSeek 网页端）、Siliconflow —— 置底
    const CHANNEL_PRIORITY = [
      'agy', 'agy-link', 'antigravity',
      'gemini', 'gemini-code-assist',
      'workbuddy',
      'trae',
      'loomy',
      'codearts',
      'buddy',
      'minimax',
      'zcode',
      'cline',
      'raccoon',
      'lobsterai',
      'qoder', 'qodercn',
      'deepseek-account',
      'siliconflow'
    ];

    // 渠道在优先序表中的名次；未列出的返回一个大数（排最后）
    function channelPriorityOf(providerId) {
      const id = String(providerId || '').toLowerCase();
      const idx = CHANNEL_PRIORITY.indexOf(id);
      if (idx !== -1) return idx;
      // 模糊匹配：'agy-link-quota' 之类带后缀的 id 也要归到 agy
      for (let i = 0; i < CHANNEL_PRIORITY.length; i += 1) {
        const key = CHANNEL_PRIORITY[i];
        if (key !== '' && id.includes(key)) return i;
      }
      return CHANNEL_PRIORITY.length;
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
      // 方案3：最近一次请求实际消费的渠道（projection.lastUsed），与 pending 分离记录
      const [lastUsedSelection, setLastUsedSelection] = useState(null);
      // 方案3修正：后端投影里的"待生效选择"（projection.next 且 pending 非空）。
      // 与 currentSelection 分开：后者会被乐观更新污染，不能用来判断是否已生效。
      const [confirmedNextSelection, setConfirmedNextSelection] = useState(null);
      const [modelChannelDefaults, setModelChannelDefaults] = useState(() => loadModelChannelDefaults());
      const [favoritedModels, setFavoritedModels] = useState(() => new Set(loadFavoritedModels()));
      const [hoveredModel, setHoveredModel] = useState(null);
      const [flyoutPos, setFlyoutPos] = useState({ top: 8, flipLeft: false, maxHeight: 380, optionAligned: true });
      const [popoverCoords, setPopoverCoords] = useState(null);
      const [dynamicChannelInfo, setDynamicChannelInfo] = useState({});
      // 视图模式：'model'（聚合模型行）| 'channel'（渠道 × 模型分组）
      const [viewMode, setViewMode] = useState(() => loadViewMode());
      // 自定义渠道排序：显式列出的渠道按其次序靠前，未列出的按内置优先序
      const [channelOrder, setChannelOrder] = useState(() => loadChannelOrder());
      // 渠道视图：当前悬停的渠道（决定右侧伴随卡显示哪个渠道的模型列表）。
      // 二级列表改为伴随卡后，「展开」不再是持久状态，主卡片只剩渠道行。
      const [hoveredChannel, setHoveredChannel] = useState(null);
      // providerId -> summary | 'loading' | null
      const [channelBalances, setChannelBalances] = useState({});

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
                // 视图模式以磁盘为准（不做合并）：它是用户显式选择，不是累积集合。
                // 但若本次挂载刚做过「默认按模型」的一次性重置，就必须忽略磁盘里的
                // 旧 'channel'，否则重置会被磁盘覆盖、等于没做。
                if (disk.viewMode === 'model' || disk.viewMode === 'channel') {
                  if (viewModeResetPending && disk.viewMode === 'channel') {
                    // 保留刚重置的 'model'，并把磁盘也改成 model（下次不再冲突）
                    saveViewMode('model');
                    syncPreferencesToDisk({
                      viewMode: 'model',
                      channelOrder: Array.isArray(disk.channelOrder) ? disk.channelOrder : [],
                      modelChannelDefaults: disk.modelChannelDefaults || {},
                      favoritedModels: Array.isArray(disk.favoritedModels) ? disk.favoritedModels : []
                    });
                  } else {
                    setViewMode(disk.viewMode);
                    saveViewMode(disk.viewMode);
                  }
                }
                if (Array.isArray(disk.channelOrder)) {
                  const order = disk.channelOrder.filter(x => typeof x === 'string' && x !== '');
                  setChannelOrder(order);
                  saveChannelOrder(order);
                }
              }
            }
          } catch (e) {}
        })();
      }, []);

      // 3. 上行自检：被动信号（零网络）
      //    挂载时拉一次；切到某渠道时若该渠道还没数据，补拉该渠道。
      //    主动探活不在这里 —— 它必须由用户显式点击（会消耗上游额度）。
      const [uplinkHealth, setUplinkHealth] = useState(null);
      const [uplinkError, setUplinkError] = useState('');
      const uplinkRef = useRef({ at: 0, provider: '' });

      const refreshUplinkHealth = useCallback(async (force) => {
        const cached = uplinkRef.current;
        if (force !== true && cached.at > 0 && Date.now() - cached.at < UPLINK_CACHE_TTL_MS) return;
        try {
          const data = await fetchUplinkHealth('');
          uplinkRef.current = { at: Date.now(), provider: '' };
          setUplinkHealth(data);
          setUplinkError('');
        } catch (e) {
          // 自检失败不能影响选择器：静默降级，状态点全部不显示
          setUplinkError(String(e?.message ?? e));
        }
      }, []);

      useEffect(() => {
        void refreshUplinkHealth(false);
      }, [refreshUplinkHealth]);

      // 4. 获取会话与模型目录
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

      // 调用底层 RPC 选择模型（方案1：失败必须抛出，不能静默吞掉）
      const invokeSelectModel = useCallback(async (payload) => {
        const candidates = [
          ['remoteSession', remoteSession?.selectModel],
          ['sessions', sessions?.selectModel],
          ['ctx.remote.session', effectiveCtx?.remote?.session?.selectModel],
        ];
        // 诊断：把三个候选接口的真实可用性打到控制台，便于定位"切换无效"
        console.log('[SmartModels][diag] selectModel 候选:', candidates.map(([n, fn]) => `${n}=${typeof fn}`).join(' | '));

        let lastError = null;
        for (const [name, fn] of candidates) {
          if (typeof fn !== 'function') continue;
          // 保留原对象作为 receiver：RPC 方法依赖 this 绑定，脱离对象调用会失效
          const receiver = name === 'remoteSession' ? remoteSession
            : name === 'sessions' ? sessions
            : effectiveCtx.remote.session;
          try {
            const result = await fn.call(receiver, payload);
            // DSH 的 RemoteResult 契约：一元调用**从不 reject**，而是返回
            //   { ok: true, value } 或 { ok: false, error }。
            // 因此"成功"必须以 result.ok 为准，不能只看有没有抛异常。
            if (result !== null && typeof result === 'object' && result.ok === false) {
              const err = result.error;
              const msg = err?.message || err?.code || '远端拒绝该模型选择';
              console.error(`[SmartModels] selectModel 被拒绝 via ${name}:`, err);
              throw err instanceof Error ? err : new Error(String(msg));
            }
            console.log('[SmartModels] selectModel 成功 via', name, result);
            return result;
          } catch (e) {
            lastError = e;
            console.error(`[SmartModels] selectModel 失败 via ${name}:`, e);
          }
        }
        if (lastError !== null) throw lastError;
        throw new Error('未找到可用的 selectModel RPC 接口（remoteSession / sessions / ctx.remote.session 均不可调用）');
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
            // projection view 暴露两个字段（DSH 定义）：
            //   next     = pending ?? lastUsed —— 下一次请求将要使用的选择
            //   lastUsed = 最近一次已记录请求实际消费的选择
            // pending 与 lastUsed 相同时 DSH 会自动清空 pending，故 next === lastUsed 即"已同步"。
            const nextSel = snapshot?.next || snapshot?.current || null;
            const usedSel = snapshot?.lastUsed || null;
            setCurrentSelection(nextSel);
            setLastUsedSelection(usedSel);
            // 后端是否真的还有一个"待生效"选择：
            // DSH 在 pending 被请求消费后会自动置空，此时 next 回落到 lastUsed。
            // 因此 pending 存在 ⟺ next 与 lastUsed 不同（由 DSH 的 sameSelection 语义保证）。
            const hasPending = nextSel !== null && usedSel !== null && (
              nextSel.provider !== usedSel.provider ||
              nextSel.model !== usedSel.model ||
              (nextSel.reasoningEffort || '') !== (usedSel.reasoningEffort || '')
            );
            setConfirmedNextSelection(hasPending ? nextSel : null);
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
        on: '开',
        off: '关'
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
            // 用强归一键做聚合 key：分隔符/大小写/括号来源后缀差异都视为同一模型
            const key = normalizeKey(canonName);
            const multiplier = extractMultiplier(m, providerId);
            const rateCls = getRateClass(multiplier);

            if (!map.has(key)) {
              map.set(key, {
                canonName,
                nameCandidates: [canonName],
                providers: []
              });
            }

            const entry = map.get(key);
            // 记录所有写法，稍后挑最干净的作为展示名
            if (canonName && !entry.nameCandidates.includes(canonName)) {
              entry.nameCandidates.push(canonName);
            }
            const existing = entry.providers;
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

        // 合并完成后统一决定展示名，并丢弃内部字段
        return Array.from(map.values()).map(entry => ({
          canonName: pickDisplayName(entry.nameCandidates) || entry.canonName,
          providers: entry.providers
        }));
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

      // 5.1 方案3：切换生效状态
      // 判定依据必须是**后端投影**（confirmedNextSelection），而不是乐观更新的 currentSelection：
      // 乐观值会在 RPC 尚未确认时提前反映选择，用它比对会产生假"未生效"。
      const switchState = useMemo(() => {
        if (!lastUsedSelection) return { kind: 'idle' };
        // 后端没有 pending → 已同步（最后一次请求用的就是当前选择）
        if (!confirmedNextSelection) return { kind: 'synced' };
        return {
          kind: 'pending',
          fromProvider: lastUsedSelection.provider,
          fromModel: lastUsedSelection.model,
          toProvider: confirmedNextSelection.provider,
          toModel: confirmedNextSelection.model
        };
      }, [confirmedNextSelection, lastUsedSelection]);

      // 5.2 按渠道真实能力规范化思考档位
      // 每个渠道支持的档位不同（例如 CodeArts 只有 on/off，CodeBuddy 有 low/high/max），
      // 把不支持的值原样发过去会被 DSH 以 UNSUPPORTED_REASONING_EFFORT 拒绝，
      // 表现为"切换无效"。这里从 catalog 的 reasoning.efforts 读取真实档位并降级映射。
      const normalizeEffort = useCallback((providerId, modelId, effort) => {
        if (effort === undefined || effort === null || effort === '') return undefined;
        let meta = null;
        try {
          const grp = catalog?.groups?.find(g => g.id === providerId);
          const mdl = grp?.models?.find(m => m.id === modelId);
          meta = mdl?.reasoning || null;
        } catch (e) { meta = null; }
        // 该模型没有声明 reasoning 能力：不发送档位
        if (!meta) return undefined;
        const list = Array.isArray(meta.efforts) ? meta.efforts.map(x => (typeof x === 'string' ? x : x?.id)).filter(Boolean) : [];
        if (list.length === 0) return undefined;
        if (list.includes(effort)) return effort;
        // 降级优先级：同语义 > 就近 > 默认 > 首项
        const alias = { on: ['on', 'high', 'medium', 'low'], off: ['off', 'disabled', 'low'], disabled: ['disabled', 'off', 'low'],
                        high: ['high', 'max', 'medium', 'low', 'on'], max: ['max', 'high', 'xhigh', 'medium', 'low'],
                        xhigh: ['xhigh', 'max', 'high', 'medium', 'low'], medium: ['medium', 'high', 'low'], low: ['low', 'medium', 'high'] };
        for (const cand of (alias[effort] || [])) {
          if (list.includes(cand)) return cand;
        }
        if (meta.defaultEffort && list.includes(meta.defaultEffort)) return meta.defaultEffort;
        return list[0];
      }, [catalog]);

      // 6. 切换模型操作（方案1：乐观更新 + 失败回滚，杜绝"UI 显示已切、实际没切"）
      const handleSelect = useCallback(async (providerId, modelId, effort) => {
        if (!sessionId) return;
        const previous = currentSelection;
        try {
          // 先按目标渠道能力规范化档位，避免把不支持的值发上去被拒
          const safeEffort = normalizeEffort(providerId, modelId, effort);
          const payload = {
            sessionId,
            provider: providerId,
            model: modelId,
            ...(safeEffort !== undefined ? { reasoningEffort: safeEffort } : {})
          };
          // 乐观更新：先让 UI 立刻响应（用规范化后的档位，保证 UI 显示的值真实存在）
          setCurrentSelection({ provider: providerId, model: modelId, reasoningEffort: safeEffort });
          await invokeSelectModel(payload);
        } catch (e) {
          // RPC 真的失败了：回滚到切换前的真实状态，并明确报错
          console.error('[SmartModels] 切换模型失败，已回滚 UI:', e);
          setCurrentSelection(previous);
          try {
            const msg = e instanceof Error ? e.message : String(e);
            if (typeof window !== 'undefined' && typeof window.alert === 'function') {
              window.alert('切换模型失败：' + msg + '\n\nUI 已回滚到切换前的渠道。');
            }
          } catch (ignored) { /* 提示失败不影响回滚 */ }
        }
        // normalizeEffort 依赖 catalog，必须列入依赖，否则闭包会捕获过期的 catalog
      }, [sessionId, invokeSelectModel, currentSelection, normalizeEffort]);

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

      // 家族分组：搜索时返回 null（走平铺），否则星标/当前模型置顶 + 家族折叠
      const groupedModels = useMemo(() => {
        if (query.trim()) return null;

        const activeCanonKey = activeInfo?.canonName ? activeInfo.canonName.toLowerCase() : null;
        const pinned = [];
        const byFamily = new Map();

        for (const item of filteredList) {
          const canonKey = item.canonName.toLowerCase();
          const isFav = favoritedModels.has(canonKey);
          const isActive = Boolean(activeCanonKey && canonKey === activeCanonKey);

          if (isFav || isActive) {
            pinned.push({ item, isFav, isActive });
            continue;
          }
          const fam = detectFamily(item.canonName);
          if (!byFamily.has(fam.id)) byFamily.set(fam.id, { fam, items: [] });
          byFamily.get(fam.id).items.push(item);
        }

        // 小家族并入「其他」：折叠态下标题行不至于堆到 20+
        // mergedFamilies 记录被并掉的原始家族 id，供后面的 familyRemap 使用
        const mergedFamilies = [];
        const mergedOther = { fam: OTHER_FAMILY, items: [] };
        for (const [famId, group] of Array.from(byFamily.entries())) {
          if (famId === 'other') continue;
          if (group.items.length < FAMILY_MERGE_THRESHOLD) {
            mergedOther.items.push(...group.items);
            byFamily.delete(famId);
            mergedFamilies.push(famId);
          }
        }
        if (mergedOther.items.length > 0) {
          const existingOther = byFamily.get('other');
          if (existingOther) existingOther.items.push(...mergedOther.items);
          else byFamily.set('other', mergedOther);
        }

        const families = Array.from(byFamily.values()).sort((a, b) => {
          // 「其他」永远排最后；其余按模型数降序
          if (a.fam.id === 'other') return 1;
          if (b.fam.id === 'other') return -1;
          if (b.items.length !== a.items.length) return b.items.length - a.items.length;
          return a.fam.label.localeCompare(b.fam.label);
        });

        // 「原始家族 id → 实际渲染的家族 id」映射。
        //
        // 两个必须处理的错位：
        //   1. 小家族（模型数 < FAMILY_MERGE_THRESHOLD）被并入「其他模型」：
        //      detectFamily() 算出 'deepseek'，界面上真实存在的块却是 'other'。
        //   2. 当前模型本身被置顶，不进任何家族 —— 所以不能靠「遍历家族找它」，
        //      必须从它的名字反查家族 id 再做映射。
        //
        // 不做这层映射，autoFamilyId 就永远匹配不到渲染出来的家族，
        // 自动展开会静默失效。
        const familyRemap = new Map();
        for (const famId of byFamily.keys()) familyRemap.set(famId, famId);
        // 被并入「其他」的原始家族，全部指向 'other'
        for (const famId of mergedFamilies) familyRemap.set(famId, 'other');
        familyRemap.set('other', 'other');

        return { pinned, families, familyRemap };
      }, [filteredList, query, favoritedModels, activeInfo?.canonName]);

      // ── 渠道视图：分组构建 ───────────────────────────────────────────────────
      // 行语义 = 「渠道 × 模型」：同一个模型在 N 个渠道就出现 N 次。
      // 这是刻意的——渠道视图回答的是「我信任这个渠道，它有什么、还剩多少」，
      // 所以重复是有效信息，不做跨渠道聚合。
      const channelGroups = useMemo(() => {
        if (viewMode !== 'channel') return [];
        if (!catalog?.groups) return [];

        const q = query.trim().toLowerCase();
        const groups = [];

        for (const group of catalog.groups) {
          const providerId = group.id;
          if (!providerId) continue;
          const providerName = formatProviderName(providerId, group.name);
          const items = [];

          for (const m of (group.models || [])) {
            const canonName = canonicalize(m.id, m.name);
            const multiplier = extractMultiplier(m, providerId);
            // 搜索：命中模型名、模型 id 或渠道名都算命中该行
            if (q) {
              const hit = canonName.toLowerCase().includes(q)
                || String(m.id).toLowerCase().includes(q)
                || providerName.toLowerCase().includes(q)
                || providerId.toLowerCase().includes(q);
              if (!hit) continue;
            }
            items.push({
              providerId,
              providerName,
              modelId: m.id,
              canonName,
              multiplier,
              rateCls: getRateClass(multiplier),
              reasoning: m.reasoning || null,
            });
          }

          if (items.length > 0) groups.push({ providerId, providerName, items });
        }

        // 排序：自定义顺序优先（显式列出的按其次序），
        // 未列出的按内置优先序（大厂 → 第三方 → 免费池），再按模型数降序，最后按名称。
        const orderIndex = new Map();
        channelOrder.forEach((id, i) => { if (!orderIndex.has(id)) orderIndex.set(id, i); });

        groups.sort((a, b) => {
          const ai = orderIndex.has(a.providerId) ? orderIndex.get(a.providerId) : -1;
          const bi = orderIndex.has(b.providerId) ? orderIndex.get(b.providerId) : -1;
          if (ai !== bi) {
            if (ai === -1) return 1;
            if (bi === -1) return -1;
            return ai - bi;
          }
          const at = channelPriorityOf(a.providerId);
          const bt = channelPriorityOf(b.providerId);
          if (at !== bt) return at - bt;
          if (b.items.length !== a.items.length) return b.items.length - a.items.length;
          return a.providerName.localeCompare(b.providerName);
        });

        return groups;
      }, [catalog, viewMode, query, channelOrder]);

      // 渠道展开/收起：多组可同时展开
      // 切换排列方式：立即生效 + 双写持久化（localStorage 秒开 / 磁盘防丢）
      const switchViewMode = useCallback((mode) => {
        const next = mode === 'channel' ? 'channel' : 'model';
        setViewMode(next);
        saveViewMode(next);
        syncPreferencesToDisk({
          viewMode: next,
          channelOrder,
          modelChannelDefaults,
          favoritedModels: Array.from(favoritedModels)
        });
      }, [channelOrder, modelChannelDefaults, favoritedModels]);

      // 渠道视图余额：进入即全量拉取，但走受控并发池（并发 2）分批推进。
      //
      // 为什么不是「悬停才查」：用户要的是打开就能横向对比「谁还有钱」，
      // 悬停触发会让大部分行长期显示 —，核心用途失效。
      // 为什么不是「全量并发」：credits.balances / usage.badge 都是串行逐账号的
      // 上游调用（单账号超时 30s），几十个渠道同时打出去会制造突发并触发风控。
      // 并发 2 + 每完成一个就 setState，界面渐进填充而不是等全部结束。
      useEffect(() => {
        if (viewMode !== 'channel') return;
        if (!catalog?.groups) return;

        const all = [];
        for (const g of catalog.groups) {
          if (!g?.id) continue;
          all.push(g.id);
        }
        if (all.length === 0) return;

        let cancelled = false;

        // 先用缓存填一遍（命中的渠道立即可见，无需等待）
        const cachedPatch = {};
        const todo = [];
        for (const pid of all) {
          const cached = creditsCache.get(pid);
          if (cached && Date.now() - cached.at < CHANNEL_BALANCE_TTL_MS) cachedPatch[pid] = cached.summary;
          else todo.push(pid);
        }
        if (Object.keys(cachedPatch).length > 0) {
          setChannelBalances(prev => {
            let changed = false;
            const next = { ...prev };
            for (const [pid, sum] of Object.entries(cachedPatch)) {
              if (next[pid] !== sum) { next[pid] = sum; changed = true; }
            }
            return changed ? next : prev;
          });
        }
        if (todo.length === 0) return;

        setChannelBalances(prev => {
          const next = { ...prev };
          for (const pid of todo) if (next[pid] === undefined) next[pid] = 'loading';
          return next;
        });

        void runWithConcurrency(todo, 2, async (pid) => {
          const sum = await fetchChannelBalance(effectiveCtx, pid);
          if (cancelled) return;
          setChannelBalances(prev => ({ ...prev, [pid]: sum === null ? null : sum }));
        });

        return () => { cancelled = true; };
        // 只在「进入渠道视图」或渠道目录变化时重跑；不依赖 channelBalances，
        // 否则每次 setState 都会重启整池，导致重复查询。
      }, [viewMode, catalog, effectiveCtx]);

      // 家族展开状态：手风琴互斥单开（手动点击时生效）。
      // 但「当前使用模型」所在的家族会**自动展开**，用户不必为了看见自己在用的模型
      // 而先点一次家族标题 —— 这是本次修正的核心。
      //
      // 语义拆分：
      //   · autoFamilyId  —— 由当前会话模型推导，永远自动展开
      //   · expandedFamily —— 用户手动点开的家族（互斥单开，可为 null）
      //   · 实际展开集合 = autoFamilyId ∪ expandedFamily
      //   · 用户点「当前模型所在家族」时，允许临时收起（collapsedAutoId 记录）
      const [expandedFamily, setExpandedFamily] = useState(null);
      const [collapsedAutoId, setCollapsedAutoId] = useState(null);

      // 当前使用模型所属的家族 id（无当前模型时为 null）。
      // ⚠️ 必须查 groupedModels.familyIdOfCanon，而不是直接 detectFamily：
      //    当前模型本身会被置顶（不进任何家族），它所属家族可能因模型数不足被并入
      //    「其他模型」；此时真实渲染的 id 是 'other'，用 detectFamily 的结果永远匹配不上。
      const autoFamilyId = useMemo(() => {
        const canonKey = activeInfo?.canonName ? activeInfo.canonName.toLowerCase() : null;
        if (!canonKey) return null;
        const remap = groupedModels?.familyRemap;
        if (!remap) return null;
        // 先按名字判出原始家族，再映射到界面上真实存在的家族 id
        // （当前模型被置顶、不进任何家族，所以不能靠遍历家族反查）
        const rawFam = detectFamily(activeInfo.canonName);
        const rawId = rawFam && rawFam.id ? rawFam.id : null;
        if (!rawId) return null;
        return remap.get(rawId) ?? null;
      }, [activeInfo?.canonName, groupedModels]);

      const toggleFamily = useCallback((famId) => {
        // 点的是自动展开的家族：在「自动展开」与「手动收起」之间切换
        if (autoFamilyId && famId === autoFamilyId) {
          setCollapsedAutoId(prev => (prev === famId ? null : famId));
          setExpandedFamily(null);
          return;
        }
        setExpandedFamily(prev => (prev === famId ? null : famId));
      }, [autoFamilyId]);

      // 某个家族此刻是否展开
      const isFamilyOpen = useCallback((famId) => {
        if (autoFamilyId && famId === autoFamilyId && collapsedAutoId !== famId) return true;
        return expandedFamily === famId;
      }, [autoFamilyId, collapsedAutoId, expandedFamily]);

      // 当前伴随卡片对应的模型对象
      const activeCompanionItem = useMemo(() => {
        if (!hoveredModel) return null;
        return aggregatedModels.find(m => m.canonName.toLowerCase() === hoveredModel.canonName.toLowerCase()) || hoveredModel;
      }, [hoveredModel, aggregatedModels]);

      // 单个模型行渲染（平铺与分组两条路径共用，保证样式与交互一致）
      // 动态测量计算伴随卡片的 Y 轴动态对齐与屏幕贴边避障 (方案 2 核心)
      /**
       * 计算伴随卡的 Y 位置与可用高度。
       *
       * 设计原则（本次修正的核心）：
       *   **首行永远与悬停行对齐**。旧实现为了「不溢出视口」把整个卡片向上推
       *   （targetGlobalTop = min(rowTop-4, maxGlobalTop)），结果卡片贴近屏幕底部时
       *   首行被顶到悬停行上方，对不齐——用户看到的正是这个问题。
       *
       * 现在的做法：卡片顶部严格锚定在悬停行（只在贴近视口顶部时下移），
       * 溢出的部分靠 **maxHeight 内部滚动** 消化，而不是移动卡片。
       */
      /**
       * 计算伴随卡的位置。
       *
       * 对齐目标（用户明确要求）：
       *   **第一个选项（第一张渠道卡）与母行垂直居中对齐**，
       *   而不是让卡片"头部"去对齐母行。
       *
       * 为什么不能直接让卡片顶部对齐母行：卡片顶部到第一张选项卡之间还有
       * 「头部标题栏」+「列表上内边距」，共 FLYOUT_OPTION_OFFSET_PX。若不补偿这段
       * 偏移，对齐的是标题栏，用户看到的是选项整体下坠一个头高。
       *
       * 空间不足时（母行贴近视口底部）退回「整卡上移」策略：优先保证卡片可见，
       * 此时不再追求选项级对齐——这是有意的取舍，避免卡片被裁掉。
       */
      const calculateFlyoutPos = useCallback((rowEl, popoverEl, providerCount) => {
        if (!rowEl || !popoverEl) return { top: 0, flipLeft: false, maxHeight: 380 };
        const popoverRect = popoverEl.getBoundingClientRect();
        const rowRect = rowEl.getBoundingClientRect();
        const flyoutWidth = 245;
        const margin = 12;

        // 1. 水平避障：右侧不够空间则翻转到左侧
        const flipLeft = (popoverRect.right + flyoutWidth + 12) > window.innerWidth;

        // 2. 卡片期望高度：头部 + N 张选项卡 + 内边距（与 CSS 保持同一套尺寸语言）
        const desiredHeight = Math.min(460, FLYOUT_OPTION_OFFSET_PX + providerCount * FLYOUT_OPTION_ROW_PX + 8);

        // 3. 首选：让「第一张选项卡」的中线与母行中线重合。
        //    选项卡中线 = 卡片顶部 + OFFSET + 单张卡高/2
        const rowCenter = rowRect.top + rowRect.height / 2;
        const desiredTopForOptionAlign = rowCenter - FLYOUT_OPTION_OFFSET_PX - FLYOUT_OPTION_ROW_PX / 2;

        // 4. 可用空间：卡片必须完整落在视口内（上下各留 margin）
        const maxTop = window.innerHeight - margin - desiredHeight;
        const minTop = margin;

        let topGlobal = desiredTopForOptionAlign;
        let optionAligned = true;

        // 母行靠下、卡片会溢出底部 → 改为上移，放弃选项级对齐
        if (topGlobal > maxTop) {
          topGlobal = maxTop;
          optionAligned = false;
        }
        // 母行靠上、卡片会溢出顶部 → 下移，同样放弃选项级对齐
        if (topGlobal < minTop) {
          topGlobal = minTop;
          optionAligned = false;
        }

        // 5. 最终高度：不超过剩余空间，内容超出则内部滚动
        const available = window.innerHeight - topGlobal - margin;
        const maxHeight = Math.max(140, Math.min(desiredHeight, available));

        const topRel = topGlobal - popoverRect.top;
        return {
          top: Math.round(topRel),
          flipLeft,
          maxHeight: Math.round(maxHeight),
          // 供测试与调试：本次是否真的做到了「选项级对齐」
          optionAligned,
        };
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
        }, FLYOUT_CLOSE_DELAY_MS);
      }, []);

      // 渠道行悬停：复用模型视图的 150ms 离开宽限与隐形桥接通道，
      // 避免鼠标从主卡片移向伴随卡时中间缝隙导致卡片闪断。
      const handleChannelEnter = useCallback((group, e) => {
        if (leaveTimerRef.current) {
          clearTimeout(leaveTimerRef.current);
          leaveTimerRef.current = null;
        }
        const pos = calculateFlyoutPos(e.currentTarget, popoverRef.current, group.items.length);
        setFlyoutPos(pos);
        setHoveredChannel(group);
      }, [calculateFlyoutPos]);

      const handleChannelLeave = useCallback(() => {
        if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
        leaveTimerRef.current = setTimeout(() => setHoveredChannel(null), FLYOUT_CLOSE_DELAY_MS);
      }, []);

      const handleFlyoutMouseEnter = useCallback(() => {
        if (leaveTimerRef.current) {
          clearTimeout(leaveTimerRef.current);
          leaveTimerRef.current = null;
        }
      }, []);

      // 伴随卡自身的离开处理。
      // ⚠️ 必须同时清 hoveredModel 与 hoveredChannel：旧实现只清前者，
      //    渠道伴随卡离开后永不关闭，会一直挂在界面上（实测 bug）。
      const handleFlyoutMouseLeave = useCallback(() => {
        if (leaveTimerRef.current) {
          clearTimeout(leaveTimerRef.current);
        }
        leaveTimerRef.current = setTimeout(() => {
          setHoveredModel(null);
          setHoveredChannel(null);
        }, FLYOUT_CLOSE_DELAY_MS);
      }, []);

      // 单个模型行渲染（平铺与分组两条路径共用）
      // ⚠️ 必须声明在 handleRowMouseEnter / handleRowMouseLeave / handleSelect /
      //    handleToggleFavorite 之后，否则 useCallback 的依赖数组会触发 TDZ 报错。
      const renderModelRow = useCallback((item) => {
        const canonKey = item.canonName.toLowerCase();
        const isSessionModel = activeInfo?.canonName && activeInfo.canonName.toLowerCase() === canonKey;
        const isHovered = hoveredModel?.canonName && hoveredModel.canonName.toLowerCase() === canonKey;
        const isFav = favoritedModels.has(canonKey);

        // 若为当前会话激活模型，显示实际使用的渠道与倍率；否则显示首选默认渠道
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
          h('div', { className: 'dsh-sm-master-right' }, [
            displayShortChannel && h('span', {
              className: 'dsh-sm-master-channel-name',
              title: `渠道: ${displayProvider?.providerName || displayShortChannel}`
            }, displayShortChannel),
            h('span', { className: `dsh-sm-rate-tag ${getRateClass(displayRate)}` }, formatCompactRate(displayRate)),
            (() => {
              const verdict = healthForModel(uplinkHealth, item);
              if (verdict === null) return null;
              const meta = HEALTH_LEVELS[verdict.level] || HEALTH_LEVELS.unknown;
              const isPlan = Boolean(verdict.subscription);
              return h('span', {
                className: `dsh-sm-health-dot ${meta.cls}${isPlan ? ' is-plan' : ''}`,
                title: verdict.reasons.join('\n')
              });
            })(),
            h('span', { className: 'dsh-sm-master-arrow' }, '›')
          ])
        ]);
      }, [activeInfo, hoveredModel, favoritedModels, modelChannelDefaults, uplinkHealth, handleRowMouseEnter, handleRowMouseLeave, handleSelect, handleToggleFavorite]);

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
          // 渠道悬停态也必须重置：否则重开面板会残留上一次的渠道伴随卡
          setHoveredChannel(null);
          window.addEventListener('resize', updatePopoverPosition);
          window.addEventListener('scroll', updatePopoverPosition, true);
          return () => {
            window.removeEventListener('resize', updatePopoverPosition);
            window.removeEventListener('scroll', updatePopoverPosition, true);
          };
        } else {
          setHoveredModel(null);
          setHoveredChannel(null);
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
          ? `模型：${activeInfo.canonName}\n渠道：${activeInfo.providerName}\n计费倍率：${activeInfo.multiplier}${activeInfo.effort ? `\n思考档位：${formatEffortLabel(activeInfo.effort)} (${activeInfo.effort})` : ''}${switchState.kind === 'pending' ? `\n\n⚠ 切换尚未生效\n已选择：${switchState.toProvider} / ${switchState.toModel}\n最近请求：${switchState.fromProvider} / ${switchState.fromModel}\n下一次发送消息后生效` : ''}\n点击打开选择面板`
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
        // 方案3：已切换但尚未被下一次请求消费时，显式提示
        switchState.kind === 'pending' && h('span', {
          className: 'dsh-sm-trigger-pending',
          title: `已选择 ${switchState.toProvider} / ${switchState.toModel}，但最近一次请求仍使用 ${switchState.fromProvider} / ${switchState.fromModel}。发送下一条消息后生效。`
        }, '待生效'),
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

      // ── 渠道视图伴随卡：悬停渠道行 → 右侧列出该渠道的全部模型 ──
      // 与「按模型」视图的伴随卡完全同构（同样的位置计算、翻转避让、150ms 宽限、
      // 隐形桥接通道），只是内容从「某模型的各渠道」换成「某渠道的各模型」。
      const channelCompanion = (open && viewMode === 'channel' && hoveredChannel) && h('div', {
        key: 'channel-companion',
        className: 'dsh-sm-companion-flyout' + (flyoutPos.flipLeft ? ' flip-left' : ''),
        style: { top: flyoutPos.top + 'px', maxHeight: (flyoutPos.maxHeight || 380) + 'px' },
        onMouseEnter: handleFlyoutMouseEnter,
        onMouseLeave: handleFlyoutMouseLeave
      }, [
        h('div', { key: 'head', className: 'dsh-sm-companion-head' }, [
          h('div', { key: 'title-wrap', className: 'dsh-sm-companion-title-wrap' }, [
            h('div', { key: 'title', className: 'dsh-sm-companion-title', title: hoveredChannel.providerName }, hoveredChannel.providerName),
            h('span', { key: 'count', className: 'dsh-sm-companion-count' }, hoveredChannel.items.length + ' 个模型')
          ])
        ]),
        h('div', { key: 'rows', className: 'dsh-sm-companion-channels' },
          hoveredChannel.items.map(item => {
            const isSessionRow = Boolean(
              activeInfo
              && isSameProvider(activeInfo.providerId, item.providerId)
              && activeInfo.modelId === item.modelId
            );
            const row = healthOf(uplinkHealth, item.providerId, item.modelId);
            return h('div', {
              key: item.providerId + '::' + item.modelId,
              className: 'dsh-sm-detail-card' + (isSessionRow ? ' active' : ''),
              title: isSessionRow
                ? '当前会话正在使用该模型'
                : '点击切换到 ' + item.canonName,
              onClick: () => {
                if (isSessionRow) return;
                handleSelect(item.providerId, item.modelId, item.reasoning?.defaultEffort);
              }
            }, [
              h('div', { key: 'left', className: 'dsh-sm-detail-left' }, [
                h('span', { key: 'name', className: 'dsh-sm-detail-provider-name', title: item.canonName }, item.canonName),
                h('span', { key: 'rate', className: 'dsh-sm-rate-tag ' + item.rateCls }, formatCompactRate(item.multiplier)),
                (() => {
                  if (!row) return null;
                  if (row.subscription) {
                    return h('span', { key: 'plan', className: 'dsh-sm-health-chip dsh-sm-plan-chip', title: row.reason }, '会员');
                  }
                  if (row.level === 'ok') return null;
                  const meta = HEALTH_LEVELS[row.level] || HEALTH_LEVELS.unknown;
                  return h('span', { key: 'dot', className: 'dsh-sm-health-dot ' + meta.cls, title: row.reason });
                })()
              ]),
              h('div', { key: 'right', className: 'dsh-sm-detail-right' },
                isSessionRow ? [h('span', { key: 'badge', className: 'dsh-sm-detail-active-badge' }, '使用中')] : []
              )
            ]);
          })
        )
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
              // 三态：① 渠道视图 ② 搜索平铺 ③ 置顶 + 家族折叠
              (viewMode === 'channel'
                ? (channelGroups.length === 0
                    ? h('div', { className: 'dsh-sm-empty' }, '未找到匹配渠道')
                    : channelGroups.map(group => {
                        const pid = group.providerId;
                        const bal = channelBalances[pid];
                        const balText = formatChannelBalance(bal);
                        const isQuota = Boolean(bal && bal !== 'loading' && bal.quotaMode);
                        const isHovered = hoveredChannel?.providerId === pid;
                        const isActiveGroup = Boolean(activeInfo && isSameProvider(activeInfo.providerId, pid));
                        return h('div', {
                          key: 'ch-' + pid,
                          className: 'dsh-sm-family-head dsh-sm-channel-row'
                            + (isHovered ? ' is-open' : '')
                            + (isActiveGroup ? ' is-active-group' : ''),
                          title: group.providerName + '：' + group.items.length + ' 个模型'
                            + (balText ? ' · 余额 ' + balText : ''),
                          onMouseEnter: (e) => handleChannelEnter(group, e),
                          onMouseLeave: handleChannelLeave
                        }, [
                          h('span', { key: 'arrow', className: 'dsh-sm-family-arrow' }, '›'),
                          h('span', { key: 'label', className: 'dsh-sm-family-label' }, group.providerName),
                          balText
                            ? h('span', {
                                key: 'balance',
                                className: 'dsh-sm-channel-balance' + (isQuota ? ' is-quota' : ''),
                                title: isQuota ? '该渠道 5h/周窗口最低剩余百分比' : '该渠道所有账号的积分总余额'
                              }, balText)
                            : null,
                          h('span', { key: 'count', className: 'dsh-sm-family-count' }, String(group.items.length))
                        ]);
                      }))
                : filteredList.length === 0
                ? h('div', { className: 'dsh-sm-empty' }, '未找到匹配模型')
                : (groupedModels === null
                    // ① 搜索中：平铺渲染（原有行为）
                    ? filteredList.map(renderModelRow)
                    // ② 非搜索：星标/当前模型置顶 + 家族折叠
                    : [
                        groupedModels.pinned.length > 0 && h('div', {
                          key: 'pinned',
                          className: 'dsh-sm-pinned-section'
                        }, groupedModels.pinned.map(p => renderModelRow(p.item))),
                        ...groupedModels.families.map(group => {
                          const famId = group.fam.id;
                          const isOpen = isFamilyOpen(famId);
                          // 只有「用户手动点开」的家族才吸顶；自动展开的家族不吸顶，
                          // 否则一进面板就有一根家族标题钉在顶部，反而挡住内容。
                          const isManualOpen = expandedFamily === famId;
                          return h('div', { key: 'fam-' + famId, className: 'dsh-sm-family' }, [
                            h('div', {
                              key: 'head',
                              className: `dsh-sm-family-head ${isOpen ? 'is-open' : ''}${isManualOpen ? ' is-sticky' : ''}`,
                              title: `${group.fam.label}：${group.items.length} 个模型（点击${isOpen ? '折叠' : '展开'}）`,
                              onClick: () => toggleFamily(famId)
                            }, [
                              h('span', { key: 'arrow', className: 'dsh-sm-family-arrow' }, isOpen ? '▾' : '▸'),
                              h('span', { key: 'label', className: 'dsh-sm-family-label' }, group.fam.label),
                              h('span', { key: 'count', className: 'dsh-sm-family-count' }, String(group.items.length))
                            ]),
                            isOpen && h('div', { key: 'body' }, group.items.map(renderModelRow))
                          ]);
                        })
                      ]))
            ])
          ]),

          // 底部常驻 footer：思考档位胶囊（按需）+ 视图切换开关（永远在最右端）。
          // ⚠️ 整行必须无条件渲染：档位是条件数据（Claude / GPT-OSS 的 efforts 为 null），
          //    若把开关挂在这一行的条件渲染里，切到无档位模型时开关会消失，
          //    用户就再也切不回「按模型」视图了 —— 那是功能死锁，不是体验瑕疵。
          h('div', { key: 'footer-row', className: 'dsh-sm-effort-row' }, [
            activeReasoning?.efforts && activeReasoning.efforts.length > 0
              ? h('div', { key: 'pills', className: 'dsh-sm-effort-pills' },
                  activeReasoning.efforts.map(eff => {
                    const isEffActive = (activeInfo?.effort ?? activeReasoning.defaultEffort) === eff.id;
                    return h('button', {
                      key: eff.id,
                      type: 'button',
                      className: `dsh-sm-effort-pill ${isEffActive ? 'active' : ''}`,
                      title: `思考档位: ${eff.name || eff.id}`,
                      onClick: () => handleSelect(activeInfo.providerId, activeInfo.modelId, eff.id)
                    }, eff.name || eff.id);
                  })
                )
              : h('span', { key: 'spacer', className: 'dsh-sm-footer-spacer' }),
            h('button', {
              key: 'view-toggle',
              type: 'button',
              // 单按钮两态：与思考档位胶囊同一视觉语言（激活态=蓝底白字），
              // 但额外带 is-channel 以便在「渠道」态用更醒目的强调色。
              className: 'dsh-sm-view-toggle'
                + (viewMode === 'channel' ? ' is-active is-channel' : ''),
              title: viewMode === 'channel'
                ? '当前：按渠道排列\n点击切回「按模型」'
                : '当前：按模型排列\n点击切到「按渠道」',
              onClick: () => switchViewMode(viewMode === 'channel' ? 'model' : 'channel')
            }, viewMode === 'channel' ? '渠道' : '模型')
          ])
        ]),

        // ── 方案 2：动态伴随渠道卡片 (浮动在右侧/左侧，动态 Y 轴跟随) ──
        activeCompanionItem && h('div', {
          key: 'companion-flyout',
          className: `dsh-sm-companion-flyout ${flyoutPos.flipLeft ? 'flip-left' : ''}`,
          style: {
          top: `${flyoutPos.top}px`,
          maxHeight: `${flyoutPos.maxHeight || 380}px`
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
                  h('span', { className: `dsh-sm-rate-tag ${p.rateCls}` }, formatCompactRate(p.multiplier)),
                  (() => {
                    const row = healthOf(uplinkHealth, p.providerId, p.modelId);
                    if (!row) return null;
                    if (row.subscription) {
                      return h('span', {
                        className: 'dsh-sm-health-chip dsh-sm-plan-chip',
                        title: row.reason
                      }, '会员');
                    }
                    if (row.level === 'ok') return null;
                    const meta = HEALTH_LEVELS[row.level] || HEALTH_LEVELS.unknown;
                    return h('span', {
                      className: `dsh-sm-health-chip ${meta.cls}`,
                      // 本机快照加一句可与操作对应的说明：上游可能已放行
                      title: row.snapshot === true
                        ? row.reason + '\n\n本机快照（非上游权威判定）：恢复时刻可能是本地推算。\n设置 → Smart Models → 上行自检 → 可「重置」或「探活」。'
                        : row.reason
                    }, meta.label);
                  })()
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
        ]),

        // 渠道视图的伴随卡：与主卡片同属 popover 容器，
        // 才能沿用 left: calc(100% + 6px) 的定位与翻转逻辑
        channelCompanion
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

    // ══════════════════════════════════════════════════════════════════════════
    // channel-pack RPC 访问层（模块级）
    //   从 CreditsHud 内部抽出：自检（uplink-health）也要用同一条链路。
    //   抽出时保持原有语义不变：超时用 AbortController、失败抛错、
    //   RemoteResult 的 ok:false 必须转成异常（DSH 的一元调用从不 reject）。
    // ══════════════════════════════════════════════════════════════════════════

    // ⚠️ 不要缓存 connection：composer 在启动瞬间挂载时，connection 服务可能
    // 尚未注册，缓存成 undefined 会永久失效。
    function resolveConnection(ctx) {
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
    }

    async function callChannelPack(ctx, method, payload, timeoutMs = 120_000) {
      const connection = resolveConnection(ctx);
      if (typeof connection?.rpc?.call !== 'function') {
        console.warn('[SmartModels] 无法取得 connection.rpc，ctx keys:',
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
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 渠道余额：模块级共享缓存与查询
    //   从 CreditsHud 的私有 useRef(Map) 提升而来：选择器的渠道视图也要读同一份
    //   缓存，否则「HUD 刚查过的渠道」在展开时会被重复查询一次。
    //   语义与提升前完全一致（60 秒 TTL，失败不入缓存）。
    // ══════════════════════════════════════════════════════════════════════════
    const creditsCache = new Map();

    /**
     * 结算一轮任务的积分消耗（纯函数，可独立测试）。
     *
     * ⚠️ 历史 bug（真实台账里有 9 条垃圾记录佐证）：
     *   旧实现只存余额数字，`before - after` 在两种情况下产生假消耗：
     *   1. 跨渠道：任务开始快照渠道 A（如 9000 分），中途切到渠道 B（1000 分），
     *      → 结算成 -8000 的假消耗。beforeRef 是 useRef，跨 effect 重挂载存活，
     *      providerId 变化不会清掉它。
     *   2. 账号集变化：total 是跨账号累加；结算时部分账号查询失败（known < accounts），
     *      total 骤降不是消耗 → 出现 15159.99 这类天文数字。
     *
     * 因此 before 必须是快照对象（含 provider/accounts），结算时逐项校验；
     * 任一校验不过 → 积分弃记（creditsKnown:false + suspect 原因），
     * 请求数照记——统计完整性优先于积分精确性。
     */
    // ── 免费层级判定 ────────────────────────────────────────────────────────
    // 「免费」≠「消耗 0 积分」：
    //   · 免费层级（免算力车道 / 配额型 / priceFactor=0）根本没有积分概念，
    //     记 0 会让人误以为「这轮没花钱」，实际是「这个渠道不按积分计费」。
    //   · 之前的实现把两者混为一谈，导致台账 84% 的事件显示 0（实测 199 条中 167 条）。
    //
    // 首版白名单；pricing 路由可用时再按 (provider, model) 精确判定。
    const FREE_TIER_PROVIDERS = new Set([
      'our-free-model',   // 免算力车道
      'gemini',           // 配额型（5h/周窗口，按 % 而非积分）
      'gemini-code-assist',
      'agy', 'agy-link', 'antigravity', // agy 配额型
    ]);

    // (provider|model) → { isFree, priceFactor }，由 /api/smart-models/pricing 填充
    let pricingCache = Object.create(null);
    let pricingLoadedAt = 0;
    const PRICING_TTL_MS = 5 * 60_000;

    function pricingOf(providerId, modelId) {
      const key = String(providerId || '') + '|' + String(modelId || '');
      return pricingCache[key] || null;
    }

    function isFreeTierChannel(providerId, modelId) {
      const pid = String(providerId || '').toLowerCase();
      if (FREE_TIER_PROVIDERS.has(pid)) return true;
      const meta = pricingOf(pid, modelId);
      if (!meta) return false;
      // isFree 显式为真，或倍率为 0（channel-pack 里 priceFactor:0 表示实测免费）
      return meta.isFree === true || meta.priceFactor === 0;
    }

    async function ensurePricing() {
      if (Date.now() - pricingLoadedAt < PRICING_TTL_MS) return;
      pricingLoadedAt = Date.now();
      try {
        const resp = await fetch('/api/smart-models/pricing', { cache: 'no-store' });
        if (!resp.ok) return;
        const data = await resp.json();
        if (data?.ok === true && data.pricing && typeof data.pricing === 'object') {
          pricingCache = data.pricing;
        }
      } catch (e) { /* 计价元数据拿不到不影响记账，退化为白名单判定 */ }
    }

    function settleRound(before, after, currentProviderId) {
      // 返回 { kind: 'measured', consumed } 或 { kind: 'suspect', reason } 或 null
      if (!before || !after) return null;
      if (!Number.isFinite(before.total) || !Number.isFinite(after.total)) return null;

      // 闸 1：快照渠道 ≠ 结算渠道 —— 两个数字来自不同渠道，不可比
      if (before.provider !== currentProviderId) {
        return { kind: 'suspect', reason: 'provider-switch' };
      }
      // 闸 2：账号集变化（结算时有账号查询失败，或参与求和的账号数变了）
      const beforeAccounts = Number.isFinite(before.accounts) ? before.accounts : -1;
      const afterAccounts = Number.isFinite(after.accounts) ? after.accounts : -1;
      if (beforeAccounts !== afterAccounts || (after.failed || 0) > 0) {
        return { kind: 'suspect', reason: 'account-change' };
      }
      // 闸 3：余额不降反升（签到/充值恰好发生）——不是消耗，记 0
      const consumed = before.total - after.total;
      if (!Number.isFinite(consumed)) return null;
      return { kind: 'measured', consumed: Math.max(0, consumed) };
    }

    // 渠道余额服务端缓存的 TTL：channel-pack 的 usage.badge 自带 120 秒缓存，
    // 客户端对齐它，避免「服务端已缓存、客户端却重复发请求」。
    const CHANNEL_BALANCE_TTL_MS = 120_000;

    // 查询单个渠道的余额摘要。
    //   · agy 走宿主只读路由 /api/smart-models/agy-quota
    //   · 其余优先走 usage.badge：它带服务端 120 秒缓存，重复进入视图几乎零成本，
    //     且返回结构与 credits.balances 一致（accounts[].balance），解析逻辑完全复用
    //   · usage.badge 不可用时（旧版渠道包）回落到 credits.balances
    // 成功返回 summary 并写入共享缓存；失败返回 null（调用方静默降级）。
    async function fetchChannelBalance(ctx, providerId) {
      const provider = String(providerId || '');
      if (!provider) return null;
      try {
        let summary;
        if (isAgyProvider(provider)) {
          const resp = await fetch('/api/smart-models/agy-quota', { cache: 'no-store' });
          if (!resp.ok) throw new Error('agy 额度接口 HTTP ' + resp.status);
          const data = await resp.json();
          if (data?.ok !== true) throw new Error(data?.error || 'agy 额度读取失败');
          summary = summarizeAgyQuota(data);
        } else {
          let value = null;
          try {
            value = await callChannelPack(ctx, 'usage.badge', { provider });
          } catch (badgeErr) {
            // 旧版渠道包没有 usage.badge：回落到 credits.balances，不让功能整体失效
            value = null;
          }
          if (value === null || value === undefined) {
            value = await callChannelPack(ctx, 'credits.balances', { provider });
          }
          summary = summarizeCreditsBalances(value);
        }
        creditsCache.set(provider, { summary, at: Date.now() });
        return summary;
      } catch (err) {
        const message = String(err?.message ?? err);
        // 上游明确说不支持该渠道：不是错误，只是该渠道没有积分概念
        if (/unsupported provider|not support/i.test(message)) {
          const unsupported = {
            total: 0, known: 0, failed: 0, unit: '', reason: message,
            accounts: 0, quotaMode: false, unsupported: true, windows: []
          };
          creditsCache.set(provider, { summary: unsupported, at: Date.now() });
          return unsupported;
        }
        return null;
      }
    }

    /**
     * 受控并发池：最多 limit 个任务同时在飞，其余排队。
     *
     * 渠道余额查询是串行逐账号的上游调用（单账号超时 30s），全量并发会制造
     * 突发请求并触发风控；全量串行又会让首屏等太久。并发 2 是这两者的平衡点，
     * 且每完成一个就回调一次，界面可以渐进填充而不是等全部结束。
     */
    async function runWithConcurrency(items, limit, worker) {
      const queue = items.slice();
      const size = Math.max(1, Math.min(limit, queue.length));
      const runners = [];
      for (let i = 0; i < size; i += 1) {
        runners.push((async () => {
          while (queue.length > 0) {
            const item = queue.shift();
            if (item === undefined) return;
            try {
              await worker(item);
            } catch (e) {
              // worker 内部已做降级，这里只兜底防止一个失败拖垮整池
            }
          }
        })());
      }
      await Promise.all(runners);
    }

    // 渠道标题右侧的余额短标签。两种语义严格区分：
    //   积分型 → 千分位整数 + 单位（如 1,360 分）
    //   配额型 → 最低剩余窗口百分比（如 62%），百分比不可跨账号相加
    /**
     * 余额单位统一。
     *
     * ⚠️ 服务端下发的 unit 有多个变体：'credit' / 'credits' / '积分' / 'token' / 'USD' / '%'。
     * 旧实现只判断 `=== 'credit'`，于是 'credits'（复数）漏过、被原样打印成
     * "9,674.47 credits"，与隔壁的 "1,840 分" 混排——这正是界面上单位不统一的根因。
     * 这里按语义归一：所有积分类变体 → '分'；token / % / 货币保持各自量纲。
     */
    function normalizeBalanceUnit(unit) {
      const u = String(unit || '').trim().toLowerCase();
      if (u === '') return '分';
      if (u === 'credit' || u === 'credits' || u === '积分' || u === 'points' || u === 'point') return '分';
      if (u === 'token' || u === 'tokens') return 'Token';
      if (u === '%' || u === 'percent') return '%';
      if (u === 'usd') return 'USD';
      // 未知单位原样保留，但不让它在列里显得突兀
      return String(unit).trim();
    }

    function formatChannelBalance(summary) {
      if (summary === 'loading') return '查询中…';
      if (!summary) return '';
      if (summary.unsupported) return '';
      if (summary.quotaMode) {
        if (!Number.isFinite(summary.worstQuota)) return '—';
        return Math.round(summary.worstQuota) + '%';
      }
      if (!Number.isFinite(summary.total)) return '—';
      if (summary.known === 0 && summary.failed > 0) return '—';
      const unit = normalizeBalanceUnit(summary.unit);
      const n = summary.total;
      const rounded = Math.round(n * 100) / 100;
      const text = Number.isInteger(rounded) ? String(rounded)
        : rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
      const [ip, dp] = text.split('.');
      const sep = ip.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      return (dp ? sep + '.' + dp : sep) + ' ' + unit;
    }

    // ── 上行自检 ──────────────────────────────────────────────────────────────
    // 数据来自宿主只读路由 /api/smart-models/uplink-health（零网络请求）。
    // 它回答「已经发生过什么」：模型级限制、失效表、请求台账、签到状态。
    // 「现在通不通」只能由用户显式点「主动探活」触发（会消耗一次上游额度）。

    const UPLINK_CACHE_TTL_MS = 5 * 60_000;

    async function fetchUplinkHealth(provider) {
      const qs = provider ? `?provider=${encodeURIComponent(provider)}` : '';
      const resp = await fetch(`/api/smart-models/uplink-health${qs}`, { cache: 'no-store' });
      if (!resp.ok) throw new Error(`自检接口 HTTP ${resp.status}`);
      const data = await resp.json();
      if (data?.ok !== true) throw new Error(data?.error || '自检读取失败');
      return data;
    }

    // 状态点颜色与文案
    const HEALTH_LEVELS = {
      ok: { cls: 'dsh-sm-health-ok', label: '正常' },
      degraded: { cls: 'dsh-sm-health-degraded', label: '受限' },
      blocked: { cls: 'dsh-sm-health-blocked', label: '不可用' },
      unknown: { cls: 'dsh-sm-health-unknown', label: '未知' },
    };

    function healthOf(health, providerId, modelId) {
      const row = health?.providers?.[providerId]?.models?.[modelId];
      if (!row) return null;
      return row;
    }

    // 跨渠道：某模型在任意渠道是否有限制/失效。选择器是「以模型为中心」的，
    // 因此状态点必须汇总该模型在所有渠道里的最坏结论 —— 只看默认渠道会漏掉
    // 「默认渠道正常但另一个渠道被封」这种情形。
    function healthForModel(health, item) {
      if (!health || !item?.providers) return null;
      let worst = null;
      const reasons = [];
      let subscription = null;
      for (const p of item.providers) {
        const row = healthOf(health, p.providerId, p.modelId);
        if (!row) continue;
        // 订阅墙（cline-pass 等）：即使等级是 ok 也要标记 —— 它不是「临时状态」，
        // 而是「这个渠道要开会员才能用」。把它漏掉，用户会以为选中就能跑。
        if (row.subscription) subscription = row.subscription;
        if (row.level === 'ok') {
          if (row.subscription) reasons.push(`${formatProviderName(p.providerId, p.providerName)}：${row.reason}`);
          continue;
        }
        reasons.push(`${formatProviderName(p.providerId, p.providerName)}：${row.reason}`);
        if (worst === null) worst = row.level;
        else if (row.level === 'blocked') worst = 'blocked';
        else if (row.level === 'degraded' && worst === 'unknown') worst = 'degraded';
      }
      if (worst === null && subscription === null) return null;
      // 只有订阅墙、没有任何限制时，用 unknown（灰点）而不是绿点：
      // 绿点表示「现在能用」，而订阅墙下它用不了。
      const level = worst === null ? 'unknown' : worst;
      return { level, reasons, subscription };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // HUD 组件
    // ══════════════════════════════════════════════════════════════════════════
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
      // 余额缓存已提升到模块级 creditsCache：选择器的渠道视图要读同一份缓存，
      // 否则 HUD 刚查过的渠道在展开时会被重复查询一次（串行逐账号，很贵）。
      const requestSeq = useRef(0);
      const currentModelIdRef = useRef('');

      const sessions = ctx?.sessions;

      // RPC 访问已抽到模块级 callChannelPack（自检复用同一条链路），
      // 这里只保留一个绑定 ctx 的薄包装，行为与抽取前完全一致。
      const callPack = useCallback(
        (method, payload, timeoutMs) => callChannelPack(ctx, method, payload, timeoutMs),
        [ctx],
      );

      const fetchBalance = useCallback(async (provider, force) => {
        if (!provider) return null;

        // 缓存已提升到模块级（与选择器的渠道视图共享），因此这里必须先确认
        // 「本次真的能查」再读缓存：否则 connection 服务掉线时，HUD 会把上一个
        // 实例留下的余额当成当前值显示出来 —— 那是陈旧数据的假象。
        // agy 渠道走宿主 HTTP 路由，不依赖 connection.rpc。
        const canQuery = isAgyProvider(provider)
          || typeof resolveConnection(ctx)?.rpc?.call === 'function';

        // 命中缓存（非强制刷新时）：避免每次切换模型都触发一次昂贵的串行查询
        if (force !== true && canQuery) {
          const cached = creditsCache.get(provider);
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
          creditsCache.set(provider, { summary, at: Date.now() });
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
            } else if (aborted && canQuery && creditsCache.has(provider)) {
              setError('');
            } else {
              setError(aborted ? '查询超时' : message);
              // canQuery 为假时（connection 不可用）必须清空快照：
              // 模块级缓存里可能有别的实例/渠道视图写入的旧值，不能拿来充数。
              if (!canQuery || !creditsCache.has(provider)) setSnapshot(null);
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

      // 计价元数据：挂载时拉一次，供免费层级判定使用（失败静默降级为白名单）
      useEffect(() => { void ensurePricing(); }, []);

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
        if (wasRunning && beforeRef.current === null && snapshot) {
          beforeRef.current = { total: snapshot.total, provider: providerId, accounts: snapshot.accounts, at: Date.now() };
        }

        const onState = () => {
          const nowRunning = readRunning();
          setRunning(prev => (prev === nowRunning ? prev : nowRunning));

          if (nowRunning && !wasRunning) {
            // 快照必须是对象：只存数字无法在结算时校验「渠道/账号集是否变了」
            beforeRef.current = snapshot
              ? { total: snapshot.total, provider: providerId, accounts: snapshot.accounts, at: Date.now() }
              : null;
            if (beforeRef.current === null) {
              void fetchBalance(providerId, false).then(sum => {
                if (sum && beforeRef.current === null) {
                  beforeRef.current = { total: sum.total, provider: providerId, accounts: sum.accounts, at: Date.now() };
                }
              });
            }
            setDelta(null);
            if (settleTimerRef.current) { clearTimeout(settleTimerRef.current); settleTimerRef.current = null; }
          } else if (!nowRunning && wasRunning) {
            const before = beforeRef.current;
            beforeRef.current = null;
            void fetchBalance(providerId, true).then(after => {
              if (!after || !before) return;

              // 三道闸（settleRound）：跨渠道 / 账号集变化 → 积分弃记
              const verdict = settleRound(before, after, providerId);

              const modelId = currentModelIdRef.current || '';
              // 免费层级判定：免费渠道没有积分概念，不能记成「消耗 0」
              const freeTier = isFreeTierChannel(providerId, modelId);

              if (freeTier) {
                // 免费层级：不显示 -X、不记积分，只记请求数
                setDelta(null);
                void recordUsage({
                  provider: providerId,
                  model: modelId,
                  credits: 0,
                  creditsKnown: false,   // 不是「测得 0」，而是「该渠道无积分概念」
                  freeTier: true,
                  requests: 1
                });
              } else if (verdict && verdict.kind === 'measured') {
                // 可信：HUD 显示 -X，台账记实测积分
                setDelta({ consumed: verdict.consumed, afterTotal: after.total, at: Date.now() });
                if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
                settleTimerRef.current = setTimeout(() => {
                  setDelta(null);
                  settleTimerRef.current = null;
                }, 8000);
                void recordUsage({
                  provider: providerId,
                  model: modelId,
                  credits: verdict.consumed,
                  creditsKnown: true,
                  freeTier: false,
                  // delta 保留带符号原始差值：负值代表余额增加（签到/充值），
                  // 现有 credits 只取正值，无法区分「消耗」与「增加」。
                  delta: (before && after) ? (after.total - before.total) : undefined,
                  requests: 1
                });
              } else {
                // 可疑或无数据：不显示 -X（旧版会在跨渠道时显示 -8000 这类假消耗），
                // 台账仍记请求数，积分标记为不可信 + 原因
                setDelta(null);
                void recordUsage({
                  provider: providerId,
                  model: modelId,
                  credits: 0,
                  creditsKnown: false,
                  freeTier: false,
                  requests: 1,
                  suspect: verdict ? verdict.reason : undefined
                });
              }
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

      // 渠道切换时清掉旧快照并立即对新渠道重新快照：
      // 不清的话，旧渠道的余额（useRef 跨重挂载存活）会被拿去和新渠道相减。
      useEffect(() => {
        beforeRef.current = null;
        if (providerId) {
          void fetchBalance(providerId, false).then(sum => {
            // 仅当仍在同一渠道且没有更新的快照时才写入
            if (sum) beforeRef.current = { total: sum.total, provider: providerId, accounts: sum.accounts, at: Date.now() };
          });
        }
      }, [providerId]); // 故意不含 fetchBalance：换渠道时只想要这一次重新快照

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
          // freeTier 计数用于区分「免费层级（无积分概念）」与「测不到积分」
          row = { key, requests: 0, credits: 0, creditsKnown: 0, tokens: 0, freeTier: 0 };
          map.set(key, row);
        }
        row.requests += Number.isFinite(e.requests) ? e.requests : 1;
        if (e.freeTier === true) row.freeTier += 1;
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

      // ── 每日积分柱状图数据：只计可信记录（可疑记录本来就不是真实消耗）──
      const chartDays = useMemo(() => {
        const byKey = new Map();
        for (const e of filtered) {
          if (!e || e.creditsKnown !== true) continue;
          if (!Number.isFinite(e.credits) || e.credits <= 0) continue;
          const key = formatDayKey(e.at);
          const row = byKey.get(key) || { key, credits: 0, requests: 0 };
          row.credits += e.credits;
          row.requests += Number.isFinite(e.requests) ? e.requests : 1;
          byKey.set(key, row);
        }
        // 按日期升序（图从左到右是时间流逝）
        return Array.from(byKey.values()).sort((a, b) => (a.key < b.key ? -1 : 1));
      }, [filtered]);

      // ── 明细日志（最近优先；默认 50 条，可展开）──
      const [showAllDetail, setShowAllDetail] = useState(false);
      const [cleaning, setCleaning] = useState(false);
      const [cleanResult, setCleanResult] = useState(null);
      const detailRows = useMemo(() => {
        if (!Array.isArray(filtered)) return [];
        // 最近优先；每行预计算展示字段
        return filtered.slice().sort((a, b) => (b.at || 0) - (a.at || 0));
      }, [filtered]);
      const detailShown = showAllDetail ? detailRows : detailRows.slice(0, 50);

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
              // 积分是「估算」：上游只给余额快照，不给单轮扣费。角标常驻提醒。
              h('th', {
                key: 'c',
                style: { ...headCell, textAlign: 'right' },
                title: '估算值：由余额差值推算，非上游实际扣费。免费层级不计积分。'
              }, '积分(估)'),
              h('th', { key: 'e', style: { ...headCell, textAlign: 'right' } }, '换算≈token')
            ])),
            h('tbody', { key: 'tbody' }, rows.map((r, i) => {
              const est = estimateTokens(r.credits, totals.credits, totals.tokens);
              return h('tr', { key: i }, [
                h('td', { key: 'n', style: cell }, tbl.labelOf(r)),
                h('td', { key: 'r', style: numCell }, String(r.requests)),
                h('td', { key: 'k', style: numCell }, compactNumber(r.tokens)),
                h('td', { key: 'c', style: numCell }, r.freeTier > 0 && r.creditsKnown === 0
                  ? '免费'
                  : (r.creditsKnown > 0 ? compactNumber(r.credits) : '—')),
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
        h('div', { key: 'title-row', style: { display: 'flex', alignItems: 'center', gap: '10px', margin: '0 0 4px' } }, [
          h('h2', { key: 'title', style: { margin: 0, fontSize: '15px' } }, '用量统计'),
          h('button', {
            key: 'dashboard',
            type: 'button',
            title: '在浏览器中打开完整看板：全量明细、按天/渠道/模型下钻、筛选与搜索',
            onClick: () => {
              // ── 为什么这里要「相对 fetch + 绝对 open」两套地址 ──────────────────
              //
              // DSH 桌面壳的渲染进程跑在 dsh-app://app/ 上，它有两套网络语义：
              //
              // 1) fetch 相对路径 '/xxx' → 命中 protocol.handle("dsh-app")：
              //      凡是 dsh-app://app/<任意路径> 都由主进程 forwardWebRequest
              //      转发到真实服务端，并自动注入认证 cookie。
              //      → 所以相对路径可用，且**绝对 http URL 会被 CORS 拦死**
              //        （Access to fetch at 'http://127.0.0.1:xxx/...' from origin
              //         'dsh-app://app' has been blocked by CORS policy）。
              //
              // 2) window.open(url) → 主窗口 setWindowOpenHandler：
              //      只有 http:/https: 协议才 shell.openExternal(url)，
              //      其余一律 action:"deny"。
              //      → 所以 window.open 必须给**绝对 http URL**；
              //        给相对路径时 new URL() 抛 Invalid URL，静默失败。
              //
              // 结论：探活用相对路径（走代理），打开用真实 http 地址。
              try {
                if (typeof window === 'undefined' || typeof window.open !== 'function') return;

                // 真实服务地址：优先取主进程注入的 transport，其次 location（纯浏览器场景）
                const transport = (typeof globalThis !== 'undefined' && globalThis.__DSH_TRANSPORT__) || null;
                const origin = (transport && typeof transport.streamBaseUrl === 'string' && transport.streamBaseUrl)
                  || (window.location && /^https?:$/.test(window.location.protocol) ? window.location.origin : '')
                  || '';

                const openDashboard = (absoluteUrl) => {
                  const win = window.open(absoluteUrl, '_blank', 'noopener,noreferrer');
                  // 桌面壳走 shell.openExternal 时恒返回 null（action:"deny"），属预期
                  if (!win && !origin) {
                    if (typeof window.alert === 'function') {
                      window.alert('浏览器拦截了新窗口。\n\n请手动访问：' + absoluteUrl);
                    }
                  }
                };

                // 探活：相对路径（走 dsh-app 代理，带 cookie，不受 CORS 影响）
                fetch('/smart-models', { method: 'GET', cache: 'no-store' })
                  .then(res => {
                    if (!res.ok) {
                      const msg = '看板路由不可用（HTTP ' + res.status + '）。\n\n'
                        + '宿主端插件代码（index.js）不支持热重载，'
                        + '请【完整重启 DeepSeek Harness】（不是 Ctrl+R）后再试。';
                      if (typeof window.alert === 'function') window.alert(msg);
                      else console.warn('[SmartModels] ' + msg);
                      return;
                    }
                    // 路由正常：用真实 http 地址打开（window.open 只认 http/https）
                    if (origin) {
                      openDashboard(origin.replace(/\/$/, '') + '/smart-models');
                    } else {
                      // 拿不到 http origin（极少见）：退化为让用户手输
                      const msg = '看板可用，但无法确定外部访问地址。\n\n'
                        + '请在浏览器手动访问：http://127.0.0.1:<DSH端口>/smart-models';
                      if (typeof window.alert === 'function') window.alert(msg);
                      else console.warn('[SmartModels] ' + msg);
                    }
                  })
                  .catch(err => {
                    const msg = '看板探测失败：' + String(err && err.message ? err.message : err)
                      + '\n\n请确认 DeepSeek Harness 正在运行，并已完整重启。';
                    if (typeof window.alert === 'function') window.alert(msg);
                    else console.warn('[SmartModels] ' + msg);
                  });
              } catch (e) { /* 打开失败不影响设置页 */ }
            },
            style: {
              marginLeft: 'auto', padding: '3px 10px', fontSize: '11.5px', cursor: 'pointer',
              border: '1px solid rgba(56,189,248,0.45)', borderRadius: '5px',
              background: 'rgba(56,189,248,0.12)', color: '#7dd3fc', whiteSpace: 'nowrap'
            }
          }, '打开完整看板 ↗')
        ]),
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

        // ── 每日积分消耗柱状图（纯 SVG）──
        events !== null && events.length > 0 && (chartDays.length === 0
          ? h('div', { key: 'chart-empty', className: 'dsh-sm-usage-chart-empty' },
              '当前范围内没有可信的积分消耗（可疑记录不计入图表）')
          : (() => {
              const W = Math.max(280, chartDays.length * 34);
              const H = 120, PAD_L = 8, PAD_B = 18, PAD_T = 6;
              const max = Math.max(...chartDays.map(d => d.credits));
              const plotH = H - PAD_T - PAD_B;
              const bw = Math.max(6, Math.min(24, Math.floor((W - PAD_L * 2) / chartDays.length) - 6));
              const step = (W - PAD_L * 2) / chartDays.length;
              return h('svg', { key: 'chart', className: 'dsh-sm-usage-chart', viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'xMinYMin meet' },
                chartDays.map((d, i) => {
                  const bh = Math.max(2, Math.round(plotH * (d.credits / max)));
                  const x = PAD_L + i * step + (step - bw) / 2;
                  const y = PAD_T + plotH - bh;
                  const label = chartDays.length <= 14 || i % Math.ceil(chartDays.length / 14) === 0;
                  return h('g', { key: d.key }, [
                    h('rect', {
                      className: 'dsh-sm-usage-bar' + (i === chartDays.length - 1 ? ' is-today' : ''),
                      x: String(x), y: String(y), width: String(bw), height: String(bh), rx: '2'
                    }),
                    // <title> 子元素：悬停提示（日期 · 积分 · 请求数）
                    h('title', { key: 't' }, d.key + ' · ' + compactNumber(d.credits) + ' 积分 · ' + d.requests + ' 次'),
                    label ? h('text', {
                      key: 'l', className: 'dsh-sm-usage-axis-label',
                      x: String(x + bw / 2), y: String(H - 5), textAnchor: 'middle'
                    }, d.key.slice(5)) : null
                  ]);
                }).concat([
                  // 基线
                  h('line', { key: 'axis', className: 'dsh-sm-usage-axis', x1: '0', y1: String(PAD_T + plotH), x2: String(W), y2: String(PAD_T + plotH) }),
                  // 峰值标注
                  h('text', { key: 'max', className: 'dsh-sm-usage-axis-label', x: String(W), y: String(PAD_T + 4), textAnchor: 'end' }, compactNumber(max))
                ])
              );
            })()),

        // ── 明细日志 + 清理按钮 ──
        events !== null && events.length > 0 && h('div', { key: 'detail', style: { marginBottom: '8px' } }, [
          h('button', {
            key: 'h',
            type: 'button',
            onClick: () => setOpenTable(openTable === 'detail' ? null : 'detail'),
            style: {
              width: '100%', display: 'flex', alignItems: 'center', gap: '6px',
              padding: '8px 10px', background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px',
              color: 'inherit', cursor: 'pointer', fontSize: '12.5px', fontWeight: 600
            }
          }, [
            h('span', { key: 'a', style: { opacity: 0.6, fontSize: '10px' } }, openTable === 'detail' ? '▼' : '▶'),
            h('span', { key: 't' }, '明细日志'),
            h('span', { key: 'c', style: { opacity: 0.5, fontWeight: 400, marginLeft: 'auto' } },
              detailRows.length + ' 条'),
            h('button', {
              key: 'clean',
              type: 'button',
              disabled: cleaning,
              title: '把历史可疑记录（单轮 >1000 积分或带可疑标记）改写为不可信；执行前自动备份台账',
              onClick: (e) => {
                e.stopPropagation();
                const doClean = () => {
                  if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm('将把历史可疑记录标记为不可信（积分清零、保留请求数）。执行前会自动备份台账。继续？')) return;
                setCleaning(true);
                setCleanResult(null);
                fetch('/api/smart-models/usage/clean', { method: 'POST' })
                  .then(r => r.json())
                  .then(d => {
                    setCleanResult(d?.ok === true ? '已清理 ' + d.cleaned + ' 条' : '清理失败：' + (d?.error || '未知错误'));
                    if (d?.ok === true) {
                      // 重新拉取台账
                      fetch('/api/smart-models/usage', { cache: 'no-store' })
                        .then(r => r.json())
                        .then(data => {
                          if (data?.ok === true) setEvents(Array.isArray(data.events) ? data.events : []);
                        })
                        .catch(() => {});
                    }
                  })
                  .catch(err => setCleanResult('清理失败：' + String(err?.message ?? err)))
                  .finally(() => setCleaning(false));
                };
                doClean();
              },
              style: {
                marginLeft: '8px', padding: '2px 8px', fontSize: '10.5px', cursor: 'pointer',
                border: '1px solid rgba(255,255,255,0.12)', borderRadius: '4px',
                background: 'transparent', color: 'inherit', opacity: cleaning ? 0.4 : 0.75
              }
            }, cleaning ? '清理中…' : '清理历史可疑记录')
          ]),
          cleanResult && h('p', { key: 'cr', style: { margin: '4px 10px', fontSize: '11px', opacity: 0.6 } }, cleanResult),
          openTable === 'detail' && detailRows.length > 0 && h('table', { key: 't', className: 'dsh-sm-usage-detail' }, [
            h('thead', { key: 'th' }, h('tr', null, [
              h('th', { key: 'time' }, '时间'),
              h('th', { key: 'prov' }, '渠道'),
              h('th', { key: 'model' }, '模型'),
              h('th', { key: 'cred', className: 'num' }, '积分'),
              h('th', { key: 'mark' }, '标记')
            ])),
            h('tbody', { key: 'tb' }, detailShown.map((e, i) => {
              const suspect = e.suspect === 'provider-switch' ? '渠道切换'
                : e.suspect === 'account-change' ? '账号变化'
                : e.cleaned === true ? '已清理'
                : e.creditsKnown === false ? '不可信' : '';
              const d = new Date(e.at || 0);
              const hh = String(d.getHours()).padStart(2, '0');
              const mm = String(d.getMinutes()).padStart(2, '0');
              const ss = String(d.getSeconds()).padStart(2, '0');
              const dateStr = (d.getMonth() + 1) + '/' + d.getDate();
              return h('tr', { key: i, className: suspect ? 'is-suspect' : '' }, [
                h('td', { key: 't', title: dateStr + ' ' + hh + ':' + mm + ':' + ss }, hh + ':' + mm + ':' + ss),
                h('td', { key: 'p', title: e.provider || '' }, formatProviderName(e.provider || '', e.provider || '') || e.provider || '—'),
                h('td', { key: 'm', title: e.model || '' }, e.model || '—'),
                h('td', { key: 'c', className: 'num' }, e.creditsKnown === true && Number.isFinite(e.credits)
                  ? compactNumber(e.credits) : '—'),
                h('td', { key: 'mk', className: 'suspect' }, suspect)
              ]);
            })),
          ]),
          openTable === 'detail' && detailRows.length > 50 && h('button', {
            key: 'more',
            type: 'button',
            onClick: () => setShowAllDetail(v => !v),
            style: {
              display: 'block', width: '100%', padding: '6px', marginTop: '4px',
              fontSize: '11.5px', cursor: 'pointer', color: 'inherit', opacity: 0.6,
              border: 'none', background: 'transparent'
            }
          }, showAllDetail ? '收起（只看最近 50 条）' : '展开全部 ' + detailRows.length + ' 条'),
          openTable === 'detail' && detailRows.length === 0 && h('p', {
            key: 'empty', style: { margin: '6px 10px', fontSize: '12px', opacity: 0.5 }
          }, '该时间范围内暂无数据')
        ]),

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

    // ══════════════════════════════════════════════════════════════════════════
    // 设置页「上行自检」
    //   · 数据：宿主只读路由 /api/smart-models/uplink-health（零网络）
    //   · 主动探活：显式点击才发真实请求，会消耗一次上游额度
    // ══════════════════════════════════════════════════════════════════════════

    function UplinkHealthPage(props) {
      const ctx = props.ctx || rootCtx;
      const [data, setData] = useState(null);
      const [error, setError] = useState('');
      const [loading, setLoading] = useState(false);
      const [tick, setTick] = useState(0);
      // 主动探活状态：{ provider, modelId, running, results: [{accountId, ok, message}] }
      const [probe, setProbe] = useState(null);
      const abortRef = useRef(null);

      const load = useCallback(async () => {
        setLoading(true);
        try {
          const next = await fetchUplinkHealth('');
          setData(next);
          setError('');
        } catch (e) {
          setError(String(e?.message ?? e));
        } finally {
          setLoading(false);
        }
      }, []);

      useEffect(() => { void load(); }, [load]);

      // 倒计时每秒重算：重置时刻是绝对时间，界面必须跟着走，否则「16 小时」
      // 会一直停在加载那一刻。
      useEffect(() => {
        const timer = setInterval(() => setTick(t => t + 1), 1000);
        return () => clearInterval(timer);
      }, []);

      useEffect(() => () => {
        if (abortRef.current) abortRef.current.abort();
      }, []);

      const now = Date.now();
      const providers = data?.providers && typeof data.providers === 'object' ? data.providers : {};

      // 汇总三张卡
      const totals = useMemo(() => {
        let accounts = 0, enabled = 0, blockedPairs = 0, deadModels = 0, disabledModels = 0;
        let requests = 0, errors = 0;
        for (const row of Object.values(providers)) {
          accounts += row.accounts || 0;
          enabled += row.enabledAccounts || 0;
          blockedPairs += row.blockedPairs || 0;
          deadModels += row.deadModels || 0;
          disabledModels += row.disabledModels || 0;
          requests += row.requests || 0;
          errors += row.errors || 0;
        }
        return { accounts, enabled, blockedPairs, deadModels, disabledModels, requests, errors };
      }, [providers]);

      // 明细行：只列「有非 ok 结论」的模型，避免把整张模型表搬过来
      const detailRows = useMemo(() => {
        const rows = [];
        for (const [provider, providerRow] of Object.entries(providers)) {
          for (const [modelId, modelRow] of Object.entries(providerRow.models || {})) {
            // 订阅墙模型即使当前「没出错」也要列出来 —— 它注定不能直接调用。
            if (modelRow.level === 'ok' && !modelRow.subscription) continue;
            rows.push({ provider, modelId, ...modelRow });
          }
        }
        // 严重度优先：blocked > degraded > unknown
        const rank = { blocked: 0, degraded: 1, unknown: 2, ok: 3 };
        rows.sort((a, b) => (rank[a.level] ?? 9) - (rank[b.level] ?? 9));
        return rows;
      }, [providers, tick]); // tick 让它跟着倒计时重算

      const startProbe = useCallback(async (provider, modelId) => {
        if (probe?.running) return;
        const controller = new AbortController();
        abortRef.current = controller;
        setProbe({ provider, modelId, running: true, results: [], error: '' });
        try {
          const listed = await callChannelPack(ctx, 'account.list', { provider }, 30_000);
          const accounts = Array.isArray(listed?.accounts) ? listed.accounts : [];
          if (accounts.length === 0) {
            setProbe(p => ({ ...p, running: false, error: '该渠道没有账号' }));
            return;
          }
          const results = [];
          // ⚠ 串行：account.test 会真实发一次对话请求，并发既会触发风控，
          // 也会让「一次探活消耗几次额度」变得不可解释。串行时消耗次数 == 账号数。
          for (const account of accounts) {
            if (controller.signal.aborted) break;
            setProbe(p => ({ ...p, results: [...results] }));
            try {
              const outcome = await callChannelPack(ctx, 'account.test', {
                accountId: account.id,
                modelId,
              }, 150_000);
              results.push({
                accountId: account.id,
                nickname: account.nickname || account.id,
                ok: outcome?.ok === true,
                message: outcome?.message || (outcome?.ok === true ? '' : '未返回原因'),
              });
            } catch (e) {
              results.push({
                accountId: account.id,
                nickname: account.nickname || account.id,
                ok: false,
                message: String(e?.message ?? e),
              });
            }
          }
          setProbe({ provider, modelId, running: false, results, error: '' });
        } catch (e) {
          setProbe(p => ({ ...p, running: false, error: String(e?.message ?? e) }));
        } finally {
          abortRef.current = null;
        }
      }, [ctx, probe]);

      const stopProbe = useCallback(() => {
        if (abortRef.current) abortRef.current.abort();
        setProbe(p => (p ? { ...p, running: false, stopped: true } : p));
      }, []);

      // 重置限流标记（纯本地，不发网络请求 —— account.reset 只清 modelRateLimits）
      const resetLimits = useCallback(async (provider) => {
        if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
          if (!window.confirm(`清除 ${provider} 全部账号的限流标记？\n\n这只清本机记录，不会改变上游的真实限制。`)) return;
        }
        try {
          await callChannelPack(ctx, 'account.resetAll', { provider }, 30_000);
          await load();
        } catch (e) {
          setError(String(e?.message ?? e));
        }
      }, [ctx, load]);

      const header = h('div', { key: 'h', style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' } }, [
        h('h3', { key: 't', style: { margin: 0, fontSize: '14px' } }, '上行自检'),
        h('button', {
          key: 'r', type: 'button', className: 'dsh-sm-uh-btn',
          disabled: loading, onClick: () => { void load(); }
        }, loading ? '读取中…' : '刷新'),
        data?.checkedAt ? h('span', { key: 'ts', className: 'dsh-sm-uh-muted', style: { fontSize: '11px' } },
          `采样于 ${formatShortDateLocal(data.checkedAt)}`) : null
      ]);

      if (error !== '') {
        return h('div', null, [header, h('p', { key: 'e', style: { fontSize: '12px', color: '#f87171' } }, `读取失败：${error}`)]);
      }
      if (data === null) {
        return h('div', null, [header, h('p', { key: 'l', style: { fontSize: '12px', opacity: 0.5 } }, '加载中…')]);
      }

      const cards = h('div', { key: 'cards', style: { display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '14px' } }, [
        h('div', { key: 'limit', className: 'dsh-sm-uh-card' }, [
          h('div', { className: 'dsh-sm-uh-card-title' }, '模型级限制'),
          h('div', { className: `dsh-sm-uh-card-value ${totals.blockedPairs > 0 ? 'dsh-sm-uh-warn' : ''}` },
            totals.blockedPairs > 0 ? `${totals.blockedPairs} 个（账号×模型）受限` : '无'),
          h('div', { className: 'dsh-sm-uh-card-note' },
            '来自渠道包已落盘的限流标记。这类失败与额度无关：同一账号换一个模型通常就能用。')
        ]),
        h('div', { key: 'lane', className: 'dsh-sm-uh-card' }, [
          h('div', { className: 'dsh-sm-uh-card-title' }, '渠道与账号'),
          h('div', { className: 'dsh-sm-uh-card-value' },
            `${Object.keys(providers).length} 渠道 / ${totals.enabled} 个启用账号`),
          h('div', { className: 'dsh-sm-uh-card-note' },
            totals.deadModels > 0 ? `${totals.deadModels} 个模型已被判定失效` : '没有已判定失效的模型')
        ]),
        h('div', { key: 'obs', className: 'dsh-sm-uh-card' }, [
          h('div', { className: 'dsh-sm-uh-card-title' }, '观测到的请求'),
          h('div', { className: 'dsh-sm-uh-card-value' },
            totals.requests > 0 ? `${totals.requests} 次 / ${totals.errors} 错` : '—'),
          h('div', { className: 'dsh-sm-uh-card-note' },
            totals.requests > 0 ? `失败率 ${Math.round((totals.errors / totals.requests) * 100)}%` : '暂无台账记录')
        ]),
      ]);

      const providerTable = h('div', { key: 'pt', style: { marginBottom: '16px' } }, [
        h('div', { key: 'title', style: { fontSize: '12px', fontWeight: 600, marginBottom: '6px' } }, '按渠道'),
        h('table', { className: 'dsh-sm-uh-table' }, [
          h('thead', { key: 'th' }, h('tr', null, [
            h('th', { key: 'p' }, '渠道'),
            h('th', { key: 'a' }, '账号'),
            h('th', { key: 'm' }, '模型'),
            h('th', { key: 'l' }, '受限对'),
            h('th', { key: 'r' }, '请求'),
            h('th', { key: 'e' }, '失败率'),
            h('th', { key: 'd' }, '失效'),
            h('th', { key: 'x' }, ''),
          ])),
          h('tbody', { key: 'tb' }, Object.entries(providers).map(([provider, row]) => h('tr', { key: provider }, [
            h('td', { key: 'p' }, provider),
            h('td', { key: 'a' }, `${row.enabledAccounts}/${row.accounts}`),
            h('td', { key: 'm' }, String(row.modelCount)),
            h('td', { key: 'l', className: row.blockedPairs > 0 ? 'dsh-sm-uh-warn' : 'dsh-sm-uh-muted' }, String(row.blockedPairs)),
            h('td', { key: 'r' }, row.requests > 0 ? String(row.requests) : '—'),
            h('td', { key: 'e', className: row.errorRate !== null && row.errorRate >= 0.5 ? 'dsh-sm-uh-bad' : '' },
              row.errorRate === null ? '—' : `${Math.round(row.errorRate * 100)}%`),
            h('td', { key: 'd', className: row.deadModels > 0 ? 'dsh-sm-uh-bad' : 'dsh-sm-uh-muted' }, String(row.deadModels)),
            h('td', { key: 'x' }, row.blockedPairs > 0
              ? h('button', {
                  type: 'button', className: 'dsh-sm-uh-btn',
                  title: '清除本机限流标记（不发网络请求，不改变上游真实限制）',
                  onClick: () => { void resetLimits(provider); }
                }, '重置限流')
              : null),
          ]))),
        ]),
      ]);

      const detailTable = h('div', { key: 'dt', style: { marginBottom: '16px' } }, [
        h('div', { key: 'title', style: { fontSize: '12px', fontWeight: 600, marginBottom: '6px' } },
          `需要留意的模型（${detailRows.length}）`),
        detailRows.length === 0
          ? h('p', { key: 'none', style: { fontSize: '12px', opacity: 0.6 } }, '没有发现受限或失效的模型。')
          : h('table', { className: 'dsh-sm-uh-table' }, [
              h('thead', { key: 'th' }, h('tr', null, [
                h('th', { key: 'p' }, '渠道'),
                h('th', { key: 'm' }, '模型'),
                h('th', { key: 's' }, '状态'),
                h('th', { key: 'r' }, '原因'),
                h('th', { key: 'a' }, ''),
              ])),
              h('tbody', { key: 'tb' }, detailRows.map((row, i) => {
                const meta = HEALTH_LEVELS[row.level] || HEALTH_LEVELS.unknown;
                // 倒计时每秒重算（依赖 tick）
                const resetIn = Number.isFinite(row.earliestResetAt) ? row.earliestResetAt - now : null;
                const reason = row.subscription
                  ? row.reason
                  : row.level === 'blocked' && row.allBlocked && resetIn !== null
                    ? `全部启用账号均受限 · 最早 ${formatCountdownLocal(resetIn)}后恢复`
                    : row.level === 'degraded' && row.blockedAccounts > 0 && resetIn !== null
                      ? `${row.blockedAccounts}/${row.enabledAccounts} 个账号受限 · 最早 ${formatCountdownLocal(resetIn)}后恢复`
                      : row.reason;
                // 结论来源：限流标记是本机快照（恢复时刻可能由本地推算），
                // 失效表是上游权威判定。两者处置不同，界面必须分开说。
                const isSnapshot = row.snapshot === true;
                return h('tr', { key: `${row.provider}-${row.modelId}-${i}` }, [
                  h('td', { key: 'p' }, row.provider),
                  h('td', { key: 'm', title: row.modelId }, row.modelId),
                  h('td', { key: 's' }, row.subscription
                    ? h('span', { className: 'dsh-sm-health-chip dsh-sm-plan-chip' }, '会员')
                    : h('span', { className: `dsh-sm-health-chip ${meta.cls}` }, meta.label)),
                  h('td', { key: 'r', className: 'dsh-sm-uh-muted' }, [
                    reason || '—',
                    isSnapshot ? h('span', {
                      key: 'snap',
                      className: 'dsh-sm-uh-snapshot',
                      title: '来自本机限流标记：恢复时刻可能是本地推算的（CodeArts 等按「次日零点」估算），'
                        + '上游常在推算时刻之前就放行。点「重置」清掉本机标记后即可再试，'
                        + '点「探活」可真实验证是否已放行。'
                    }, '本机快照') : null
                  ]),
                  h('td', { key: 'a' }, [
                    isSnapshot ? h('button', {
                      key: 'rst',
                      type: 'button',
                      className: 'dsh-sm-uh-btn',
                      title: '清除本机限流标记（不发网络请求、不改变上游真实限制）—— 用于「服务端已放行、本机还记着旧时间」',
                      onClick: () => { void resetLimits(row.provider); }
                    }, '重置') : null,
                    h('button', {
                      key: 'probe',
                      type: 'button',
                      className: 'dsh-sm-uh-btn',
                      style: { marginLeft: '6px' },
                      disabled: probe?.running === true,
                      title: '向该渠道的每个账号真实发一次最小请求 —— 会消耗上游额度',
                      onClick: () => { void startProbe(row.provider, row.modelId); }
                    }, '探活')
                  ]),
                ]);
              })),
            ]),
      ]);

      const probePanel = probe === null ? null : h('div', {
        key: 'probe',
        style: { padding: '10px 12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }
      }, [
        h('div', { key: 'h', style: { fontSize: '12px', fontWeight: 600, marginBottom: '6px' } },
          `主动探活：${probe.provider} / ${probe.modelId}${probe.running ? '（进行中…）' : probe.stopped ? '（已中止）' : '（完成）'}`),
        h('p', { key: 'w', style: { fontSize: '11px', color: '#fbbf24', margin: '0 0 8px' } },
          '已真实向上游发送请求，每个账号消耗一次额度。串行执行，结果不写入任何文件。'),
        probe.error ? h('p', { key: 'e', style: { fontSize: '12px', color: '#f87171' } }, probe.error) : null,
        probe.results.length === 0
          ? h('p', { key: 'none', style: { fontSize: '12px', opacity: 0.5 } }, '尚无结果')
          : h('table', { className: 'dsh-sm-uh-table' }, [
              h('thead', { key: 'th' }, h('tr', null, [
                h('th', { key: 'a' }, '账号'),
                h('th', { key: 'r' }, '结果'),
                h('th', { key: 'm' }, '原因'),
              ])),
              h('tbody', { key: 'tb' }, probe.results.map((r, i) => h('tr', { key: `${r.accountId}-${i}` }, [
                h('td', { key: 'a' }, r.nickname || r.accountId),
                h('td', { key: 'r', className: r.ok ? '' : 'dsh-sm-uh-bad' }, r.ok ? '通过' : '失败'),
                h('td', { key: 'm', className: 'dsh-sm-uh-muted' }, r.message || '—'),
              ]))),
            ]),
        probe.running
          ? h('button', { key: 'stop', type: 'button', className: 'dsh-sm-uh-btn danger', style: { marginTop: '8px' }, onClick: stopProbe }, '中止')
          : h('button', { key: 'close', type: 'button', className: 'dsh-sm-uh-btn', style: { marginTop: '8px' }, onClick: () => setProbe(null) }, '关闭'),
      ]);

      return h('div', null, [
        header,
        cards,
        providerTable,
        detailTable,
        probePanel,
        h('p', { key: 'note', style: { marginTop: '10px', fontSize: '11px', opacity: 0.45, lineHeight: 1.7 } }, [
          '「模型级限制」来自渠道包已落盘的限流标记（按 账号×模型 记录），与额度无关：',
          '同一个账号换一个模型通常就能用，换渠道/换账号也能绕开。',
          h('br', { key: 'br' }),
          '带「本机快照」标记的行，其恢复时刻可能是本地推算的（如 CodeArts 按「次日 UTC+8 零点」估算），',
          '不是上游给的权威时刻 —— 上游常在推算时刻之前就放行，此时界面仍会显示受限。',
          h('br', { key: 'br' }),
          '「重置」/「重置限流」只清本机标记，不会改变上游的真实限制 —— 用于「服务端已放行、本机还记着旧时间」。',
          h('br', { key: 'br' }),
          '「探活」是唯一会消耗额度的动作，且只有点它才会发请求。'
        ])
      ]);
    }

    /** 本地时间戳 → `MM-DD HH:mm`（设置页用，与自检模块的 ISO 版本分开）。 */
    function formatShortDateLocal(ms) {
      const d = new Date(ms);
      if (!Number.isFinite(d.getTime())) return '';
      const pad = n => String(n).padStart(2, '0');
      return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    /** 毫秒 → 倒计时（设置页用；与 src/uplink-health.js 的版本同语义）。 */
    function formatCountdownLocal(ms) {
      if (!Number.isFinite(ms)) return '';
      if (ms <= 0) return '已过期';
      const minutes = Math.floor(ms / 60_000);
      if (minutes < 1) return '不到 1 分钟';
      if (minutes < 60) return `${minutes} 分钟`;
      const hours = Math.floor(minutes / 60);
      const rest = minutes % 60;
      if (hours < 24) return rest === 0 ? `${hours} 小时` : `${hours} 小时 ${rest} 分`;
      const days = Math.floor(hours / 24);
      const restHours = hours % 24;
      return restHours === 0 ? `${days} 天` : `${days} 天 ${restHours} 小时`;
    }

    // 自检页独立错误边界：异常不影响设置页其他分区
    class UplinkHealthErrorBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { hasError: false };
      }
      static getDerivedStateFromError() {
        return { hasError: true };
      }
      componentDidCatch(err) {
        console.warn('[SmartModels] UplinkHealthPage 已捕获异常:', err);
      }
      render() {
        if (this.state.hasError) return h('p', { style: { fontSize: '12px', opacity: 0.6 } }, '上行自检加载失败');
        return this.props.children;
      }
    }

    function SafeUplinkHealthPage(props) {
      return h(UplinkHealthErrorBoundary, null, h(UplinkHealthPage, props));
    }


    // ══════════════════════════════════════════════════════════════════════════
    // 设置页「渠道排序」
    //   默认顺序由内置优先序推导（大厂 → 第三方 → 免费池垫底）；
    //   这里允许用 ↑/↓ 覆盖它，结果同时写 localStorage 与磁盘偏好。
    // ══════════════════════════════════════════════════════════════════════════

    function ChannelOrderPage(props) {
      const ctx = props.ctx || rootCtx;
      const [providers, setProviders] = useState(null);   // [{ id, name, count }]
      const [order, setOrder] = useState(() => loadChannelOrder());
      const [error, setError] = useState('');

      // 渠道清单来自模型目录；目录拿不到时退化为「只有自定义顺序里出现过的渠道」
      useEffect(() => {
        let cancelled = false;
        (async () => {
          try {
            const resp = await ctx?.remote?.session?.modelCatalog?.();
            const catalog = resp?.ok ? resp.value : null;
            const list = [];
            const seen = new Set();
            for (const g of (catalog?.groups || [])) {
              if (!g?.id || seen.has(g.id)) continue;
              seen.add(g.id);
              list.push({
                id: g.id,
                name: formatProviderName(g.id, g.name),
                count: Array.isArray(g.models) ? g.models.length : 0
              });
            }
            if (cancelled) return;
            setProviders(list);
            setError('');
          } catch (e) {
            if (!cancelled) setError(String(e?.message ?? e));
          }
        })();
        return () => { cancelled = true; };
      }, [ctx]);

      // 当前生效顺序：自定义里显式列出的在前，其余按内置优先序补在后面
      const effective = useMemo(() => {
        if (!providers) return [];
        const byId = new Map(providers.map(p => [p.id, p]));
        const out = [];
        const used = new Set();
        for (const id of order) {
          const p = byId.get(id);
          if (p && !used.has(id)) { out.push(p); used.add(id); }
        }
        const rest = providers.filter(p => !used.has(p.id));
        rest.sort((a, b) => {
          const at = channelPriorityOf(a.id);
          const bt = channelPriorityOf(b.id);
          if (at !== bt) return at - bt;
          if (b.count !== a.count) return b.count - a.count;
          return a.name.localeCompare(b.name);
        });
        return out.concat(rest);
      }, [providers, order]);

      const persist = useCallback((next) => {
        setOrder(next);
        saveChannelOrder(next);
        syncPreferencesToDisk({
          channelOrder: next,
          viewMode: loadViewMode(),
          modelChannelDefaults: loadModelChannelDefaults(),
          favoritedModels: loadFavoritedModels()
        });
      }, []);

      const move = useCallback((index, delta) => {
        const target = index + delta;
        if (target < 0 || target >= effective.length) return;
        const ids = effective.map(p => p.id);
        const [moved] = ids.splice(index, 1);
        ids.splice(target, 0, moved);
        persist(ids);
      }, [effective, persist]);

      const reset = useCallback(() => {
        persist([]);
      }, [persist]);

      if (error !== '') {
        return h('p', { style: { fontSize: '12px', opacity: 0.6 } }, '渠道排序加载失败：' + error);
      }
      if (providers === null) {
        return h('p', { style: { fontSize: '12px', opacity: 0.5 } }, '加载中…');
      }

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, [
        h('p', { key: 'intro', style: { margin: 0, fontSize: '12px', opacity: 0.62, lineHeight: 1.7 } },
          '决定「按渠道」视图里各渠道行的先后顺序。默认：agy / Google Gemini 最前，其后是国内大厂积分渠道，官方账号与 Siliconflow 置底。用 ↑ ↓ 可覆盖，结果会保存到磁盘。'),
        h('div', { key: 'actions', style: { display: 'flex', gap: '8px', alignItems: 'center' } }, [
          h('button', {
            key: 'reset',
            type: 'button',
            onClick: reset,
            style: {
              fontSize: '12px', padding: '4px 10px', borderRadius: '6px', cursor: 'pointer',
              border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,0.14))',
              background: 'transparent', color: 'inherit'
            }
          }, '恢复默认顺序'),
          h('span', { key: 'hint', style: { fontSize: '11px', opacity: 0.45 } },
            '共 ' + effective.length + ' 个渠道')
        ]),
        h('div', { key: 'list', style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
          effective.map((p, i) => {
            const rank = channelPriorityOf(p.id);
            const tierLabel = rank < CHANNEL_PRIORITY.length ? '优先' : '其他';
            return h('div', {
              key: p.id,
              style: {
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '4px 8px', borderRadius: '6px', fontSize: '12.5px',
                background: i % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'transparent'
              }
            }, [
              h('span', { key: 'idx', style: { width: '22px', opacity: 0.4, fontVariantNumeric: 'tabular-nums' } }, String(i + 1)),
              h('span', { key: 'name', style: { flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, p.name),
              h('span', { key: 'tier', style: { fontSize: '10px', opacity: 0.5, padding: '0 5px' } }, tierLabel),
              h('span', { key: 'count', style: { fontSize: '10px', opacity: 0.4, minWidth: '28px', textAlign: 'right' } }, String(p.count)),
              h('button', {
                key: 'up', type: 'button', title: '上移',
                disabled: i === 0,
                onClick: () => move(i, -1),
                style: {
                  cursor: i === 0 ? 'default' : 'pointer', opacity: i === 0 ? 0.25 : 0.7,
                  background: 'transparent', border: 'none', color: 'inherit', fontSize: '12px', padding: '0 4px'
                }
              }, '↑'),
              h('button', {
                key: 'down', type: 'button', title: '下移',
                disabled: i === effective.length - 1,
                onClick: () => move(i, 1),
                style: {
                  cursor: i === effective.length - 1 ? 'default' : 'pointer',
                  opacity: i === effective.length - 1 ? 0.25 : 0.7,
                  background: 'transparent', border: 'none', color: 'inherit', fontSize: '12px', padding: '0 4px'
                }
              }, '↓')
            ]);
          })
        )
      ]);
    }

    class ChannelOrderErrorBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { hasError: false };
      }
      static getDerivedStateFromError() {
        return { hasError: true };
      }
      componentDidCatch(err) {
        console.warn('[SmartModels] ChannelOrderPage 已捕获异常:', err);
      }
      render() {
        if (this.state.hasError) {
          return h('p', { style: { fontSize: '12px', opacity: 0.6 } }, '渠道排序加载失败');
        }
        return this.props.children;
      }
    }

    function SafeChannelOrderPage(props) {
      return h(ChannelOrderErrorBoundary, null, h(ChannelOrderPage, props));
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 设置页「倍率覆盖」
    //   上游倍率由各渠道自己下发（channel-pack 从远端目录 meta.credits 解析，
    //   只存内存不落盘），本地无法直接改。这一页提供**显示层覆盖**：
    //   按「渠道|模型」精确改写显示倍率，不影响上游真实计费。
    // ══════════════════════════════════════════════════════════════════════════
    function MultiplierOverridePage(props) {
      const ctx = props.ctx || rootCtx;
      const [providers, setProviders] = useState(null);
      const [map, setMap] = useState(() => loadMultiplierOverrides());
      const [error, setError] = useState('');
      const [draft, setDraft] = useState({ provider: '', model: '', value: '' });

      // 从模型目录提取「渠道 × 模型」清单，供下拉选择（避免手敲错 id）
      useEffect(() => {
        let cancelled = false;
        (async () => {
          try {
            const resp = await ctx?.remote?.session?.modelCatalog?.();
            const catalog = resp?.ok ? resp.value : null;
            const list = [];
            for (const g of (catalog?.groups || [])) {
              if (!g?.id) continue;
              for (const m of (g.models || [])) {
                if (!m?.id) continue;
                list.push({
                  provider: g.id,
                  providerName: formatProviderName(g.id, g.name),
                  model: m.id,
                  modelName: m.name || m.id,
                  upstream: extractMultiplierRaw(m, g.id),
                });
              }
            }
            if (!cancelled) { setProviders(list); setError(''); }
          } catch (e) {
            if (!cancelled) setError(String(e?.message ?? e));
          }
        })();
        return () => { cancelled = true; };
      }, [ctx]);

      const persist = useCallback((next) => {
        setMap(next);
        saveMultiplierOverrides(next);
        reloadMultiplierOverrides();
      }, []);

      const addOverride = useCallback(() => {
        const p = draft.provider.trim();
        const m = draft.model.trim();
        const v = Number(draft.value);
        if (!p || !m) return;
        if (!Number.isFinite(v) || v < 0) return;
        const next = { ...map, [(p + '|' + m).toLowerCase()]: v };
        persist(next);
        setDraft({ provider: p, model: '', value: '' });
      }, [draft, map, persist]);

      const removeOverride = useCallback((key) => {
        const next = { ...map };
        delete next[key];
        persist(next);
      }, [map, persist]);

      const resetAll = useCallback(() => { persist({ ...MULTIPLIER_OVERRIDES_BUILTIN }); }, [persist]);

      const entries = Object.entries(map)
        .filter(([k]) => !(k in MULTIPLIER_OVERRIDES_BUILTIN))
        .sort((a, b) => a[0].localeCompare(b[0]));

      const inputStyle = {
        background: 'var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,0.06))',
        border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,0.12))',
        borderRadius: '6px', color: 'inherit', fontSize: '12px', padding: '5px 8px', outline: 'none'
      };

      if (error !== '') {
        return h('p', { style: { fontSize: '12px', opacity: 0.6 } }, '模型目录加载失败：' + error);
      }

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } }, [
        h('p', { key: 'intro', style: { margin: 0, fontSize: '12px', opacity: 0.62, lineHeight: 1.7 } },
          '上游倍率由各渠道自己下发（只存内存、不落盘），本地无法直接改。这里提供显示层覆盖：'
          + '按「渠道 | 模型」精确改写界面显示的倍率，不影响上游真实计费。'
          + '未配置的模型继续显示上游真实值。'),

        // 新增一条
        h('div', { key: 'add', style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' } }, [
          providers === null
            ? h('span', { key: 'loading', style: { fontSize: '12px', opacity: 0.5 } }, '加载模型目录…')
            : h('select', {
                key: 'sel',
                value: draft.provider + '||' + draft.model,
                onChange: (e) => {
                  const [p, m] = String(e.target.value).split('||');
                  const found = (providers || []).find(x => x.provider === p && x.model === m);
                  setDraft({ provider: p, model: m, value: found ? String(parseFloat(found.upstream.replace(/^x/i, '')) || 0) : '' });
                },
                style: { ...inputStyle, minWidth: '320px' }
              }, [
                h('option', { key: 'ph', value: '||' }, '选择渠道 / 模型…'),
                ...(providers || []).map(x => h('option', {
                  key: x.provider + '||' + x.model,
                  value: x.provider + '||' + x.model
                }, x.providerName + ' · ' + x.modelName + '（上游 ' + x.upstream + '）'))
              ]),
          h('input', {
            key: 'val', type: 'number', step: '0.01', min: '0',
            placeholder: '倍率，如 0.5',
            value: draft.value,
            onChange: (e) => setDraft(d => ({ ...d, value: e.target.value })),
            style: { ...inputStyle, width: '120px' }
          }),
          h('button', {
            key: 'addbtn', type: 'button',
            disabled: !draft.provider || !draft.model || draft.value === '',
            onClick: addOverride,
            style: {
              padding: '5px 14px', fontSize: '12px', borderRadius: '6px', cursor: 'pointer',
              border: '1px solid rgba(56,189,248,0.5)', background: 'rgba(56,189,248,0.14)', color: '#7dd3fc'
            }
          }, '添加覆盖'),
          h('button', {
            key: 'reset', type: 'button', onClick: resetAll,
            style: {
              padding: '5px 14px', fontSize: '12px', borderRadius: '6px', cursor: 'pointer',
              border: '1px solid rgba(255,255,255,0.12)', background: 'transparent', color: 'inherit', opacity: 0.7
            }
          }, '清空全部')
        ]),

        // 已配置列表
        entries.length === 0
          ? h('p', { key: 'none', style: { fontSize: '12px', opacity: 0.5, margin: 0 } },
              '暂无覆盖配置——所有模型显示上游真实倍率。')
          : h('table', { key: 'tbl', style: { width: '100%', borderCollapse: 'collapse', fontSize: '12px' } }, [
              h('thead', { key: 'th' }, h('tr', null, [
                h('th', { key: 'a', style: { textAlign: 'left', padding: '6px 8px', opacity: 0.6 } }, '渠道 | 模型'),
                h('th', { key: 'b', style: { textAlign: 'right', padding: '6px 8px', opacity: 0.6 } }, '覆盖倍率'),
                h('th', { key: 'c', style: { padding: '6px 8px' } }, '')
              ])),
              h('tbody', { key: 'tb' }, entries.map(([k, v]) => h('tr', { key: k }, [
                h('td', { key: 'k', style: { padding: '6px 8px', borderBottom: '1px solid rgba(255,255,255,.05)' } }, k),
                h('td', { key: 'v', style: { padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', borderBottom: '1px solid rgba(255,255,255,.05)' } }, 'x' + Number(v).toFixed(2)),
                h('td', { key: 'x', style: { padding: '6px 8px', textAlign: 'right', borderBottom: '1px solid rgba(255,255,255,.05)' } },
                  h('button', {
                    type: 'button',
                    onClick: () => removeOverride(k),
                    style: { background: 'transparent', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: '11px' }
                  }, '删除'))
              ])))
            ])
      ]);
    }

    class MultiplierOverrideErrorBoundary extends React.Component {
      constructor(props) { super(props); this.state = { hasError: false }; }
      static getDerivedStateFromError() { return { hasError: true }; }
      componentDidCatch(err) { console.warn('[SmartModels] MultiplierOverridePage 已捕获异常:', err); }
      render() {
        if (this.state.hasError) {
          return h('p', { style: { fontSize: '12px', opacity: 0.6 } }, '倍率覆盖加载失败');
        }
        return this.props.children;
      }
    }
    function SafeMultiplierOverridePage(props) {
      return h(MultiplierOverrideErrorBoundary, null, h(MultiplierOverridePage, props));
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 设置页合并分区：一个入口 + 内部标签页
    //   用量统计 / 上行自检 / 渠道排序 原本是三个独立 settings.section，
    //   在设置侧栏占了 3 行 —— 收拢为一个「智能模型」分区（占 1 行）。
    //   每个子页面保留各自的错误边界，一个标签页崩了不影响其他两个。
    // ══════════════════════════════════════════════════════════════════════════
    const SMART_MODELS_SETTINGS_TABS = [
      { id: 'usage', label: '用量统计', Component: SafeUsageStatsPage },
      { id: 'uplink', label: '上行自检', Component: SafeUplinkHealthPage },
      { id: 'order', label: '渠道排序', Component: SafeChannelOrderPage },
      { id: 'multiplier', label: '倍率覆盖', Component: SafeMultiplierOverridePage },
    ];

    function SmartModelsSettingsPage(props) {
      const [activeTab, setActiveTab] = useState('usage');

      const current = SMART_MODELS_SETTINGS_TABS.find(t => t.id === activeTab)
        || SMART_MODELS_SETTINGS_TABS[0];

      return h('div', { className: 'dsh-sm-settings-merged' }, [
        h('div', { key: 'tabs', className: 'dsh-sm-settings-tabs', role: 'tablist' },
          SMART_MODELS_SETTINGS_TABS.map(tab => h('button', {
            key: tab.id,
            type: 'button',
            role: 'tab',
            'aria-selected': tab.id === current.id,
            className: 'dsh-sm-settings-tab' + (tab.id === current.id ? ' active' : ''),
            title: tab.label,
            onClick: () => setActiveTab(tab.id)
          }, tab.label))
        ),
        // 非激活标签不渲染：三个子页面各自有轮询/倒计时 effect，
        // 同时挂载会有三份 interval 在跑，切换即卸载、回来即重挂载。
        h(current.Component, { key: current.id, ...props })
      ]);
    }

    class SmartModelsSettingsErrorBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { hasError: false };
      }
      static getDerivedStateFromError() {
        return { hasError: true };
      }
      componentDidCatch(err) {
        console.warn('[SmartModels] 设置页合并分区已捕获异常:', err);
      }
      render() {
        if (this.state.hasError) {
          return h('p', { style: { fontSize: '12px', opacity: 0.6 } }, 'Smart Models 设置加载失败');
        }
        return this.props.children;
      }
    }

    function SafeSmartModelsSettingsPage(props) {
      return h(SmartModelsSettingsErrorBoundary, null, h(SmartModelsSettingsPage, props));
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

      // 设置页合并分区：用量统计 / 上行自检 / 渠道排序 三页收拢为一个入口，
      // 内部用标签页切换。设置侧栏原本被本插件占 3 行，现在只占 1 行。
      // 分区名 = 插件本名（dsh-smart-models / Smart Models）：
      // 邻居分区多为中文名（如「免费模型」），用插件的英文品牌名一眼可辨，
      // 且明确表达「这个分区属于 Smart Models 插件」。
      ctx.slots.inject('settings.section', () => {
        return ctx.slots.register({
          name: 'settings.section',
          id: 'smart-models',
          order: 36,
          label: () => 'Smart Models'
        }, SafeSmartModelsSettingsPage);
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
