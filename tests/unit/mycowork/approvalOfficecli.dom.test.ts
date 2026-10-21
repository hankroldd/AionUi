/**
 * [mycowork] A531/D304：officecli 命令批准卡翻成“动作 · 对象 · 影响”；含管道/分号/绝对路径/.. 等一律不翻（回退原样）。
 */
import { describe, expect, it } from 'vitest';
import { approvalSummary } from '@mycowork/ui';

const CD = 'cd /w/MyCowork\\ 临时项目 && ';
const run = (cmd: string) => approvalSummary('ExecCommand', { cmd }, 'zh');
const F = '"deck/e9c11ae0/汇报.pptx"';

describe('A531 officecli 批准卡', () => {
  it('get 根路径：读取文件结构、全文、只读', () => {
    const s = run(`${CD}officecli get ${F} "/" --depth 3 --json`);
    expect(s).toEqual({ action: '读取文件结构', target: '汇报.pptx（全文）', impact: '只读，不改文件' });
  });
  it('get 带页路径：写第几页', () => {
    expect(run(`officecli get ${F} "/slide[1]/shape[@id=100004]" --json`)?.target).toBe('汇报.pptx（第 1 页）');
  });
  it('set --prop text：含页码与新文字前 40 字', () => {
    const long = '一'.repeat(50);
    const s = run(`${CD}officecli set ${F} "/slide[2]/shape[@id=100012]" --prop text="${long}"`);
    expect(s?.action).toBe('修改文件内容');
    expect(s?.target).toContain('汇报.pptx 第 2 页');
    expect(s?.target).toContain(`「${'一'.repeat(40)}…」`);
    expect(s?.impact).toContain('旧内容不保留');
  });
  it('set 算不出页码：指定位置', () => {
    expect(run(`officecli set ${F} "/body/p[1]" --prop text="甲"`)?.target).toContain('指定位置');
  });
  it('batch --commands：统计条数与页码，含写则按修改', () => {
    const j = JSON.stringify([
      { command: 'set', path: '/slide[1]/shape[1]', props: { text: '标题；含|符号' } },
      { command: 'remove', path: '/slide[3]' },
    ]);
    const s = run(`${CD}officecli batch ${F} --commands '${j}' --stop-on-error`);
    expect(s?.action).toBe('修改文件内容');
    expect(s?.target).toContain('共 2 处');
    expect(s?.target).toContain('第 1、3 页');
  });
  it('close / save：只影响会话目录文件', () => {
    expect(run(`${CD}officecli close ${F}`)).toEqual({
      action: '保存并关闭文件',
      target: '汇报.pptx',
      impact: '只影响本会话目录里的文件',
    });
    expect(run(`officecli open ${F}`)?.action).toBe('打开文件');
  });
  it.each([
    ['管道', `officecli get ${F} "/" | cat`],
    ['分号', `officecli get ${F} "/"; rm -rf x`],
    ['反引号', 'officecli get "deck/a/b.pptx" "`id`"'],
    ['命令替换', 'officecli get "deck/a/b.pptx" "$(id)"'],
    ['重定向', `officecli get ${F} "/" > out.txt`],
    ['多个 &&', `${CD}officecli save ${F} && officecli close ${F}`],
    ['绝对路径', 'officecli get "/etc/passwd" "/"'],
    ['..', 'officecli get "deck/../../x.pptx" "/"'],
    ['非 deck', 'officecli get "原件/x.pptx" "/"'],
    ['非 officecli', 'sha256sum "deck/a/b.pptx"'],
    ['edit 未覆盖', `officecli edit ${F} --path '/slide[1]' --text 'x'`],
  ])('%s：返回 null', (_n, cmd) => {
    expect(run(cmd)).toBeNull();
  });
  it('既有 Bridge 工具摘要不回退', () => {
    expect(approvalSummary('mcp__mycowork_bridge_memory_suggest', { text: 'x' }, 'zh')?.action).toBe('建议记一条记忆');
    expect(approvalSummary('office_edit', {}, 'zh')).toBeNull();
  });
  it('cd 目标相对路径或含 .. 时不翻译', () => {
    expect(run('cd ../x && officecli get "deck/c1/a.pptx" "/" --json')).toBeNull();
    expect(run('cd work && officecli get "deck/c1/a.pptx" "/" --json')).toBeNull();
  });
});
