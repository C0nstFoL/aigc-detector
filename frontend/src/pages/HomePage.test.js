import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import HomePage from './HomePage';
import { checkHealth, detectAIGC, getModels } from '../services/api';
import { addHistory, createHistoryEntry, HISTORY_STORAGE_KEY, readHistory } from '../services/history';

jest.mock('../services/api');
jest.mock('../components/FeatureRadarChart', () => () => null);
jest.mock('../components/FeatureTable', () => () => null);
jest.mock('../components/FeatureContributionTable', () => () => null);

const text = '这是用于验证网页模型切换的完整测试文本，切换模型后应该保留原始输入，并且清除上一次模型的检测结果。'.repeat(3);
const models = [
  { key: 'default', name: '默认 · 轻量模型', description: '无需下载' },
  { key: 'zh', name: '中文 · zhV3', description: '适合中文' },
  { key: 'en', name: '英文 · n4.0', description: '适合英文' },
];

beforeAll(() => {
  window.matchMedia = () => ({
    matches: false,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  });
});

beforeEach(() => {
  jest.resetAllMocks();
  window.localStorage.clear();
  checkHealth.mockResolvedValue({ min_text_length: 50 });
  getModels.mockResolvedValue({ models, default_model: 'default' });
  detectAIGC.mockImplementation(async (_text, _details, key) => ({
    aigc_score: 30,
    confidence: 80,
    score_threshold: 50,
    label: 'human',
    processing_time: 0.1,
    features: {},
    warnings: [],
    selected_model: models.find((item) => item.key === key),
  }));
});

async function chooseModel(name) {
  const option = await screen.findByRole('radio', { name });
  await waitFor(() => expect(option).not.toBeDisabled());
  fireEvent.click(option);
}

test('switching languages submits the selected model, clears the old result and keeps the input', async () => {
  render(<HomePage />);
  const input = screen.getByPlaceholderText(/请输入需要检测的文本内容/);
  fireEvent.change(input, { target: { value: text } });
  await chooseModel('中文 · zhV3');
  fireEvent.click(screen.getByRole('button', { name: /开始检测/ }));
  await screen.findByRole('heading', { name: '检测结果' });
  expect(detectAIGC).toHaveBeenLastCalledWith(text, true, 'zh');
  expect(screen.getByText('检测模型：')).toHaveTextContent('中文 · zhV3');

  await chooseModel('英文 · n4.0');
  expect(input).toHaveValue(text);
  expect(screen.queryByRole('heading', { name: '检测结果' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /开始检测/ }));
  await screen.findByRole('heading', { name: '检测结果' });
  expect(detectAIGC).toHaveBeenLastCalledWith(text, true, 'en');
  expect(screen.getByText('检测模型：')).toHaveTextContent('英文 · n4.0');
});

test('a failed model request shows its error without keeping an earlier score', async () => {
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    render(<HomePage />);
    await chooseModel('中文 · zhV3');
    fireEvent.change(screen.getByPlaceholderText(/请输入需要检测的文本内容/), { target: { value: text } });
    fireEvent.click(screen.getByRole('button', { name: /开始检测/ }));
    await screen.findByRole('heading', { name: '检测结果' });
    await waitFor(() => expect(screen.getByRole('button', { name: /开始检测/ })).not.toHaveClass('ant-btn-loading'));
    detectAIGC.mockRejectedValueOnce(new Error('所选模型加载失败'));
    fireEvent.click(screen.getByRole('button', { name: /开始检测/ }));
    await waitFor(() => expect(detectAIGC).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('所选模型加载失败'));
    expect(screen.queryByRole('heading', { name: '检测结果' })).not.toBeInTheDocument();
    expect(readHistory()).toHaveLength(1);
  } finally {
    consoleError.mockRestore();
  }
});

