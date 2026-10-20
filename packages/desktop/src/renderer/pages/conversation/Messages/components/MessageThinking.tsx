/**
 * 文件：Messages/components/MessageThinking.tsx
 * 职责：默认折叠思考正文，保留真实状态和手动展开。
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IMessageThinking } from '@/common/chat/chatLib';
import { Button, Spin } from '@arco-design/web-react';
import { Brain, Right } from '@icon-park/react';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './MessageThinking.module.css';

const MessageThinking: React.FC<{ message: IMessageThinking }> = ({ message }) => {
  const { t } = useTranslation();

  const formatDuration = (ms: number): string => {
    const seconds = Math.floor(ms / 1000);
    const sUnit = t('common.unit.second_short', { defaultValue: 's' });
    const mUnit = t('common.unit.minute_short', { defaultValue: 'm' });

    if (seconds < 60) return `${seconds}${sUnit}`;
    const minutes = Math.floor(seconds / 60);
    const remaining = seconds % 60;
    return `${minutes}${mUnit} ${remaining}${sUnit}`;
  };

  const formatElapsedTime = (seconds: number): string => {
    const sUnit = t('common.unit.second_short', { defaultValue: 's' });
    const mUnit = t('common.unit.minute_short', { defaultValue: 'm' });

    if (seconds < 60) return `${seconds}${sUnit}`;
    const minutes = Math.floor(seconds / 60);
    const remaining = seconds % 60;
    return `${minutes}${mUnit} ${remaining}${sUnit}`;
  };

  const { content: text, status, subject } = message.content;
  const duration = message.content.duration ?? (message.content as { duration_ms?: number }).duration_ms;
  const isDone = status === 'done';
  const [expanded, setExpanded] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(() => {
    const initialStartedAt = message.created_at ?? Date.now();
    return isDone ? 0 : Math.max(0, Math.floor((Date.now() - initialStartedAt) / 1000));
  });
  const startTimeRef = useRef<number>(message.created_at ?? Date.now());
  const bodyRef = useRef<HTMLDivElement>(null);

  // Elapsed timer for active thinking
  useEffect(() => {
    if (isDone) return;

    startTimeRef.current = message.created_at ?? Date.now();
    setElapsedTime(Math.max(0, Math.floor((Date.now() - startTimeRef.current) / 1000)));
    const timer = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);

    return () => clearInterval(timer);
  }, [isDone, message.created_at, message.msg_id]);

  // Auto-scroll to bottom during streaming
  useEffect(() => {
    if (!isDone && expanded && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [text, isDone, expanded]);

  const summaryText = isDone
    ? `${t('conversation.thinking.complete', { defaultValue: 'Thought complete' })} · ${formatDuration(duration || 0)}`
    : `${subject || t('conversation.thinking.label', { defaultValue: 'Thinking...' })} · ${formatElapsedTime(elapsedTime)}`;

  return (
    <div className={styles.container}>
      <Button
        type='text'
        htmlType='button'
        className={styles.header}
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className={styles.headerIcon}>{!isDone ? <Spin size={12} /> : <Brain theme='outline' size='14' />}</span>
        <span className={styles.summary}>{summaryText}</span>
        <span className={`${styles.arrow} ${expanded ? styles.arrowExpanded : ''}`}>
          <Right theme='outline' size='12' />
        </span>
      </Button>
      <div ref={bodyRef} hidden={!expanded} className={`${styles.body} ${!expanded ? styles.collapsed : ''}`}>
        {text}
      </div>
    </div>
  );
};

export default MessageThinking;
