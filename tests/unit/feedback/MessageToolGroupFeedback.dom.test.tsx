/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Verifies MessageToolGroup renders the FeedbackButton only when a tool call
 * has status='Error' and wires it to module=conversation-session.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, options?: { defaultValue?: string }) => options?.defaultValue || k,
    i18n: { language: 'en' },
  }),
}));

const imageMocks = vi.hoisted(() => ({
  openPreview: vi.fn(),
  getImageBase64: vi.fn(),
  getFileMetadata: vi.fn(),
  getContentMetadata: vi.fn(),
  readContent: vi.fn(),
}));

vi.mock('@/renderer/pages/conversation/Preview/context/PreviewContext', () => ({
  usePreviewContext: () => ({ openPreview: imageMocks.openPreview }),
}));
vi.mock('@/renderer/services/clientBusinessSettings', () => ({
  getClientBusinessSetting: () => Promise.resolve(undefined),
}));

const openFeedbackMock = vi.fn(() => Promise.resolve());
vi.mock('@/renderer/hooks/context/FeedbackContext', () => ({
  useFeedback: () => ({ openFeedback: openFeedbackMock }),
}));

// Stub heavy dependencies that MessageToolGroup pulls in so this test can
// render in pure jsdom without the whole app tree.
vi.mock('@renderer/components/chat/CollapsibleContent', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@renderer/components/Markdown', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@renderer/components/media/LocalImageView', () => ({
  default: () => null,
}));
vi.mock('@/renderer/components/base/FileChangesPanel', () => ({
  default: () => null,
}));
vi.mock('@/renderer/hooks/file/useDiffPreviewHandlers', () => ({
  useDiffPreviewHandlers: () => ({ openDiff: () => {}, openFile: () => {} }),
}));
vi.mock('@/common', () => ({
  ipcBridge: {
    fs: {
      getImageBase64: { invoke: imageMocks.getImageBase64 },
      getFileMetadata: { invoke: imageMocks.getFileMetadata },
      getContentMetadata: { invoke: imageMocks.getContentMetadata },
      readContent: { invoke: imageMocks.readContent },
    },
    acpConversation: { respondToConfirmation: { invoke: vi.fn() } },
    conversation: { respondToConfirmation: { invoke: vi.fn() } },
  },
}));

import MessageToolGroup from '@/renderer/pages/conversation/Messages/components/MessageToolGroup';
import type { IMessageToolGroup } from '@/common/chat/chatLib';
import FilePreview from '@/renderer/components/media/FilePreview';
import { ConversationProvider } from '@/renderer/hooks/context/ConversationContext';

const buildToolGroup = (status: IMessageToolGroup['content'][number]['status']): IMessageToolGroup =>
  ({
    id: 'tg-1',
    type: 'tool_group',
    content: [
      {
        call_id: 'c1',
        description: 'ran something',
        name: 'Read',
        render_output_as_markdown: false,
        status,
        result_display: 'ENOENT: no such file',
      },
    ],
  }) as IMessageToolGroup;

