import { plainLabel } from './shortcut-keys.js';
import { t } from './i18n.js';

const CONFIRM_MS = 4000;

/** Creates an element with an optional class and text. */
export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export const errorText = error => (error instanceof Error ? error.message : String(error));

/** An AbortController that aborts as soon as any parent signal does. */
export function lifetime(...parents) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const parent of parents) {
    if (parent.aborted) abort();
    else parent.addEventListener('abort', abort, { once: true, signal: controller.signal });
  }
  return controller;
}

/** A paragraph that shows one error at a time and announces it to screen readers. */
export function errorLine(parent) {
  const line = el('p', 'se-error');
  line.setAttribute('role', 'alert');
  parent.append(line);
  return { show: error => { line.textContent = errorText(error); }, clear: () => { line.textContent = ''; } };
}

/**
 * Wraps the host's widgets so they are disposed with the screen that created them.
 * With `shortcuts`, a button made with the option `key: <role>` can also be pressed from the keyboard.
 */
export function createUi(ctx, shortcuts = null) {
  const widget = (handle, signal) => {
    if (signal.aborted) handle.dispose();
    else signal.addEventListener('abort', () => handle.dispose(), { once: true });
    return handle;
  };
  /** A host button that stays disabled while its action is running. */
  function button(parent, label, action, signal, options = {}) {
    const { key, ...hostOptions } = options;
    const slot = el('span', 'se-button');
    parent.append(slot);
    let pending = false;
    let disabled = Boolean(options.disabled);
    const press = async () => {
      if (pending || disabled || signal.aborted) return;
      pending = true;
      handle.update({ disabled: true });
      try { await action(); } finally {
        pending = false;
        if (!signal.aborted) handle.update({ disabled });
        shortcuts?.refresh();
      }
    };
    const handle = widget(ctx.ui.mountButton(slot, { label, size: 'sm', variant: 'outline', ...hostOptions, onClick: press }, { signal }), signal);
    const shortcut = key && shortcuts ? shortcuts.bind(key, { run: press, label: plainLabel(label), enabled: () => !pending && !disabled }, signal) : null;
    return {
      update(props) {
        if (Object.hasOwn(props, 'disabled')) disabled = props.disabled;
        handle.update({ ...props, disabled: pending || disabled });
        if (Object.hasOwn(props, 'label')) shortcut?.relabel(plainLabel(props.label));
        shortcuts?.refresh();
      },
    };
  }
  /** A button for something that cannot be undone: the first click arms it, a second click within a few seconds runs `action`. */
  function confirmButton(parent, label, action, signal, options = {}) {
    let armedUntil = 0;
    const handle = button(parent, label, async () => {
      if (Date.now() < armedUntil) { armedUntil = 0; await action(); return; }
      armedUntil = Date.now() + CONFIRM_MS;
      handle.update({ label: t('再点一次确认') });
      setTimeout(() => { if (!signal.aborted) handle.update({ label }); }, CONFIRM_MS);
    }, signal, options);
    return handle;
  }
  return { widget, button, confirmButton };
}
