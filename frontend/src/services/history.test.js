import {
  addHistory, clearHistory, createHistoryEntry, deleteHistory,
  HISTORY_LIMIT, HISTORY_STORAGE_KEY, readHistory,
} from './history';

const result = {
  aigc_score: 12.5, confidence: 85, score_threshold: 50, label: 'human',
  features: { lexical_diversity: 0.75 },
  selected_model: { key: 'zh', name: '中文 · zhV3', model_id: 'example/zh', device: 'cuda' },
  details: { transformer_probability: 0.125, transformer_weight: 1 },
};
const entry = (id) => ({ ...createHistoryEntry('这是需要保存的完整原文。', 'zh', '中文模型', result), id });

beforeEach(() => window.localStorage.clear());
afterEach(() => jest.restoreAllMocks());

test('persists original text, timestamp, model identity and full report', () => {
  const record = entry('one');
  addHistory(record);
  expect(readHistory()).toEqual([record]);
  expect(record.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(record.modelName).toBe('中文 · zhV3');
  expect(readHistory()[0].result.details).toEqual(result.details);
});

test('keeps separate runs of the same text and limits storage to the newest 50 records', () => {
  for (let index = 0; index < HISTORY_LIMIT + 2; index += 1) addHistory(entry(String(index)));
  const records = readHistory();
  expect(records).toHaveLength(HISTORY_LIMIT);
  expect(records[0].id).toBe('51');
  expect(records[records.length - 1].id).toBe('2');
});

test('writes use the latest storage rather than an older tab snapshot', () => {
  addHistory(entry('first-tab'));
  const earlier = readHistory();
  addHistory(entry('other-tab'));
  addHistory(entry('first-tab-new'));
  expect(earlier).toHaveLength(1);
  expect(readHistory().map((record) => record.id)).toEqual(['first-tab-new', 'other-tab', 'first-tab']);
});

test('deletes a single record and clears only detection history', () => {
  window.localStorage.setItem('unrelated-setting', 'keep');
  addHistory(entry('one'));
  addHistory(entry('two'));
  expect(deleteHistory('one').map((record) => record.id)).toEqual(['two']);
  clearHistory();
  expect(readHistory()).toEqual([]);
  expect(window.localStorage.getItem('unrelated-setting')).toBe('keep');
});

test('rejects unreadable storage and skips malformed records', () => {
  window.localStorage.setItem(HISTORY_STORAGE_KEY, '{broken json');
  expect(readHistory).toThrow();
  window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify([null, {}, entry('valid')]));
  expect(readHistory().map((record) => record.id)).toEqual(['valid']);
});

test('storage quota failure leaves earlier history intact', () => {
  addHistory(entry('saved'));
  const write = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('Full', 'QuotaExceededError');
  });
  expect(() => addHistory(entry('unsaved'))).toThrow();
  write.mockRestore();
  expect(readHistory().map((record) => record.id)).toEqual(['saved']);
});
