import { el, errorLine, errorText, lifetime } from './dom.js';
import { recordWavFor } from './recorder.js';
import { toBase64 } from './wav.js';
import { scoreLine } from './word-marking.js';
import { LANGUAGES, mark, setLanguage, t } from './i18n.js';

const TTS_MODELS = ['eleven_v4', 'eleven_v4_turbo', 'eleven_v3', 'eleven_multilingual_v2', 'eleven_flash_v2_5'];
const VOICE_HINT = mark('ElevenLabs 的声音 ID。Jessica：cgSgspJ2msm6clMCkdW9；Eric：cjVigY5qzO86Huf0OWal');
const MIC_TEST_SENTENCE = "I'll tell him about it.";
const MIC_TEST_MS = 4000;
// Shown in their own language whatever the interface language is.
const LANGUAGE_NAMES = { zh: '中文', en: 'English' };

/** One key: whether it is set, a field to paste a new one, save and clear. The stored value is never shown. */
function secretRow(env, parent, name, label) {
  const row = el('div', 'se-secret');
  const status = el('span', 'se-secret-status');
  const input = el('input', 'se-input');
  input.type = 'password';
  input.autocomplete = 'off';
  input.placeholder = t('粘贴密钥');
  input.setAttribute('aria-label', label);
  const heading = el('div', 'se-secret-heading');
  heading.append(el('span', 'se-label', label), status);
  const controls = el('div', 'se-actions');
  controls.append(input);
  row.append(heading, controls);
  parent.append(row);
  env.ui.button(controls, t('保存'), env.guarded(async () => {
    env.apply(await env.ctx.call('set-secret', { name, value: input.value }));
    input.value = '';
  }), env.signal);
  env.ui.button(controls, t('清除'), env.guarded(async () => env.apply(await env.ctx.call('clear-secret', { name }))), env.signal, { variant: 'ghost' });
  return state => {
    status.textContent = state.secrets[name] ? t('已设置') : t('未设置');
    status.classList.toggle('se-set', state.secrets[name]);
  };
}

function settingsRows(env, settings) {
  const row = (key, label, value, type, extras = {}, parse = input => input) => ({
    key, label, value, type, ...extras,
    onChange: async input => {
      try { env.apply(await env.ctx.call('save-settings', { [key]: parse(input) })); env.error.clear(); }
      catch (cause) { env.error.show(cause); throw cause; }
    },
  });
  return [
    row('language', '界面语言 / Language', settings.language, 'dropdown', { description: t('切换后，侧边栏入口和页面标题要重启应用才更新。'), options: LANGUAGES.map(value => ({ value, label: LANGUAGE_NAMES[value] })) }),
    row('azureRegion', t('Azure 区域'), settings.azureRegion, 'text', { description: t('创建 Azure 语音资源时选的区域，例如 swedencentral') }, input => input.trim()),
    row('ttsModel', t('语音模型'), settings.ttsModel, 'dropdown', { options: TTS_MODELS.map(value => ({ value, label: value })) }),
    row('ttsVoiceId', t('声音'), settings.ttsVoiceId, 'text', { description: t(VOICE_HINT) }, input => input.trim()),
    row('questionVoiceId', t('问句的声音'), settings.questionVoiceId, 'text', { description: t('「接话」练习里提问的声音，最好和上面的不同') }, input => input.trim()),
    row('dailyReviewLimit', t('每日复习上限（次）'), settings.dailyReviewLimit, 'number', { min: 1, max: 500, step: 1 }, Number),
    row('retention', t('目标保持率（%）'), Math.round(settings.retention * 100), 'number', { min: 70, max: 99, step: 1 }, input => Number(input) / 100),
    row('readingCharsPerSecond', t('读题速度（每秒几个字）'), settings.readingCharsPerSecond, 'number', { min: 1, max: 20, step: 1, description: t('开始时限 = 中文字数 ÷ 读题速度 + 思考时间') }, Number),
    row('startAllowanceSeconds', t('思考时间（秒）'), settings.startAllowanceSeconds, 'number', { min: 0, max: 30, step: 1 }, Number),
    row('speakingTimeFactor', t('说话时限（原声时长的几倍）'), settings.speakingTimeFactor, 'number', { min: 1, max: 5, step: 0.5 }, Number),
    row('explainAfterFailures', t('几次没说出来后提示讲解'), settings.explainAfterFailures, 'number', { min: 1, max: 20, step: 1 }, Number),
  ];
}

