import { el, lifetime } from './dom.js';
import { t } from './i18n.js';

const OPENING_MAX_CHARS = 60;
// The same rule as the backend's for a session id.
const SESSION_ID = /^[A-Za-z0-9_-]{1,80}$/;

// The app's own home page starts a lesson in two steps (components/start-session.ts and
// components/opening-prompt.ts in the app): it creates the session, then leaves the learner's first
// message in sessionStorage, where the session page finds it and sends it. Neither step is part of
// the plugin API, so an update of the app can break this file.

// Sessions that were created but not yet tied to their passage, by passage id. A retry uses the
// session again, so a failure does not leave one empty session per attempt.
const unbound = new Map();

/** The learner's first message in the lesson. The app also makes it the session's title. */
function openingText(passage) {
  const first = passage.sentences[0].native;
  const start = first.length > OPENING_MAX_CHARS ? `${first.slice(0, OPENING_MAX_CHARS)}…` : first;
  return t('教我「开口练习」里的这一段：{start}', { start });
}

async function createSession(title) {
  const failed = () => new Error(t('没能新建课堂会话，请再试一次。'));
  const response = await fetch('/api/chats', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) }).catch(() => { throw failed(); });
  if (!response.ok) throw failed();
  const { id } = await response.json().catch(() => ({}));
  if (typeof id !== 'string' || !SESSION_ID.test(id)) throw failed();
  return id;
}

/** Leaves the first message where the session page looks for it. */
function leaveOpening(chatId, text) {
  const key = `lh.openingPrompt.${chatId}`;
  const value = JSON.stringify({ text, attempted: false });
  try {
    sessionStorage.setItem(key, value);
    if (sessionStorage.getItem(key) === value) return;
  } catch { /* reported below */ }
  throw new Error(t('课已经建好，但第一条消息没能留下。请打开这节课，自己发一句「开始」。'));
}

/** Creates the session for a passage's lesson and tells the backend that it belongs to the passage. */
async function bindSession(app, passage, text) {
  const chatId = unbound.get(passage.id) ?? await createSession(text);
  unbound.set(passage.id, chatId);
  const state = await app.call('start-lesson', { passageId: passage.id, chatId });
  unbound.delete(passage.id);
  app.setState(state);
  return chatId;
}

/**
 * Starts a lesson about a passage with the app's teacher and opens it. The backend is told first which
 * session belongs to the passage, so the lesson's agents get the passage from their first turn.
 * A learner who has left the screen meanwhile (`signal`) is not taken to the lesson.
 */
async function startLesson(app, passageId, signal) {
  if (!app.state.lessonAvailable) throw new Error(t('这个版本的 LearnHarness 不能把段落交给老师，请更新应用。'));
  const catalog = await app.call('get-catalog');
  if (!catalog.slots?.strong) throw new Error(t('应用里还没有配置上课用的模型，请先到应用设置里配置。'));
  const passage = app.state.passages.find(item => item.id === passageId);
  if (signal.aborted || !passage) return;
  const text = openingText(passage);
  const chatId = await bindSession(app, passage, text);
  if (signal.aborted) return;
  leaveOpening(chatId, text);
  app.ctx.app.openSession(chatId);
}

/**
 * The buttons that take a passage to the teacher: "hand to the teacher", or, once a lesson exists,
 * "open the lesson" and "start a new lesson". Errors go to `error`; `variant` is the look of the first button.
 * Returns { element, refresh }: the buttons' place in `parent`, and a redraw from the current state.
 * The buttons redraw themselves after a start, so a lesson that was created but did not open can be opened.
 */
export function mountLessonButtons(app, parent, signal, passageId, error, variant = 'outline') {
  const element = el('span', 'se-lesson');
  parent.append(element);
  let buttons = lifetime(signal);
  let starting = false;

  const start = async () => {
    if (starting) return;
    starting = true;
    error.clear();
    try {
      await startLesson(app, passageId, signal);
    } catch (cause) {
      if (!signal.aborted) error.show(cause);
    } finally {
      starting = false;
      if (!signal.aborted) refresh();
    }
  };

  function refresh() {
    buttons.abort();
    buttons = lifetime(signal);
    element.replaceChildren();
    const passage = app.state.passages.find(item => item.id === passageId);
    if (!passage) return;
    if (!passage.lesson) {
      app.ui.button(element, t('交给老师'), start, buttons.signal, { variant });
      return;
    }
    app.ui.button(element, t('打开这节课'), () => app.ctx.app.openSession(passage.lesson.chatId), buttons.signal);
    app.ui.confirmButton(element, t('重新开课'), start, buttons.signal, { variant: 'ghost' });
  }

  refresh();
  return { element, refresh };
}