test('successful detection survives a remount and restores text, selected model and result without rerunning', async () => {
  const { unmount } = render(<HomePage />);
  await chooseModel('中文 · zhV3');
  fireEvent.change(screen.getByPlaceholderText(/请输入需要检测的文本内容/), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: /开始检测/ }));
  await screen.findByRole('heading', { name: '检测结果' });
  expect(readHistory()).toHaveLength(1);
  expect(readHistory()[0].text).toBe(text);
  unmount();

  render(<HomePage />);
  const view = screen.getByRole('button', { name: '查看结果' });
  await waitFor(() => expect(view).not.toBeDisabled());
  expect(screen.queryByRole('heading', { name: '检测结果' })).not.toBeInTheDocument();
  fireEvent.click(view);
  await screen.findByRole('heading', { name: '检测结果' });
  expect(screen.getByPlaceholderText(/请输入需要检测的文本内容/)).toHaveValue(text);
  expect(screen.getByText('检测模型：')).toHaveTextContent('中文 · zhV3');
  expect(screen.getByText(/历史结果 ·/)).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: '中文 · zhV3' })).toBeChecked();
  expect(detectAIGC).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole('button', { name: /开始检测/ }));
  await waitFor(() => expect(detectAIGC).toHaveBeenCalledTimes(2));
  expect(detectAIGC).toHaveBeenLastCalledWith(text, true, 'zh');
  await screen.findByRole('heading', { name: '检测结果' });
});

test('deleting and clearing history preserves unrelated storage and the current input', async () => {
  const result = await detectAIGC(text, true, 'en');
  addHistory(createHistoryEntry('older record', 'en', '英文模型', result));
  addHistory(createHistoryEntry('newer record', 'en', '英文模型', result));
  window.localStorage.setItem('unrelated-setting', 'keep');
  render(<HomePage />);
  const remove = screen.getAllByRole('button', { name: '删除记录' })[0];
  await waitFor(() => expect(remove).not.toBeDisabled());
  fireEvent.change(screen.getByPlaceholderText(/请输入需要检测的文本内容/), { target: { value: '当前输入需要保留' } });
  fireEvent.click(remove);
  expect(readHistory().map((record) => record.text)).toEqual(['older record']);

  fireEvent.click(screen.getByRole('button', { name: '清空历史' }));
  fireEvent.click(await screen.findByRole('button', { name: '确认清空' }));
  await waitFor(() => expect(readHistory()).toHaveLength(0));
  expect(await screen.findByText('暂无检测历史')).toBeInTheDocument();
  expect(window.localStorage.getItem('unrelated-setting')).toBe('keep');
  expect(screen.getByPlaceholderText(/请输入需要检测的文本内容/)).toHaveValue('当前输入需要保留');
});

test('failed history persistence still shows the successful detection result', async () => {
  const write = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('Full', 'QuotaExceededError');
  });
  try {
    render(<HomePage />);
    await chooseModel('中文 · zhV3');
    fireEvent.change(screen.getByPlaceholderText(/请输入需要检测的文本内容/), { target: { value: text } });
    fireEvent.click(screen.getByRole('button', { name: /开始检测/ }));
    await screen.findByRole('heading', { name: '检测结果' });
    expect(screen.getByText(/检测成功，但历史记录保存失败/)).toBeInTheDocument();
    expect(readHistory()).toEqual([]);
  } finally {
    write.mockRestore();
  }
});

test('corrupted history can be cleared and records from another tab are refreshed', async () => {
  window.localStorage.setItem(HISTORY_STORAGE_KEY, 'broken');
  render(<HomePage />);
  expect(screen.getByText(/历史记录读取失败/)).toBeInTheDocument();
  const clear = screen.getByRole('button', { name: '清空历史' });
  await waitFor(() => expect(clear).not.toBeDisabled());
  fireEvent.click(clear);
  fireEvent.click(await screen.findByRole('button', { name: '确认清空' }));
  await waitFor(() => expect(window.localStorage.getItem(HISTORY_STORAGE_KEY)).toBeNull());

  const result = await detectAIGC(text, true, 'en');
  addHistory(createHistoryEntry('其他标签页的记录', 'en', '英文模型', result));
  fireEvent(window, new StorageEvent('storage', { key: HISTORY_STORAGE_KEY }));
  expect(await screen.findByText('其他标签页的记录')).toBeInTheDocument();
});

test('model list failure disables detection instead of silently using another model', async () => {
  getModels.mockRejectedValueOnce(new Error('offline'));
  render(<HomePage />);
  await screen.findByText('模型列表加载失败，请刷新页面重试');
  expect(screen.getByRole('button', { name: /开始检测/ })).toBeDisabled();
  expect(detectAIGC).not.toHaveBeenCalled();
});
