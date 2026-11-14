// Phase 6 throwaway frontend: starts a lesson the way the host's own home page does
// (create the session, leave the first message for the session page to send), then opens it.
const OPENING = 'Teach me this passage from Speaking practice: "Let\'s call it a day."';

async function startLesson(ctx) {
  const response = await fetch('/api/chats', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: OPENING }) });
  if (!response.ok) throw new Error(`POST /api/chats answered ${response.status}`);
  const { id } = await response.json();
  // The session page sends this as the learner's first message when it opens.
  sessionStorage.setItem(`lh.openingPrompt.${id}`, JSON.stringify({ text: OPENING, attempted: false }));
  await ctx.call('bind', { chatId: id });
  return id;
}

function mount(ctx, container) {
  const button = document.createElement('button');
  button.dataset.spike = 'start';
  button.textContent = 'Start a lesson';
  const output = document.createElement('pre');
  button.addEventListener('click', async () => {
    try {
      const chatId = await startLesson(ctx);
      window.__spike = { chatId };
      ctx.app.openSession(chatId);
    } catch (error) {
      window.__spike = { error: String(error) };
      output.textContent = String(error);
    }
  });
  container.append(button, output);
  return () => { button.remove(); output.remove(); };
}

export async function activate(ctx) {
  const unregister = ctx.registerView({ id: 'spike', name: 'Hand-off spike', mount: container => mount(ctx, container) });
  ctx.cleanup(unregister);
  return unregister;
}