/** Translation model: follow the app's cheap slot, or pick one for this plugin. */
function modelSection(env, parent) {
  const toggleSlot = el('div');
  const pickerSlot = el('div', 'se-model-picker');
  parent.append(toggleSlot, pickerSlot);
  const save = patch => env.guarded(async () => env.apply(await env.ctx.call('save-settings', patch)))();
  let choosing = false;
  const toggleRow = settings => ({
    key: 'followCheap', label: t('翻译和讲解用的模型'), description: t('跟随应用的 cheap 档'), type: 'toggle', value: !settings.modelOverride && !choosing,
    onChange: async follow => {
      choosing = !follow;
      if (follow) await save({ modelOverride: null });
      else update(env.state());
    },
  });
  const toggle = env.ui.widget(env.ctx.ui.mountSettingsRows(toggleSlot, { rows: [toggleRow(env.state().settings)] }, { signal: env.signal }), env.signal);
  const picker = env.ui.widget(env.ctx.ui.mountModelPicker(pickerSlot, {
    value: env.state().settings.modelOverride ?? undefined,
    onChange: async value => { choosing = false; await save({ modelOverride: value }); },
  }, { signal: env.signal }), env.signal);
  function update(state) {
    toggle.update({ rows: [toggleRow(state.settings)] });
    picker.update({ value: state.settings.modelOverride ?? undefined });
    pickerSlot.hidden = !state.settings.modelOverride && !choosing;
  }
  return update;
}

function describeAssessment(assessment) {
  const words = assessment.words.map(word => (word.errorType === 'None' ? word.word : `${word.word} (${word.errorType})`)).join(' ');
  return `${t('麦克风和评分都正常。')}${scoreLine(assessment.scores)}\n${words}`;
}

/** Records a fixed sentence and scores it: checks the microphone, the Azure key and the region in one go. */
function microphoneTest(env, parent) {
  const box = el('div', 'se-mic-test');
  box.append(el('span', 'se-label', t('测试麦克风和评分')), el('p', 'se-muted', t('点按钮后，在 {seconds} 秒内读出：{sentence}', { seconds: MIC_TEST_MS / 1000, sentence: MIC_TEST_SENTENCE })));
  const actions = el('div', 'se-actions');
  const result = el('p', 'se-mic-result');
  box.append(actions, result);
  parent.append(box);
  env.ui.button(actions, t('录 {seconds} 秒并评分', { seconds: MIC_TEST_MS / 1000 }), async () => {
    result.classList.remove('se-error');
    try {
      result.textContent = t('正在录音，请读出上面的句子…');
      const { wav } = await recordWavFor(MIC_TEST_MS, env.signal);
      if (env.signal.aborted) return;
      result.textContent = t('正在评分…');
      const assessment = await env.ctx.call('assess', { wavBase64: toBase64(wav), referenceText: MIC_TEST_SENTENCE });
      if (!env.signal.aborted) result.textContent = describeAssessment(assessment);
    } catch (cause) {
      if (env.signal.aborted) return;
      result.classList.add('se-error');
      result.textContent = errorText(cause);
    }
  }, env.signal);
}

/** The plugin's settings page. */
export function mountSettings(ctx, ui, container, hostSignal) {
  const scope = lifetime(hostSignal, ctx.signal);
  const root = el('div', 'se-root se-settings');
  container.append(root);
  let state = null;
  // The page is built again when the interface language changes; `page` ends the previous build's widgets.
  let page = lifetime(scope.signal);
  let updaters = [];
  const env = {
    ctx, ui,
    get signal() { return page.signal; },
    state: () => state,
    apply(next) {
      if (scope.signal.aborted || !next) return;
      const languageChanged = next.settings.language !== state.settings.language;
      state = next;
      for (const update of updaters) update(state);
      // Not from inside the host widget that reported the change: it is about to be replaced.
      if (languageChanged) setTimeout(() => { if (!scope.signal.aborted) build(); }, 0);
    },
    guarded: action => async () => { try { await action(); env.error.clear(); } catch (cause) { if (!scope.signal.aborted) env.error.show(cause); } },
  };

  function build() {
    page.abort();
    page = lifetime(scope.signal);
    updaters = [];
    setLanguage(state.settings.language);
    root.replaceChildren();
    root.append(el('h3', 'se-subtitle', t('密钥')), el('p', 'se-muted', t('密钥只保存在这台电脑上的插件数据目录里，保存后不再显示。')));
    updaters.push(secretRow(env, root, 'elevenLabsKey', t('ElevenLabs 密钥（合成语音）')));
    updaters.push(secretRow(env, root, 'azureKey', t('Azure 语音密钥（发音评分）')));
    const rowsSlot = el('div');
    root.append(el('h3', 'se-subtitle', t('语音和练习')), rowsSlot);
    const rows = ui.widget(ctx.ui.mountSettingsRows(rowsSlot, { rows: settingsRows(env, state.settings) }, { signal: page.signal }), page.signal);
    updaters.push(next => rows.update({ rows: settingsRows(env, next.settings) }));
    updaters.push(modelSection(env, root));
    env.error = errorLine(root);
    microphoneTest(env, root);
    env.apply(state);
  }

  ctx.call('get-state').then(loaded => {
    if (scope.signal.aborted) return;
    state = loaded;
    build();
  }, cause => { if (!scope.signal.aborted) root.append(el('p', 'se-error', errorText(cause))); });

  return () => { scope.abort(); root.remove(); };
}
