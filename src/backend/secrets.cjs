'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { atomicWrite } = require('./atomic-write.cjs');
const { t } = require('./messages.cjs');

const SECRET_NAMES = Object.freeze(['azureKey', 'elevenLabsKey']);
const SECRET_MAX_CHARS = 200;

function requireName(name) {
  if (!SECRET_NAMES.includes(name)) throw new Error(t('不认识的密钥名称。'));
  return name;
}

function requireValue(value) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed === '') throw new Error(t('密钥不能为空。'));
  if (trimmed.length > SECRET_MAX_CHARS || !/^[\x21-\x7e]+$/.test(trimmed)) throw new Error(t('密钥里有空格或不该出现的字符，请重新粘贴。'));
  return trimmed;
}

function readSecrets(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error(t('读不了密钥文件，请在设置里重新填写密钥。'));
  }
}

/**
 * The two service keys, kept in their own owner-only file in the plugin's data
 * directory. Values are read by the backend only; `status()` is all the
 * frontend ever sees.
 */
function openSecrets(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'secrets.json');
  const write = secrets => atomicWrite(file, JSON.stringify(secrets));
  return {
    get(name) {
      const value = readSecrets(file)[requireName(name)];
      return typeof value === 'string' ? value : '';
    },
    set(name, value) { write({ ...readSecrets(file), [requireName(name)]: requireValue(value) }); },
    clear(name) {
      const secrets = readSecrets(file);
      delete secrets[requireName(name)];
      write(secrets);
    },
    status() {
      const secrets = readSecrets(file);
      return Object.fromEntries(SECRET_NAMES.map(name => [name, typeof secrets[name] === 'string' && secrets[name] !== '']));
    },
  };
}

module.exports = { openSecrets, SECRET_NAMES };
