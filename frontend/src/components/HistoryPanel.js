import React from 'react';
import { Alert, Button, Card, Empty, List, Popconfirm, Space, Tag, Typography } from 'antd';
import { DeleteOutlined, HistoryOutlined } from '@ant-design/icons';
import { HISTORY_LIMIT } from '../services/history';

const { Paragraph } = Typography;

export const formatHistoryTime = (value) => new Date(value).toLocaleString('zh-CN', { hour12: false });

const HistoryPanel = ({ entries, error, disabled, onView, onDelete, onClear }) => (
  <Card
    className="mt-20"
    title={<span><HistoryOutlined /> 检测历史（{entries.length}）</span>}
    extra={
      <Popconfirm
        title="清空全部历史记录？"
        description="将删除当前浏览器保存的全部检测记录。"
        onConfirm={onClear}
        okText="确认清空"
        cancelText="取消"
        disabled={disabled || (!entries.length && !error)}
      >
        <Button danger size="small" disabled={disabled || (!entries.length && !error)}>清空历史</Button>
      </Popconfirm>
    }
  >
    <Paragraph type="secondary">
      记录保存在当前浏览器，最多保留最近 {HISTORY_LIMIT} 条。查看记录可恢复原文、模型选择和当时的检测结果。
    </Paragraph>
    {error && <Alert type="warning" showIcon message={error} style={{ marginBottom: 16 }} />}
    <List
      rowKey="id"
      dataSource={entries}
      pagination={entries.length > 5 ? { pageSize: 5, showSizeChanger: false, hideOnSinglePage: true } : false}
      locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无检测历史" /> }}
      renderItem={(entry) => (
        <List.Item
          actions={[
            <Button key="view" type="link" disabled={disabled} onClick={() => onView(entry)}>查看结果</Button>,
            <Button key="delete" type="text" danger icon={<DeleteOutlined />} aria-label="删除记录"
              disabled={disabled} onClick={() => onDelete(entry.id)} />,
          ]}
        >
          <List.Item.Meta
            title={
              <Space wrap>
                <time dateTime={entry.createdAt}>{formatHistoryTime(entry.createdAt)}</time>
                <Tag color="blue">{entry.modelName}</Tag>
                <Tag color={entry.result.label === 'ai' ? 'orange' : 'green'}>
                  {entry.result.label === 'ai' ? 'AI生成' : '人工创作'} · {entry.result.aigc_score}%
                </Tag>
              </Space>
            }
            description={<Paragraph ellipsis={{ rows: 2 }} style={{ marginBottom: 0 }}>{entry.text}</Paragraph>}
          />
        </List.Item>
      )}
    />
  </Card>
);

export default HistoryPanel;
