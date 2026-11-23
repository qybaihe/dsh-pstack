/**
 * Visual stylesheet for `@qybaihe/dsh-pstack` in DeepSeek Harness Web & Desktop.
 *
 * IMPORTANT: DeepSeek Harness defines `--dsw-alias-*` on `body` (light) and
 * `body[data-ds-dark-theme]` (dark), NOT on `:root`. Every `--p-*` surface,
 * border, and ink token is therefore declared on `body` and
 * `body[data-ds-dark-theme]` so custom-property resolution always sees the
 * active host theme rather than freezing to light-mode fallbacks at `:root`.
 */

export const PSTACK_CSS = `
body {
  --p-gold: #F2C230;
  --p-gold-edge: #C99A12;
  --p-gold-wash: rgba(242, 194, 48, 0.14);
  --p-russet: #7A4E24;
  --p-skin: #E9D3AE;
  --p-ketchup: #D7261E;
  --p-ketchup-wash: rgba(215, 38, 30, 0.08);
  --p-ketchup-badge-bg: #C92019;
  --p-ketchup-badge-fg: #FFFFFF;
  --p-chive: #2E7D46;
  --p-chive-wash: rgba(46, 125, 70, 0.10);
  --p-vitelotte: #6B4C9A;
  --p-vitelotte-wash: rgba(107, 76, 154, 0.10);
  --p-display: ui-rounded, 'SF Pro Rounded', 'Hiragino Maru Gothic ProN', 'Nunito', var(--dsw-font-family, -apple-system, BlinkMacSystemFont, sans-serif);
  --p-bg-base: var(--dsw-alias-bg-base, var(--dsw-alias-bg-layer-1, #ffffff));
  --p-bg-module: var(--dsw-alias-card-fill, var(--dsw-alias-bg-layer-2, #f5f6f7));
  --p-bg-hover: var(--dsw-alias-card-fill-hover, var(--dsw-alias-bg-layer-3, #eceff3));
  --p-bg-overlay: var(--dsw-alias-bg-layer-3, #e9ecf2);
  --p-border-l1: var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.06));
  --p-border-l2: var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.12));
  --p-border-l3: var(--dsw-alias-border-l3, rgba(0, 0, 0, 0.22));
  --p-hollow-border: var(--dsw-alias-border-l3, rgba(0, 0, 0, 0.28));
  --p-text-primary: var(--dsw-alias-label-primary, #0f1115);
  --p-text-secondary: var(--dsw-alias-label-secondary, #61666b);
  --p-text-tertiary: var(--dsw-alias-label-tertiary, #767b84);
  --p-text-inverted: var(--dsw-alias-label-primary-inverted, #ffffff);
  --p-code-font: var(--dsw-font-markdown-code-font-family, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace);
}

body[data-ds-dark-theme],
body[data-theme="dark"],
body.dark {
  --p-gold: #F2C230;
  --p-gold-edge: #D9A926;
  --p-gold-wash: rgba(242, 194, 48, 0.15);
  --p-russet: #D9A968;
  --p-skin: #6E5130;
  --p-ketchup: #FF6257;
  --p-ketchup-wash: rgba(255, 98, 87, 0.14);
  --p-ketchup-badge-bg: #FF6257;
  --p-ketchup-badge-fg: #151517;
  --p-chive: #63CC84;
  --p-chive-wash: rgba(99, 204, 132, 0.14);
  --p-vitelotte: #B397EA;
  --p-vitelotte-wash: rgba(179, 151, 234, 0.16);
  --p-bg-base: var(--dsw-alias-bg-base, #151517);
  --p-bg-module: var(--dsw-alias-card-fill, var(--dsw-alias-bg-layer-2, #232428));
  --p-bg-hover: var(--dsw-alias-card-fill-hover, var(--dsw-alias-bg-layer-3, #2d2e34));
  --p-bg-overlay: var(--dsw-alias-bg-layer-3, #2d2e34);
  --p-border-l1: var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.06));
  --p-border-l2: var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.12));
  --p-border-l3: var(--dsw-alias-border-l3, rgba(255, 255, 255, 0.20));
  --p-hollow-border: var(--dsw-alias-border-l3, rgba(255, 255, 255, 0.25));
  --p-text-primary: var(--dsw-alias-label-primary, #f3f4f6);
  --p-text-secondary: var(--dsw-alias-label-secondary, #b3b7c0);
  --p-text-tertiary: var(--dsw-alias-label-tertiary, #8a909d);
  --p-text-inverted: var(--dsw-alias-label-primary-inverted, #151517);
}

/* Potato SVG states */
.pstack-potato { width: 20px; height: 21px; flex: none; overflow: visible; display: inline-block; vertical-align: middle; }
.pstack-potato.sm { width: 15px; height: 16px; }
.pstack-potato.lg { width: 34px; height: 36px; }

/* Fries progress rail */
.pstack-fries { display: flex; gap: 4px; align-items: center; flex: 1 1 48px; min-width: 44px; }
.pstack-fries i { display: block; height: 8px; flex: 1; border-radius: 2px; border: 1.25px solid var(--p-hollow-border); box-sizing: border-box; transition: background-color 180ms ease, border-color 180ms ease; }
.pstack-fries i:nth-child(odd) { transform: rotate(-1.4deg); }
.pstack-fries i:nth-child(even) { transform: rotate(1.1deg); }
.pstack-fries i.done { background: var(--p-gold); border-color: var(--p-gold-edge); }
.pstack-fries i.now { border-color: var(--p-gold-edge); background: linear-gradient(90deg, var(--p-gold) 45%, transparent 45%); }

/* Verdict stamps */
.pstack-stamp {
  display: inline-block;
  padding: 0 7px;
  border: 1.5px solid currentColor;
  border-radius: 5px;
  font: 800 11px/18px var(--p-display);
  letter-spacing: 0.06em;
  transform: rotate(-3deg);
  white-space: nowrap;
  flex: none;
  box-sizing: border-box;
}
.pstack-stamp.red { color: var(--p-ketchup); }
.pstack-stamp.green { color: var(--p-chive); }
.pstack-stamp.gold { color: #5A3A12; background: var(--p-gold); border-color: var(--p-gold-edge); }
.pstack-stamp.purple { color: var(--p-vitelotte); }
.pstack-stamp.mute { color: var(--p-text-tertiary); }
.pstack-stamp.said { border-style: dashed; }
.pstack-stamp.land { animation: pstack-land 260ms cubic-bezier(.2, 1.4, .4, 1); }

@keyframes pstack-land {
  from { transform: rotate(-11deg) scale(1.85); opacity: 0; }
}
@keyframes pstack-flash {
  from { box-shadow: 0 0 0 3px var(--p-gold); }
  to { box-shadow: 0 0 0 3px transparent; }
}
.pstack-flash { animation: pstack-flash 900ms ease-out; }

.pstack-tag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 20px;
  background: var(--p-bg-overlay);
  color: var(--p-text-secondary);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  flex: none;
}
.pstack-lamp { width: 7px; height: 7px; border-radius: 50%; background: var(--p-border-l3); flex: none; display: inline-block; }
.pstack-lamp.red { background: var(--p-ketchup); }
.pstack-lamp.green { background: var(--p-chive); }
.pstack-lamp.gold { background: var(--p-gold); }
.pstack-lamp.purple { background: var(--p-vitelotte); }

/* Dock above composer (conversation.input.dock) */
.pstack-dock-wrap {
  box-sizing: border-box;
  width: calc(100% - 2 * var(--dsh-composer-side-clearance, 16px));
  max-width: var(--dsh-composer-card-max-width, 760px);
  margin: 0 auto 6px;
  position: relative;
}
.pstack-moment {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 13px;
  margin-bottom: 6px;
  border-radius: 11px;
  background: var(--dsw-alias-toast-bg, var(--p-text-primary));
  color: var(--dsw-alias-toast-label, var(--p-text-inverted));
  font-size: 12.5px;
  box-shadow: var(--dsw-elevation-panel, 0 6px 20px rgba(0, 0, 0, 0.22));
  min-width: 0;
}
.pstack-moment .skill { font: 700 12px var(--p-display); color: var(--p-gold); white-space: nowrap; flex: none; }
.pstack-moment .text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pstack-moment .pstack-stamp.red { color: #FF8379; }
.pstack-moment .pstack-stamp.green { color: #7BDD9A; }
.pstack-moment .pstack-stamp.purple { color: #C5ADF5; }
.pstack-moment .pstack-stamp.mute { color: rgba(180, 180, 180, 0.92); }

.pstack-dock {
  all: unset;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
  overflow: hidden;
  padding: 6px 12px 6px 10px;
  border: 1px solid var(--p-border-l2);
  border-radius: 12px;
  background: var(--p-bg-module);
  color: var(--p-text-primary);
  font-size: 12.5px;
  cursor: pointer;
  transition: border-color 150ms ease, background-color 150ms ease;
}
.pstack-dock:hover { border-color: var(--p-gold-edge); background: var(--p-bg-hover); }
.pstack-dock:focus-visible { outline: 2px solid var(--p-gold-edge); outline-offset: 1px; }
.pstack-dock-pb { font: 700 13px var(--p-display); flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pstack-dock-where { flex: 0 1 auto; min-width: 0; white-space: nowrap; color: var(--p-text-secondary); font-variant-numeric: tabular-nums; max-width: 190px; overflow: hidden; text-overflow: ellipsis; }

/* Left composer chip (conversation.input.left) */
.pstack-mode-chip {
  all: unset;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 9px 0 6px;
  border-radius: 999px;
  border: 1px solid var(--p-border-l2);
  background: transparent;
  color: var(--p-text-secondary);
  font: 600 12px/1 var(--p-display);
  cursor: pointer;
  white-space: nowrap;
  transition: border-color 150ms ease, background-color 150ms ease, color 150ms ease;
}
.pstack-mode-chip:hover {
  border-color: var(--p-gold-edge);
  background: var(--p-gold-wash);
  color: var(--p-text-primary);
}
.pstack-mode-chip:focus-visible { outline: 2px solid var(--p-gold-edge); outline-offset: 1px; }
.pstack-mode-chip.active {
  border-color: var(--p-gold-edge);
  background: var(--p-gold-wash);
  color: var(--p-text-primary);
}

/* Session header utility button (conversation.session.header.utilities) */
.pstack-header-btn {
  all: unset;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 10px 0 7px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--p-text-secondary);
  font: 600 12px/1 var(--p-display);
  cursor: pointer;
  white-space: nowrap;
  transition: background-color 150ms ease, border-color 150ms ease, color 150ms ease;
}
.pstack-header-btn:hover {
  background: var(--p-bg-hover);
  color: var(--p-text-primary);
}
.pstack-header-btn:focus-visible { outline: 2px solid var(--p-gold-edge); outline-offset: 1px; }
.pstack-header-btn.active {
  border-color: var(--p-gold-edge);
  background: var(--p-gold-wash);
  color: var(--p-text-primary);
}

/* Hero playbook quick-picker (conversation.hero.options) */
.pstack-hero {
  display: inline-flex;
  flex-wrap: nowrap;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  margin: 0;
  min-width: 0;
}
.pstack-hero-pill {
  all: unset;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 25px;
  padding: 0 8px 0 6px;
  border-radius: 999px;
  border: 1px solid var(--p-border-l2);
  background: var(--p-bg-module);
  color: var(--p-text-secondary);
  font-size: 11.5px;
  line-height: 1;
  cursor: pointer;
  white-space: nowrap;
  transition: border-color 140ms ease, color 140ms ease, background-color 140ms ease, transform 100ms ease;
}
.pstack-hero-pill:hover {
  border-color: var(--p-gold-edge);
  color: var(--p-text-primary);
  background: var(--p-bg-hover);
}
.pstack-hero-pill:active { transform: scale(0.97); }
.pstack-hero-pill:focus-visible { outline: 2px solid var(--p-gold-edge); outline-offset: 1px; }
.pstack-hero-pill[aria-pressed="true"],
.pstack-hero-pill.active {
  border-color: var(--p-gold-edge);
  background: var(--p-gold-wash);
  color: var(--p-text-primary);
}
.pstack-hero-pill b { font-family: var(--p-display); font-weight: 600; color: inherit; }

/* Quick-switcher chips inside right sidebar Playbook tab */
.pstack-quick-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
}

/* Session list row trail & hover */
.pstack-row-trail {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--p-text-secondary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.pstack-ketchup-badge {
  display: inline-grid;
  place-items: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px 8px 8px 3px;
  background: var(--p-ketchup-badge-bg);
  color: var(--p-ketchup-badge-fg);
  font: 700 10px/1 var(--p-display);
  flex: none;
}
.pstack-row-hover {
  padding: 6px 0 2px;
  border-top: 1px solid var(--p-border-l1);
  font-size: 12px;
  color: var(--p-text-secondary);
  display: flex;
  flex-direction: column;
  gap: 3px;
}

/* Tool cards (tool.call.toolview) */
.pstack-card {
  position: relative;
  padding: 13px 16px 13px 17px;
  border-radius: 4px 14px 14px 4px;
  background: var(--p-bg-module);
  border-left: 3px solid var(--p-gold);
  color: var(--p-text-primary);
  font-size: 13px;
  line-height: 1.5;
  margin: 4px 0;
  min-width: 0;
  overflow-wrap: anywhere;
}
.pstack-card.ketchup,
.pstack-card.error { border-left-color: var(--p-ketchup); }
.pstack-card.peel { border-left-color: var(--p-russet); }
.pstack-card-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; flex-wrap: wrap; min-width: 0; }
.pstack-card-head h3 { font: 700 14.5px/1.2 var(--p-display); margin: 0; flex: none; }
.pstack-card-task { color: var(--p-text-secondary); font-size: 12.5px; flex: 1 1 140px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pstack-phases { display: flex; gap: 0; margin: 4px 0 12px; overflow-x: auto; }
.pstack-phases span { flex: 1; min-width: 44px; font-size: 11px; color: var(--p-text-tertiary); padding-top: 6px; border-top: 2px solid var(--p-border-l2); white-space: nowrap; }
.pstack-phases span.done { border-top-color: var(--p-gold); color: var(--p-text-secondary); }
.pstack-phases span.now { border-top-color: var(--p-russet); color: var(--p-text-primary); font-weight: 600; }
.pstack-seats { display: grid; grid-template-columns: repeat(auto-fit, minmax(124px, 1fr)); gap: 12px; }
.pstack-seat { min-width: 0; }
.pstack-seat b { display: block; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pstack-seat .vendor { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: var(--p-text-secondary); }
.pstack-seat .pstack-stamp { margin-top: 5px; }
.pstack-sicko-quote { font: italic 600 13.5px/1.5 Georgia, 'Songti SC', serif; color: var(--p-russet); }
.pstack-tally { display: flex; flex-wrap: wrap; gap: 18px; margin-top: 8px; }
.pstack-tally b { display: block; font: 700 20px/1.1 var(--p-display); font-variant-numeric: tabular-nums; }
.pstack-call { padding: 11px 0; border-top: 1px solid var(--p-border-l2); }
.pstack-call:first-of-type { border-top: 0; padding-top: 0; }
.pstack-call h4 { font: 700 13.5px/1.3 var(--p-display); margin: 0; }
.pstack-call-pick { color: var(--p-text-secondary); margin: 2px 0 7px; font-size: 12.5px; }
.pstack-facts { display: grid; grid-template-columns: 48px minmax(0, 1fr); gap: 3px 10px; margin: 0; font-size: 12.5px; }
.pstack-facts dt { color: var(--p-text-tertiary); }
.pstack-facts dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.pstack-acts { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; margin-top: 10px; }

/* Buttons & inputs */
.pstack-btn {
  all: unset;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 5px 12px;
  border-radius: 8px;
  border: 1px solid var(--p-border-l3);
  font-size: 12px;
  line-height: 1.3;
  background: var(--p-bg-base);
  color: var(--p-text-primary);
  cursor: pointer;
  transition: border-color 140ms ease, background-color 140ms ease;
}
.pstack-btn:hover { border-color: var(--p-gold-edge); background: var(--p-bg-hover); }
.pstack-btn:focus-visible { outline: 2px solid var(--p-gold-edge); outline-offset: 1px; }
.pstack-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.pstack-btn.primary {
  background: var(--p-text-primary);
  color: var(--p-text-inverted);
  border-color: transparent;
  font-weight: 600;
}
.pstack-btn.primary:hover { opacity: 0.9; background: var(--p-text-primary); }
.pstack-input, .pstack-select, .pstack-textarea {
  box-sizing: border-box;
  width: 100%;
  padding: 7px 10px;
  border-radius: 8px;
  border: 1px solid var(--p-border-l2);
  background: var(--p-bg-base);
  color: var(--p-text-primary);
  font: 12.5px/1.4 var(--dsw-font-family, sans-serif);
}
.pstack-input.mono, .pstack-textarea.mono { font-family: var(--p-code-font); font-size: 12px; }
.pstack-input:focus, .pstack-select:focus, .pstack-textarea:focus {
  outline: 2px solid var(--p-gold-edge);
  outline-offset: -1px;
}

/* Right sidebar pane (sidebar.right.pane.tab) */
.pstack-pane-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  color: var(--p-text-primary);
  font-size: 13px;
  line-height: 1.5;
  background: var(--p-bg-base);
}
.pstack-seg {
  display: flex;
  padding: 8px 14px 0;
  border-bottom: 1px solid var(--p-border-l2);
  gap: 14px;
  flex: none;
  overflow-x: auto;
  scrollbar-width: none;
}
.pstack-seg::-webkit-scrollbar { display: none; }
.pstack-seg button {
  all: unset;
  padding: 6px 2px 9px;
  color: var(--p-text-secondary);
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  font: 600 13px var(--p-display);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
  flex: none;
}
.pstack-seg button:hover { color: var(--p-text-primary); }
.pstack-seg button:focus-visible { outline: 2px solid var(--p-gold-edge); outline-offset: -2px; border-radius: 4px; }
.pstack-seg button[aria-selected="true"] {
  color: var(--p-text-primary);
  border-bottom-color: var(--p-gold);
}
.pstack-pane-scroll {
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 16px 14px 28px;
}
.pstack-hero-head { display: flex; gap: 12px; align-items: flex-start; min-width: 0; }
.pstack-hero-head > div { min-width: 0; }
.pstack-hero-head h2 { font: 800 21px/1.15 var(--p-display); margin: 0; letter-spacing: -0.02em; overflow-wrap: anywhere; }
.pstack-hero-head p { margin: 3px 0 0; color: var(--p-text-secondary); font-size: 12.5px; overflow-wrap: anywhere; }
.pstack-goal-box {
  margin: 12px 0 0;
  padding: 9px 0;
  border-top: 1px solid var(--p-border-l2);
  border-bottom: 1px solid var(--p-border-l2);
  font-size: 13px;
  overflow-wrap: anywhere;
}
.pstack-sub {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  margin: 20px 0 8px;
  font: 700 13px var(--p-display);
}
.pstack-sub span { font: 400 12px var(--dsw-font-family, sans-serif); color: var(--p-text-secondary); }
.pstack-steplist { list-style: none; margin: 10px 0 0; padding: 0; }
.pstack-steplist li {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  padding: 6px 0;
}
.pstack-steplist .fry {
  height: 8px;
  border-radius: 2px;
  border: 1.25px solid var(--p-hollow-border);
  transform: rotate(-2deg);
}
.pstack-steplist li.done .fry { background: var(--p-gold); border-color: var(--p-gold-edge); }
.pstack-steplist li.now .fry { border-color: var(--p-gold-edge); background: linear-gradient(90deg, var(--p-gold) 45%, transparent 45%); }
.pstack-steplist li.now { font-weight: 600; }
.pstack-steplist li.todo { color: var(--p-text-secondary); }
.pstack-skillref {
  font-size: 11px;
  padding: 0 6px;
  line-height: 18px;
  border-radius: 5px;
  border: 1px dashed var(--p-border-l3);
  color: var(--p-text-tertiary);
  max-width: 110px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pstack-skillref.read {
  border: 1px solid var(--p-gold-edge);
  background: var(--p-gold-wash);
  color: var(--p-text-primary);
}
.pstack-prow { display: grid; grid-template-columns: 48px minmax(0, 1fr); align-items: center; padding: 4px 0; font-size: 12px; }
.pstack-eyes { display: flex; flex-wrap: wrap; gap: 7px; }
.pstack-eyes i {
  display: block;
  width: 10px;
  height: 8px;
  border-radius: 50%;
  border: 1.25px solid var(--p-hollow-border);
  box-sizing: border-box;
}
.pstack-eyes i.read { background: var(--p-russet); border-color: var(--p-russet); }
.pstack-eyes i.flag { background: var(--p-ketchup); border-color: var(--p-ketchup); }

.pstack-note {
  margin-top: 12px;
  padding: 9px 12px;
  border-radius: 4px 12px 12px 4px;
  border-left: 3px solid var(--p-ketchup);
  background: var(--p-ketchup-wash);
  font-size: 12.5px;
  overflow-wrap: anywhere;
}
.pstack-note.calm { border-left-color: var(--p-vitelotte); background: var(--p-vitelotte-wash); }
.pstack-note.gold { border-left-color: var(--p-gold); background: var(--p-gold-wash); }

.pstack-gates { display: grid; grid-template-columns: auto auto minmax(0, 1fr) auto; gap: 9px 8px; align-items: center; font-size: 12.5px; }
.pstack-gates code { overflow-wrap: anywhere; font-family: var(--p-code-font); font-size: 11.5px; }

/* Tables, Matrix, Findings, BigStats */
.pstack-table-wrap {
  width: 100%;
  max-width: 100%;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
.pstack-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.pstack-table th, .pstack-table td {
  text-align: left;
  padding: 7px 6px;
  border-bottom: 1px solid var(--p-border-l1);
  vertical-align: top;
  overflow-wrap: anywhere;
}
.pstack-table th { font-weight: 500; color: var(--p-text-secondary); font-size: 11.5px; white-space: nowrap; }
.pstack-table td.c, .pstack-table th.c { text-align: center; }
.pstack-table td.r, .pstack-table th.r { text-align: right; white-space: nowrap; }
.pstack-matrix th.cand b { display: block; font: 700 13px var(--p-display); color: var(--p-text-primary); }
.pstack-matrix td.c { font: 600 14.5px var(--p-display); font-variant-numeric: tabular-nums; }
.pstack-matrix .base { background: var(--p-gold-wash); }
.pstack-matrix .judge-rec { box-shadow: inset 0 0 0 1.5px var(--p-vitelotte); background: var(--p-vitelotte-wash); }
.pstack-matrix tr.sum td { border-bottom: 0; font-size: 17px; font-weight: 800; }

.pstack-finding { padding: 11px 0; border-top: 1px solid var(--p-border-l2); }
.pstack-finding-top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
.pstack-finding-top b { flex: 1 1 120px; min-width: 0; overflow-wrap: anywhere; }
.pstack-pre {
  margin: 7px 0 0;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--p-bg-module);
  overflow: auto;
  font: 11.5px/1.5 var(--p-code-font);
  max-height: 220px;
}

.pstack-bigstats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
  margin-top: 12px;
  border-top: 1px solid var(--p-border-l2);
  border-bottom: 1px solid var(--p-border-l2);
}
.pstack-bigstats > div { padding: 9px 0 9px 9px; border-left: 1px solid var(--p-border-l2); min-width: 0; }
.pstack-bigstats > div:first-child { border-left: 0; padding-left: 0; }
.pstack-bigstats b {
  display: block;
  font: 800 18px/1.2 var(--p-display);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}
.pstack-bigstats b small { font: 400 11px var(--dsw-font-family, sans-serif); color: var(--p-text-tertiary); letter-spacing: 0; }
.pstack-chart text { font: 10px var(--dsw-font-family, sans-serif); fill: var(--p-text-tertiary); }

.pstack-checklist {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}

/* Config forms (plugins.row.config) */
.pstack-cfg { display: flex; flex-direction: column; gap: 16px; max-width: 640px; padding: 6px 0; color: var(--p-text-primary); }
.pstack-cfg-field { display: flex; flex-direction: column; gap: 5px; }
.pstack-cfg-field label { font-weight: 600; font-size: 12.5px; color: var(--p-text-primary); }
.pstack-cfg-hint { font-size: 11.5px; color: var(--p-text-secondary); }
.pstack-dryrun {
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid var(--p-border-l2);
  background: var(--p-bg-module);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

@media (prefers-reduced-motion: reduce) {
  .pstack-stamp.land, .pstack-flash { animation: none; }
  .pstack-fries i, .pstack-dock, .pstack-hero-pill, .pstack-header-btn, .pstack-mode-chip { transition: none; }
}
`
