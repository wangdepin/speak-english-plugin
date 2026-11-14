import { shortcutHint, roleForKey } from './shortcut-keys.js';

const TOGGLE_INPUTS = ['checkbox', 'radio', 'button'];
const isTyping = target => target instanceof HTMLElement
  && (target.isContentEditable || ['TEXTAREA', 'SELECT'].includes(target.tagName) || (target.tagName === 'INPUT' && !TOGGLE_INPUTS.includes(target.type)));

/**
 * Keyboard shortcuts for one mounted practice view. A screen binds a role
 * ("next", "reference", ...) to an action for as long as a signal lives; the
 * newest binding of a role wins. `hintLine` always lists the keys that work
 * right now. Keys typed into a text field are left alone, and so are keys
 * pressed while a dialog (such as the app's settings) is open over the view.
 */
export function createShortcuts(signal, root, hintLine) {
  const bindings = [];
  let refreshQueued = false;

  const current = role => bindings.findLast(binding => binding.role === role && binding.enabled());

  function render() {
    refreshQueued = false;
    if (signal.aborted) return;
    const labels = new Map();
    for (const binding of bindings) if (binding.enabled()) labels.set(binding.role, binding.label);
    hintLine.textContent = shortcutHint(labels);
  }

  /** Redraws the hint line once the code that is running now has finished, so it sees the screen's new state. */
  function refresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    queueMicrotask(render);
  }

  /**
   * Binds `role` to `run` until `scope` aborts. `enabled()` says whether the key
   * does anything right now; `label` is what the hint line calls it.
   * Returns { relabel(label) }.
   */
  function bind(role, { run, label, enabled = () => true }, scope) {
    const binding = { role, run, label, enabled };
    if (scope.aborted) return { relabel() {} };
    bindings.push(binding);
    scope.addEventListener('abort', () => { bindings.splice(bindings.indexOf(binding), 1); refresh(); }, { once: true });
    refresh();
    return { relabel(next) { binding.label = next; refresh(); } };
  }

  /** Whether a dialog that does not contain this view is open: the keys then belong to the dialog. */
  const isCovered = () => Array.from(document.querySelectorAll('[role="dialog"], dialog[open]')).some(dialog => !dialog.contains(root));
  /** Runs a binding's action; a failure the action did not handle itself is logged, not lost. */
  const press = binding => { new Promise(resolve => resolve(binding?.run())).catch(cause => console.error('[speak-english]', cause)); };

  document.addEventListener('keydown', event => {
    if (event.defaultPrevented || isTyping(event.target) || isCovered()) return;
    const role = roleForKey(event);
    if (!role || !bindings.some(binding => binding.role === role)) return;
    // The key belongs to this screen even when it does nothing right now: it must not scroll the page or press a focused button.
    event.preventDefault();
    if (event.target instanceof HTMLElement && event.target !== document.body) event.target.blur();
    if (!event.repeat) press(current(role));
  }, { signal });

  return { bind, refresh };
}
