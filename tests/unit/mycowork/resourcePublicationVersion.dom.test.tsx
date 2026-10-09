/**
 * [mycowork] PR11 W4-4o。文件：tests/unit/mycowork/resourcePublicationVersion.dom.test.tsx
 * 职责：超过时间线一页时发布认可版本号依然准确。
 * 边界：真实资源入口与React/Arco，只有HTTP时间线用虚构57版本fixture。
 * 关联：PR11 spec §3.3；ResourcePublication；RevisionTimeline.total。
 */
import React from 'react';
import { it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { useResourcePublication } from '@mycowork/ui/pages/resources/ResourcePublication.tsx';
import type { Resource } from '@mycowork/ui/pages/resources/resource-client.ts';
const resource: Resource = {
  resource_id: 'fixture-output',
  file_name: '虚构产物.txt',
  origin: 'outputs',
  source_id: null,
  state: 'stored',
  purpose: 'working',
  tag_ids: [],
  secret: false,
  can_mark_secret: true,
  updated_at: '2026-10-03T09:00:00Z',
  revision_count: 57,
};
function Harness() {
  const state = useResourcePublication('zh-CN', [], () => {});
  return (
    <>
      <button onClick={() => state.onPublish(resource)}>打开</button>
      {state.dialog}
    </>
  );
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('57个版本的产物发布确认应显示v57而非第一页条数v50', async () => {
  vi.stubGlobal(
    'fetch',
    async () =>
      new Response(
        JSON.stringify({
          resource_id: resource.resource_id,
          current_revision_id: 'rev57',
          file_name: resource.file_name,
          page: 1,
          page_size: 50,
          total: 57,
          items: Array.from({ length: 50 }, (_, i) => ({
            revision_id: `rev${57 - i}`,
            current: i === 0,
            created_at: '2026-10-03T09:00:00Z',
            origin: 'output',
          })),
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
  );
  render(<Harness />);
  fireEvent.click(screen.getByText('打开'));
  const actual = await screen.findByText(/将发布 v/);
  expect(actual.textContent).toContain('将发布 v57');
});
