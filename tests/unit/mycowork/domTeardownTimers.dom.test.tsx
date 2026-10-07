/**
 * [mycowork] PR11 (A125): after a test file ends, jsdom is torn down. An Arco popup that was just closed leaves a
 * react-transition-group exit timer and a deferred root unmount behind; under load they fired after teardown and React
 * threw `ReferenceError: window is not defined` (all tests pass, vitest reports `Errors 1`).
 * tests/vitest.dom.setup.ts lets that work finish at the end of each file (settlePendingReactWork). This file plays the
 * teardown out deterministically: if settling stops covering Arco popups, the run ends with an unhandled error.
 */
import { Modal } from '@arco-design/web-react';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { fireEvent, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { settlePendingReactWork } from '../../vitest.dom.setup';

it('after settling, a just-closed Arco popup has nothing left that touches React once window is gone', async () => {
  Modal.confirm({ title: 'fixture confirm', content: 'x', okText: 'fixture ok', cancelText: 'fixture cancel' });
  fireEvent.click(await screen.findByRole('button', { name: 'fixture ok' }));
  await settlePendingReactWork(); // what the setup does at the end of every file
  // then what vitest does: the window goes away; hold long enough for any leftover timer to fire
  const saved = globalThis.window;
  Reflect.deleteProperty(globalThis, 'window');
  try {
    await new Promise((resolve) => setTimeout(resolve, 700));
  } finally {
    globalThis.window = saved;
  }
  expect(typeof window).toBe('object');
});
