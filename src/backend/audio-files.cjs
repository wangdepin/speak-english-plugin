'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { atomicWrite } = require('./atomic-write.cjs');
const { t } = require('./messages.cjs');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const READING_SLOTS = Object.freeze(['first', 'latest']);

/**
 * Reference audio lives at <directory>/audio/<sentence id>.mp3; the learner's whole-passage readings at
 * <directory>/readings/<passage id>.<slot>. Ids are checked because they become file names.
 */
function openAudioFiles(directory) {
  const folder = path.join(directory, 'audio');
  const readings = path.join(directory, 'readings');
  const readingFile = (passageId, slot) => {
    if (typeof passageId !== 'string' || !UUID.test(passageId)) throw new Error(t('段落编号无效。'));
    if (!READING_SLOTS.includes(slot)) throw new Error(t('录音位置无效。'));
    return path.join(readings, `${passageId}.${slot}`);
  };
  const removeFile = file => {
    try { fs.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  };
  const fileFor = sentenceId => {
    if (typeof sentenceId !== 'string' || !UUID.test(sentenceId)) throw new Error(t('句子编号无效。'));
    return path.join(folder, `${sentenceId}.mp3`);
  };
  return {
    write(sentenceId, bytes) {
      const file = fileFor(sentenceId);
      fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
      atomicWrite(file, bytes);
    },
    read(sentenceId) { return new Uint8Array(fs.readFileSync(fileFor(sentenceId))); },
    remove(sentenceId) { removeFile(fileFor(sentenceId)); },
    writeReading(passageId, slot, bytes) {
      const file = readingFile(passageId, slot);
      fs.mkdirSync(readings, { recursive: true, mode: 0o700 });
      atomicWrite(file, bytes);
    },
    readReading(passageId, slot) { return new Uint8Array(fs.readFileSync(readingFile(passageId, slot))); },
    removeReadings(passageId) { for (const slot of READING_SLOTS) removeFile(readingFile(passageId, slot)); },
  };
}

module.exports = { openAudioFiles, READING_SLOTS };
