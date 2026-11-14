'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { atomicWrite } = require('./atomic-write.cjs');
const { defaultSettings } = require('./settings.cjs');
const { upgradeFromVersion1 } = require('./store-upgrade.cjs');
const { t } = require('./messages.cjs');

const STORE_VERSION = 2;
const VERSION_1_BACKUP = 'store.v1.json';
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

const emptyState = () => ({ version: STORE_VERSION, revision: 0, settings: defaultSettings(), passages: {}, sentences: {}, attempts: [] });

const hasStoreShape = state => isRecord(state) && Number.isSafeInteger(state.revision)
  && isRecord(state.settings) && isRecord(state.passages) && isRecord(state.sentences) && Array.isArray(state.attempts);

const isValidState = state => hasStoreShape(state) && state.version === STORE_VERSION;

/** Keeps the version 1 file beside the store before it is upgraded, once. The upgraded state is written on the next change. */
function keepVersion1(file, text) {
  const backup = path.join(path.dirname(file), VERSION_1_BACKUP);
  if (!fs.existsSync(backup)) atomicWrite(backup, text);
}

function readState(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return emptyState();
    throw new Error(t('读不了练习数据：{reason}', { reason: error.message }));
  }
  let state;
  try { state = JSON.parse(text); } catch { state = null; }
  if (hasStoreShape(state) && state.version === 1) {
    keepVersion1(file, text);
    upgradeFromVersion1(state);
  }
  if (!isValidState(state)) throw new Error(t('练习数据文件损坏或版本不支持，没有做任何改动。'));
  // Settings added in a later release get their default without rewriting the file.
  state.settings = { ...defaultSettings(), ...state.settings };
  return state;
}

/**
 * Opens the plugin's single JSON store in `directory`.
 * `get()` returns the current state (do not mutate it); `change(update)` applies
 * `update` to a copy, writes it atomically, and returns what `update` returned.
 * A throwing `update` changes nothing.
 */
function openStore(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'store.json');
  let state = readState(file);
  return {
    get: () => state,
    change(update) {
      const next = structuredClone(state);
      const result = update(next);
      next.revision += 1;
      atomicWrite(file, JSON.stringify(next));
      state = next;
      return result;
    },
  };
}

module.exports = { openStore };