describe('MessageToolGroup — FeedbackButton wiring', () => {
  beforeEach(() => {
    openFeedbackMock.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('does not render FeedbackButton on successful tool calls', () => {
    render(<MessageToolGroup message={buildToolGroup('Success')} />);
    expect(screen.queryByText('settings.oneClickFeedback')).not.toBeInTheDocument();
  });

  it('does not render FeedbackButton on canceled tool calls', () => {
    render(<MessageToolGroup message={buildToolGroup('Canceled')} />);
    expect(screen.queryByText('settings.oneClickFeedback')).not.toBeInTheDocument();
  });

  it('renders FeedbackButton when status=Error', () => {
    render(<MessageToolGroup message={buildToolGroup('Error')} />);
    expect(screen.getByText('settings.oneClickFeedback')).toBeInTheDocument();
  });

  it('click opens feedback with module=conversation-session', async () => {
    const user = userEvent.setup();
    render(<MessageToolGroup message={buildToolGroup('Error')} />);
    await user.click(screen.getByText('settings.oneClickFeedback'));

    expect(openFeedbackMock).toHaveBeenCalledTimes(1);
    expect(openFeedbackMock).toHaveBeenCalledWith({
      module: 'conversation-session',
      autoScreenshot: true,
    });
  });
});

describe('conversation image preview', () => {
  const inlineImage = 'data:image/png;base64,QUJD';
  const renderGeneratedImage = (imgUrl: string, relativePath?: string) =>
    render(
      <ConversationProvider value={{ conversation_id: 'image-conversation', workspace: '/work', type: 'acp' }}>
        <MessageToolGroup
          message={{
            ...buildToolGroup('Success'),
            content: [
              {
                ...buildToolGroup('Success').content[0],
                name: 'ImageGeneration',
                result_display: { img_url: imgUrl, relative_path: relativePath },
              },
            ],
          }}
        />
      </ConversationProvider>
    );

  beforeEach(() => {
    imageMocks.openPreview.mockReset();
    imageMocks.getImageBase64.mockReset().mockResolvedValue(inlineImage);
    imageMocks.getFileMetadata.mockReset().mockResolvedValue({ size: 3 });
    imageMocks.getContentMetadata.mockReset().mockResolvedValue({ size: 3, lastModified: 123 });
    imageMocks.readContent.mockReset().mockResolvedValue(inlineImage);
  });

  afterEach(cleanup);

  it('opens an inline tool image in the right preview without inventing a file identity', async () => {
    const user = userEvent.setup();
    renderGeneratedImage(inlineImage);
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    expect(imageMocks.openPreview).toHaveBeenCalledWith(inlineImage, 'image', {
      title: 'Image',
      editable: false,
    });
    expect(imageMocks.getContentMetadata).not.toHaveBeenCalled();
    expect(imageMocks.readContent).not.toHaveBeenCalled();
    expect(document.querySelector('.arco-image-preview')).toBeNull();
    expect(screen.getByRole('img')).toHaveAttribute('width', '197');
  });

  it.each(['{Enter}', ' '])('opens a tool image through the file gate using keyboard %s', async (key) => {
    const user = userEvent.setup();
    renderGeneratedImage('/work/output.png');
    const preview = await screen.findByRole('button', { name: 'Preview' });
    preview.focus();
    await user.keyboard(key);
    await waitFor(() => expect(imageMocks.openPreview).toHaveBeenCalledTimes(1));
    expect(imageMocks.readContent).toHaveBeenCalledWith({
      file: { kind: 'local', path: '/work/output.png' },
      encoding: 'dataurl',
    });
    expect(imageMocks.openPreview).toHaveBeenCalledWith(
      inlineImage,
      'image',
      expect.objectContaining({ file_path: '/work/output.png', editable: false }),
      { replace: true }
    );
    expect(document.querySelector('.arco-image-preview')).toBeNull();
  });

  it('does not use the visible tool image to bypass a denied file read', async () => {
    imageMocks.getContentMetadata.mockRejectedValueOnce(new Error('forbidden'));
    renderGeneratedImage(inlineImage, 'output.png');
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await waitFor(() => expect(imageMocks.openPreview).toHaveBeenCalledTimes(1));
    expect(imageMocks.readContent).not.toHaveBeenCalled();
    expect(imageMocks.openPreview).toHaveBeenCalledWith(
      '',
      'image',
      expect.objectContaining({ file_path: '/work/output.png', missingFile: true, editable: false }),
      { replace: true }
    );
  });

  it('keeps attachment size and removal while opening its real file in the right preview', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    const view = render(
      <ConversationProvider value={{ conversation_id: 'image-conversation', workspace: '/work', type: 'acp' }}>
        <FilePreview path='/work/upload.png' onRemove={onRemove} />
      </ConversationProvider>
    );
    const button = screen.getByRole('button', { name: 'Preview: upload.png' });
    await waitFor(() => expect(button).toBeEnabled());
    expect(screen.getByRole('img')).toHaveAttribute('width', '60');
    expect(screen.getByRole('img')).toHaveAttribute('height', '60');
    await user.click(button);
    await waitFor(() => expect(imageMocks.openPreview).toHaveBeenCalledTimes(1));
    expect(imageMocks.getContentMetadata).toHaveBeenCalledWith({ file: { kind: 'local', path: '/work/upload.png' } });
    expect(document.querySelector('.arco-image-preview')).toBeNull();
    fireEvent.click(view.container.querySelector('.absolute')!);
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(imageMocks.openPreview).toHaveBeenCalledTimes(1);
  });

  it('applies the image size ceiling to keyboard-opened attachments', async () => {
    imageMocks.getContentMetadata.mockResolvedValueOnce({ size: 21 * 1024 * 1024, lastModified: 123 });
    const user = userEvent.setup();
    render(
      <ConversationProvider value={{ conversation_id: 'image-conversation', workspace: '/work', type: 'acp' }}>
        <FilePreview path='/work/large.png' onRemove={() => {}} readonly />
      </ConversationProvider>
    );
    const button = screen.getByRole('button', { name: 'Preview: large.png' });
    await waitFor(() => expect(button).toBeEnabled());
    button.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(imageMocks.openPreview).toHaveBeenCalledTimes(1));
    expect(imageMocks.readContent).not.toHaveBeenCalled();
    expect(imageMocks.openPreview).toHaveBeenCalledWith(
      '',
      'image',
      expect.objectContaining({ oversized: true, editable: false }),
      { replace: true }
    );
  });

  it('keeps the original image preview before a conversation exists', async () => {
    const user = userEvent.setup();
    render(<FilePreview path='/upload.png' onRemove={() => {}} />);
    const image = await screen.findByRole('img');
    await waitFor(() => expect(image).toHaveAttribute('src', inlineImage));
    fireEvent.load(image);
    await user.click(image);
    await waitFor(() => expect(document.querySelector('.arco-image-preview')).not.toBeNull());
    expect(imageMocks.openPreview).not.toHaveBeenCalled();
  });
});
