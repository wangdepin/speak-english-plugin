import { createUi } from './dom.js';
import { mountPractice } from './practice-view.js';
import { mountSettings } from './settings-screen.js';
import { setLanguage, t } from './i18n.js';

const VIEW_ID = 'practice';
const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8.5 21h7"/></svg>';
const REQUIRED_UI = ['mountButton', 'mountSettingsRows', 'mountModelPicker'];

/** The names registered with the host are fixed once the plugin starts, so the language is read first. Chinese when it cannot be read. */
async function loadLanguage(ctx) {
  try { setLanguage((await ctx.call('get-state')).settings.language); } catch { setLanguage('zh'); }
}

/** Registers the daily-practice view, its sidebar entry and the settings page. */
export async function activate(ctx) {
  for (const capability of REQUIRED_UI) {
    if (typeof ctx.ui?.[capability] !== 'function') throw new Error(t('英语开口练习需要更新版本的 LearnHarness（缺少 ctx.ui.{capability}）。', { capability }));
  }
  await loadLanguage(ctx);
  const ui = createUi(ctx);
  const registrations = [
    ctx.registerView({ id: VIEW_ID, name: t('每日练习'), mount: (container, signal) => mountPractice(ctx, container, signal) }),
    ctx.registerAction({ id: 'open', name: t('开口练习'), icon: ICON, run: () => ctx.app.openView(VIEW_ID) }),
    ctx.placeAction({ id: 'open-sidebar', actionId: 'open', location: 'sidebar' }),
    ctx.registerSettings((container, signal) => mountSettings(ctx, ui, container, signal)),
  ];
  const dispose = () => { for (const unregister of registrations.splice(0).reverse()) unregister(); };
  ctx.cleanup(dispose);
  return dispose;
}
