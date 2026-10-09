/**
 * [mycowork] 文件：tests/unit/mycowork/spaceRowMenu.dom.test.tsx
 * 职责：空间行“···”菜单（列表与网格共用 ItemMenu）：不同行、两种视图的菜单都带同一个定宽类 mcw-rc-menu；Esc 关闭。
 * 边界：jsdom 量不出像素，宽度数值与出视口由 tests/e2e/P05-ui-polish/card-view.ts 在真实浏览器量。
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { ResourcesPage } from '@mycowork/ui';
import { fixture, item, list, OUTPUT, reset, SECRET } from './globalResourceFixture';

const menus = () => Array.from(document.querySelectorAll('.mcw-rc-menu'));

async function open() {
  fixture(() => list([item('res_long', 'long-name.pptx', { origin: 'imports' }), OUTPUT, SECRET], 3));
  render(<ResourcesPage lang='zh-CN' onAskScope={async () => undefined} />);
  await screen.findByRole('button', { name: 'long-name.pptx' });
}

beforeEach(reset);
afterEach(() => vi.unstubAllGlobals());

for (const view of ['list', 'card'] as const) {
  it(`${view} 视图：三种不同的行打开的菜单都是同一个定宽菜单，Esc 关闭`, async () => {
    await open();
    if (view === 'card') {
      fireEvent.click(screen.getByTestId('mycowork-layout-card'));
      await waitFor(() => expect(document.querySelector('.mcw-rc-grid')).not.toBeNull());
    }
    const buttons = screen.getAllByRole('button', { name: /^更多操作 / });
    expect(buttons.length).toBeGreaterThanOrEqual(3);
    for (const button of buttons.slice(0, 3)) {
      fireEvent.click(button);
      await waitFor(() => expect(menus()).toHaveLength(1));
      fireEvent.keyDown(document, { key: 'Escape' });
      await waitFor(() => expect(menus()).toHaveLength(0));
    }
  });
}
