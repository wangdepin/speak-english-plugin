import { createUi, el, errorText, lifetime } from './dom.js';
import { createShortcuts } from './shortcuts.js';
import { homeScreen } from './home-screen.js';
import { intakeScreen } from './intake-screen.js';
import { passageScreen } from './passage-screen.js';
import { shadowScreen } from './shadow-screen.js';
import { readingScreen } from './reading-screen.js';
import { recallScreen } from './recall-screen.js';
import { reviewScreen } from './review-screen.js';
import { listenOnceScreen } from './listen-once-screen.js';
import { respondScreen } from './respond-screen.js';
import { diagnoseScreen } from './diagnose-screen.js';
import { gapsScreen } from './gaps-screen.js';
import { consolidateScreen } from './consolidate-screen.js';
import { onLanguageChange, setLanguage, t } from './i18n.js';

const SCREENS = { home: homeScreen, intake: intakeScreen, passage: passageScreen, shadow: shadowScreen, reading: readingScreen, recall: recallScreen, review: reviewScreen, listen: listenOnceScreen, respond: respondScreen, diagnose: diagnoseScreen, gaps: gapsScreen, consolidate: consolidateScreen };

/**
 * The daily-practice view. It shows one screen at a time; each screen gets its
 * own abort signal, which fires when the user moves to another screen.
 * Below the screen is a line listing the keyboard shortcuts that work right now.
 */
export function mountPractice(ctx, container, hostSignal) {
  const scope = lifetime(hostSignal, ctx.signal);
  const root = el('div', 'se-root se-practice');
  const stage = el('div');
  const hintLine = el('p', 'se-muted se-keys');
  root.append(stage, hintLine);
  container.append(root);
  const keys = createShortcuts(scope.signal, root, hintLine);
  const ui = createUi(ctx, keys);
  let state = null;
  let screenScope = null;
  let current = null;

  const app = {
    ctx,
    ui,
    keys,
    call: (operation, input) => ctx.call(operation, input),
    get state() { return state; },
    /** Keeps the newest state the backend has returned, and follows its interface language. */
    setState(next) {
      if (!next || (state && next.revision < state.revision)) return;
      state = next;
      setLanguage(state.settings.language);
    },
    go(screen) {
      current = screen;
      screenScope?.abort();
      screenScope = lifetime(scope.signal);
      stage.replaceChildren();
      SCREENS[screen.name](app, stage, screenScope.signal, screen);
    },
  };

  // The language is changed on the settings page, which can be open over this view: redraw the screen in the new language.
  onLanguageChange(() => { if (current) app.go(current); }, scope.signal);

  stage.append(el('p', 'se-muted', t('正在加载…')));
  ctx.call('get-state').then(loaded => {
    if (scope.signal.aborted) return;
    app.setState(loaded);
    app.go({ name: 'home' });
  }, error => {
    if (!scope.signal.aborted) stage.replaceChildren(el('p', 'se-error', errorText(error)));
  });

  return () => { scope.abort(); root.remove(); };
}
