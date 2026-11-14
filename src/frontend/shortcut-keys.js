import { mark, t } from './i18n.js';

/**
 * The practice view's keyboard shortcuts, by role. Every screen uses the same
 * key for the same kind of action. `codes` are KeyboardEvent.code values, so
 * the keys do not move with the keyboard layout; `glyph` is what the hint line shows.
 */
export const SHORTCUTS = [
  { role: 'record', codes: ['Space'], glyph: mark('空格') },
  { role: 'reference', codes: ['KeyR'], glyph: 'R' },
  { role: 'mine', codes: ['KeyM'], glyph: 'M' },
  { role: 'slow', codes: ['KeyS'], glyph: 'S' },
  { role: 'answer', codes: ['KeyA'], glyph: 'A' },
  { role: 'explain', codes: ['KeyE'], glyph: 'E' },
  { role: 'no', codes: ['Digit1', 'Numpad1'], glyph: '1' },
  { role: 'yes', codes: ['Digit2', 'Numpad2'], glyph: '2' },
  { role: 'previous', codes: ['ArrowUp', 'ArrowLeft'], glyph: '↑' },
  { role: 'next', codes: ['ArrowDown', 'ArrowRight', 'Enter', 'NumpadEnter'], glyph: '↓' },
];

const ROLE_BY_CODE = new Map(SHORTCUTS.flatMap(({ role, codes }) => codes.map(code => [code, role])));

/** The role a key press stands for, or null. Presses with ⌘, Ctrl or Alt, and presses that belong to an input method, stand for nothing. */
export function roleForKey({ code, metaKey, ctrlKey, altKey, isComposing, keyCode }) {
  if (metaKey || ctrlKey || altKey || isComposing || keyCode === 229) return null;
  return ROLE_BY_CODE.get(code) ?? null;
}

/** A button label without its decoration ("▶ 原声" → "原声", "下一句 →" → "下一句"). */
export function plainLabel(label) {
  return label.replace(/^[▶●■←]\s*/u, '').replace(/\s*→$/u, '');
}

/** The hint line: the keys that do something right now, in a fixed order. `labels` maps role → what the key does. */
export function shortcutHint(labels) {
  return SHORTCUTS.filter(({ role }) => labels.has(role)).map(({ role, glyph }) => `${t(glyph)} ${labels.get(role)}`).join(' · ');
}
