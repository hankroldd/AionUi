/**
 * [mycowork] adapted：共享夹具（拆自 officeResources.dom.test.tsx）。
 */

import React from 'react';
import { vi } from 'vitest';

export const fetchMock = vi.fn();
export const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body });
export const counts = { total: 1, ready: 1, indexing: 0, failed: 0, unavailable: 0 };
export const now = new Date();
export const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 13).toISOString();
export const older = new Date(now.getFullYear() - 1, 2, 2, 9, 5).toISOString();
export const TAGS = [
  { tag_id: 'tag_p', name: '项目', parent_id: null, namespace: 'platform', aliases: [], revision: 1, updated_at: 't' },
  {
    tag_id: 'tag_c',
    name: '风险',
    parent_id: 'tag_p',
    namespace: 'platform',
    aliases: [],
    revision: 3,
    updated_at: 't',
  },
];
export const item = (over: object) => ({
  resource_id: 'res_1',
  file_name: '工作稿.pptx',
  source_id: null,
  origin: 'imports',
  purpose: 'working',
  state: 'stored',
  tag_ids: ['tag_c'],
  secret: false,
  can_mark_secret: true,
  updated_at: older,
  revision_count: 3,
  ...over,
});
export const WEEKLY = item({
  resource_id: 'res_q',
  file_name: '周报.md',
  source_id: 'src_q',
  origin: 'knowledge_base',
  state: 'ready',
  tag_ids: [],
  updated_at: today,
  revision_count: 0,
});
export const calls = (method: string, part: string) =>
  fetchMock.mock.calls.filter(([url, init]) => (init?.method ?? 'GET') === method && String(url).includes(part));
export const bodyOf = (method: string, part: string, i = 0) => JSON.parse(String(calls(method, part)[i]?.[1]?.body));

export type Opts = {
  patchStatus?: number;
  createTagStatus?: number;
  createTagWait?: Promise<void>;
  tagPatchStatus?: number;
  tagDeleteStatus?: number;
  tagDeleteWait?: Promise<void>;
  empty?: boolean;
  sourceStatus?: number;
  starred?: string[];
  views?: Record<string, unknown>[];
  tags3?: boolean;
  secretReady?: boolean;
};
export function bridge(opts: Opts = {}) {
  let tags = structuredClone(TAGS);
  let views = structuredClone(opts.views ?? []);
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url === '/bridge/v1/scopes')
      return reply(200, {
        sources: [{ source_id: 'src_q', name: '青禾库', provider: 'weknora', counts }],
        projects: [],
      });
    if (url.startsWith('/bridge/v1/resources?')) {
      const q = new URLSearchParams(url.split('?')[1]);
      if (q.get('source_id') && opts.sourceStatus)
        return reply(opts.sourceStatus, { error: { code: 'NOT_FOUND', message: 'x' } });
      let items = opts.empty
        ? []
        : q.get('source_id') === 'src_q'
          ? [{ ...WEEKLY, secret: opts.secretReady ?? false }]
          : q.get('origin') === 'all' && !opts.sourceStatus
            ? [
                { ...WEEKLY, secret: opts.secretReady ?? false },
                item(opts.tags3 ? { tag_ids: ['tag_c', 'tag_p', 'tag_x'] } : {}),
              ]
            : [item(opts.tags3 ? { tag_ids: ['tag_c', 'tag_p', 'tag_x'] } : {})];
      if (q.get('collection_id')) items = items.filter((i) => opts.starred?.includes(i.resource_id));
      if (q.get('q')) items = items.filter((i) => i.file_name.includes(q.get('q') as string));
      return reply(200, {
        page: 1,
        page_size: 50,
        total: items.length,
        items,
        ...(q.get('origin') === 'all' && opts.sourceStatus ? { failed_source_ids: ['src_q'] } : {}),
      });
    }
    if (url === '/bridge/v1/tags' && method === 'GET')
      return reply(200, {
        tags: opts.tags3 ? [...tags, { ...TAGS[0], tag_id: 'tag_x', name: '第三个', revision: 1 }] : tags,
      });
    if (url === '/bridge/v1/tags' && method === 'POST') {
      await opts.createTagWait;
      return opts.createTagStatus
        ? reply(opts.createTagStatus, { error: { code: 'NAME_CONFLICT', message: 'x' } })
        : reply(201, {});
    }
    if (url.startsWith('/bridge/v1/tags/') && method === 'PATCH') {
      if (opts.tagPatchStatus)
        return reply(opts.tagPatchStatus, { error: { code: 'REVISION_CONFLICT', message: 'x' } });
      const body = JSON.parse(String(init?.body));
      tags = tags.map((t) => (url.endsWith(t.tag_id) ? { ...t, ...body, revision: t.revision + 1 } : t));
      return reply(200, {});
    }
    if (url.startsWith('/bridge/v1/tags/') && method === 'DELETE') {
      await opts.tagDeleteWait;
      if (opts.tagDeleteStatus)
        return reply(opts.tagDeleteStatus, {
          error: { code: opts.tagDeleteStatus === 409 ? 'TAG_HAS_CHILDREN' : 'NOT_FOUND', message: 'x' },
        });
      tags = tags.filter((t) => !url.endsWith(t.tag_id));
      return reply(200, { tag_id: url.split('/').at(-1), untagged_resources: 1, affected_view_ids: [] });
    }
    if (url === '/bridge/v1/saved-views' && method === 'GET') return reply(200, { views });
    if (url.startsWith('/bridge/v1/saved-views/') && method === 'PATCH') {
      const body = JSON.parse(String(init?.body));
      views = views.map((view) =>
        url.endsWith(String(view['view_id']))
          ? {
              ...view,
              ...body,
              revision: Number(view['revision']) + 1,
            }
          : view
      );
      return reply(200, {});
    }
    if (url.startsWith('/bridge/v1/saved-views/') && method === 'DELETE') {
      views = views.filter((view) => !url.endsWith(String(view['view_id'])));
      return reply(204, undefined);
    }
    if (url === '/bridge/v1/collections' && method === 'GET')
      return reply(200, {
        collections: opts.starred
          ? [
              {
                collection_id: 'col_s',
                name: '收藏',
                purpose: 'starred',
                member_count: 1,
                resource_ids: opts.starred,
                revision: 2,
                updated_at: 't',
              },
            ]
          : [],
      });
    if (url.endsWith('/metadata') && method === 'GET')
      return reply(200, {
        resource_id: 'res_1',
        metadata_revision: 4,
        current_revision_id: 'rev_1',
        tag_ids: ['tag_c'],
        secret: false,
      });
    if (url.endsWith('/metadata') && method === 'PATCH')
      return opts.patchStatus
        ? reply(opts.patchStatus, { error: { code: 'REVISION_CONFLICT', message: 'x' } })
        : reply(200, {});
    return reply(method === 'GET' ? 404 : 201, {});
  });
}
