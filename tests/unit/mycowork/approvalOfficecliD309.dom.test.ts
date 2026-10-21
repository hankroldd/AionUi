/**
 * [mycowork] D309：officecli 批准卡容错（末尾 2>/dev/null|2>&1）、batch 含 remove 如实翻译、&& 串联 2–4 条。
 * 运行方式：复制到 fork 的 tests/unit/mycowork/ 后用 vitest dom 项目跑（见同目录 README）。
 */
import { describe, expect, it } from 'vitest';
import { approvalSummary } from '@mycowork/ui';

const run = (cmd: string) => approvalSummary('ExecCommand', { cmd }, 'zh');
const F = '"deck/e9c11ae0/汇报.pptx"';
const CD = 'cd /w/proj && ';

describe('D309 末尾重定向', () => {
  it('get … 2>/dev/null 翻成读取', () => {
    expect(run(`officecli get ${F} "/" --json 2>/dev/null`)?.action).toBe('读取文件结构');
  });
  it('close … 2>&1 翻成保存并关闭', () => {
    expect(run(`officecli close ${F} 2>&1`)?.action).toBe('保存并关闭文件');
  });
  it('管道、其它重定向、中间的 2>&1、重复后缀：仍 null', () => {
    for (const c of [
      `officecli get ${F} "/" 2>/dev/null | head`,
      `officecli get ${F} "/" 2>/tmp/x`,
      `officecli get ${F} "/" 2>&1 --json`,
      `officecli get ${F} "/" 2>&1 2>/dev/null`,
    ])
      expect(run(c), c).toBeNull();
  });
});

describe('D309 batch 含 remove', () => {
  const b = (cmds: unknown[]) => run(`officecli batch ${F} --commands '${JSON.stringify(cmds)}'`);
  it('改写 + 删除：破坏性说明与条数', () => {
    const s = b([
      { command: 'set', path: '/slide[1]', props: { text: '甲' } },
      { command: 'remove', path: '/slide[3]' },
      { command: 'remove', path: '/slide[4]' },
    ]);
    expect(s?.action).toBe('修改并删除页/对象');
    expect(s?.target).toContain('删除：/slide[3]、/slide[4]');
    expect(s?.impact).toContain('**会删除 2 处内容**');
  });
  it('只有 remove；超过 5 个写“等 N 处”', () => {
    expect(b([{ command: 'remove', path: '/slide[2]' }])?.impact).toContain('会删除 1 处');
    const many = [1, 2, 3, 4, 5, 6, 7].map((n) => ({ command: 'remove', path: `/slide[${n}]` }));
    expect(b(many)?.target).toContain('等 7 处');
  });
  it('remove + raw-set / 未知命令：仍 null', () => {
    expect(
      b([
        { command: 'remove', path: '/slide[2]' },
        { command: 'raw-set', path: '/x' },
      ]),
    ).toBeNull();
    expect(b([{ command: 'remove', path: '/slide[2]' }, { command: 'bogus' }])).toBeNull();
  });
});

describe('D309 && 串联', () => {
  it('cd && open && get：合成读取，只读', () => {
    const s = run(`${CD}officecli open ${F} && officecli get ${F} "/slide[2]" --depth 2 --json`);
    expect(s?.action).toBe('打开文件、读取文件结构');
    expect(s?.target).toContain('第 2 页');
    expect(s?.impact).toBe('只影响这份文件');
  });
  it('只读 + 只读：影响为只读', () => {
    expect(run(`officecli get ${F} "/" && officecli get ${F} "/slide[1]"`)?.impact).toBe('只读，不改文件');
  });
  it('set && close：按写说', () => {
    const s = run(`officecli set ${F} "/slide[1]" --prop text="甲" && officecli close ${F}`);
    expect(s?.action).toBe('修改文件内容、保存并关闭文件');
    expect(s?.impact).toContain('旧内容不保留');
  });
  it('含 rm / 文件名不同 / 5 条 / 多个 cd：null', () => {
    expect(run(`officecli open ${F} && rm -f x`)).toBeNull();
    expect(run(`officecli open ${F} && officecli get "deck/e9c11ae0/b.pptx" "/"`)).toBeNull();
    expect(run(Array(5).fill(`officecli open ${F}`).join(' && '))).toBeNull();
    expect(run(`${CD}${CD}officecli open ${F}`)).toBeNull();
  });
  it('4 条可以', () => {
    expect(run(Array(4).fill(`officecli open ${F}`).join(' && '))).not.toBeNull();
  });
});
