/**
 * [mycowork] 办公编辑/版本/编排与预览编辑入口的挂载点，从 mycowork-slots.tsx 拆出（A506 行数上限）；
 * 外部一律经 mycowork-slots 再导出引用。
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useInRouterContext, useLocation, useMatch, useNavigate, useParams } from 'react-router-dom';
import { useOwnerKey, useResourceQuestionNavigation } from '@/renderer/mycowork-resource-navigation';
import { CodeEditor, MarkdownEditor } from '@/renderer/pages/conversation/Preview/components/editors';
import MarkdownView from '@/renderer/components/Markdown';
import { useBranchAdapter } from '@/renderer/mycowork-branches';
import { useReviewAdapter } from '@/renderer/mycowork-reviews';
import {
  CompositionPage,
  VersionsPage,
  parseCitedRevision,
  OfficeEditorPage,
  PreviewEditButton,
  TextEditorPage,
} from '@mycowork/ui';

/**
 * Mount point: route `/office/compositions/:decisionId` (MyCowork P09 page plan / template review, the `review_url`
 * returned by the runtime's `template_recommend`). A new choice creates a new decision version; the URL follows it.
 */
export const OfficeCompositionSlot: React.FC = () => {
  const { i18n: current } = useTranslation();
  const navigate = useNavigate();
  const { decisionId = '' } = useParams();
  return (
    <CompositionPage
      lang={current.language}
      decisionId={decisionId}
      onVersion={(id) => void navigate(`/office/compositions/${encodeURIComponent(id)}`, { replace: true })}
    />
  );
};

/**
 * Mount point: route `/office/resources/:resourceId/versions` (MyCowork P12 versions: timeline, compare, restore, publish,
 * read-only preview of the current version). [mycowork] D138: markdown is rendered with AionUi's chat MarkdownView, not the
 * preview MarkdownViewer, whose selection toolbar offers "add to chat" (a dead button outside the chat page, MyCowork A59).
 * Markdown images are not loaded (they would reveal the reader); R040 object selections ask via the Space scope navigation.
 */
export const OfficeVersionsSlot: React.FC = () => {
  const { i18n: current } = useTranslation();
  const { resourceId = '' } = useParams();
  const ownerKey = useOwnerKey();
  const branchAdapter = useBranchAdapter();
  const reviewAdapter = useReviewAdapter();
  const onAskScope = useResourceQuestionNavigation(ownerKey);
  const citedRevisionId = parseCitedRevision(useLocation().search); // R014：AI 当时读到的版本（navigation-intent §10）
  return (
    <VersionsPage
      citedRevisionId={citedRevisionId}
      lang={current.language}
      resourceId={resourceId}
      ownerKey={ownerKey}
      branchAdapter={branchAdapter}
      reviewAdapter={reviewAdapter}
      onAskScope={onAskScope}
      renderMarkdown={(content, overrides) => <MarkdownView components={overrides}>{content}</MarkdownView>}
    />
  );
};

/**
 * Mount point: route `/office/edit/:sessionId` (MyCowork P04 "preview → edit": the ONLYOFFICE editor for a Bridge edit
 * session; "finish" waits for the editing service to report the save instead of assuming it). Entry: the versions page.
 */
export const OfficeEditSlot: React.FC = () => {
  const { i18n: current } = useTranslation();
  const { sessionId = '' } = useParams();
  return <OfficeEditorPage lang={current.language} sessionId={sessionId} />;
};

/**
 * [mycowork] D124: route `/office/edit-text/:resourceId` (MyCowork md/txt online editing with a write lease; save = new
 * version). The page lives in MyCowork packages/ui; CodeMirror resolves from this repo (MyCowork ADR-0020).
 * MarkdownView applies the page's image/code overrides; raw HTML stays disabled (MyCowork A63).
 */
export const OfficeTextEditSlot: React.FC = () => {
  const { i18n: current } = useTranslation();
  const { resourceId = '' } = useParams();
  return (
    <TextEditorPage
      lang={current.language}
      resourceId={resourceId}
      renderEditor={({ value, onChange, format }) =>
        format === 'markdown' ? (
          <MarkdownEditor value={value} onChange={onChange} />
        ) : (
          <CodeEditor value={value} onChange={onChange} />
        )
      }
      renderPreview={(content, overrides) => <MarkdownView components={overrides}>{content}</MarkdownView>}
    />
  );
};

/**
 * [mycowork] D125: mount point in the preview tab toolbar — an "Edit" button that opens the file of this conversation's
 * workspace in a separate editor (the preview itself stays read-only, MyCowork 01 §10). Only on `/conversation/:id`.
 * The panel is rendered by the app Layout, outside the conversation route element, so the id comes from matching the
 * location (useParams is empty there — found in a real browser).
 */
export const PreviewEditSlot: React.FC<{ relativePath?: string }> = (props) =>
  // useMatch throws outside a Router; upstream's PreviewPanel tests render the panel without one.
  useInRouterContext() ? <PreviewEditEntry {...props} /> : null;

const PreviewEditEntry: React.FC<{ relativePath?: string }> = ({ relativePath }) => {
  const { i18n: current } = useTranslation();
  const id = useMatch('/conversation/:id')?.params.id;
  if (!id) return null;
  return <PreviewEditButton lang={current.language} conversationId={id} relativePath={relativePath} />;
};
