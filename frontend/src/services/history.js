export const HISTORY_STORAGE_KEY = 'aigc-detector:history:v1';
export const HISTORY_LIMIT = 50;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const isEntry = (entry) => (
  isObject(entry) &&
  typeof entry.id === 'string' &&
  typeof entry.text === 'string' &&
  typeof entry.model === 'string' &&
  typeof entry.modelName === 'string' &&
  typeof entry.createdAt === 'string' &&
  Number.isFinite(Date.parse(entry.createdAt)) &&
  isObject(entry.result) &&
  ['aigc_score', 'confidence', 'score_threshold'].every((key) => Number.isFinite(entry.result[key])) &&
  ['ai', 'human'].includes(entry.result.label) &&
  isObject(entry.result.features)
);

export const readHistory = () => {
  const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
  if (raw === null) return [];
  const entries = JSON.parse(raw);
  if (!Array.isArray(entries)) throw new Error('Invalid detection history');
  return entries.filter(isEntry).slice(0, HISTORY_LIMIT);
};

export const createHistoryEntry = (text, model, modelName, result) => ({
  id: window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  createdAt: new Date().toISOString(),
  text,
  model: result.selected_model?.key || model,
  modelName: result.selected_model?.name || modelName,
  result,
});

export const addHistory = (entry) => {
  // Read the latest records so an already-open tab does not overwrite newer ones.
  const entries = [entry, ...readHistory()].slice(0, HISTORY_LIMIT);
  window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(entries));
  return entries;
};

export const deleteHistory = (id) => {
  const entries = readHistory().filter((entry) => entry.id !== id);
  window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(entries));
  return entries;
};

export const clearHistory = () => {
  window.localStorage.removeItem(HISTORY_STORAGE_KEY);
  return [];
};
