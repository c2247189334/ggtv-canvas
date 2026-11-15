import { expect, it } from 'vitest';
import { cardGroupMenuItems, groupMenuItems } from './groupMenus';
import { shortcutAction, SHORTCUT_GROUPS } from './shortcuts';

it('卡片打组菜单在不足2张时仍能点并提示，组菜单只有四个动作', () => {
  let calls = 0;
  const run = () => { calls += 1; };
  const items = cardGroupMenuItems(run);
  expect(items).toEqual([{ label: '打组', shortcut: 'Ctrl+G', onSelect: run }]);
  const commands = { ungroup: run, copy: run, duplicate: run, delete: run };
  const group = groupMenuItems(commands);
  expect(group.map(item => typeof item === 'object' && 'label' in item ? item.label : null)).toEqual(['解组', '复制', '创建副本', '删除']);
  for (const item of group) if (typeof item === 'object' && 'onSelect' in item) item.onSelect?.();
  expect(calls).toBe(4);
});

it('Ctrl+G打组，输入框、组合键不抢，说明加入创作分组', () => {
  expect(shortcutAction({ key: 'g', ctrlKey: true }, { editable: false })).toBe('group');
  expect(shortcutAction({ key: 'G', ctrlKey: true }, { editable: false })).toBe('group');
  expect(shortcutAction({ key: 'g', ctrlKey: true }, { editable: true })).toBeNull();
  expect(shortcutAction({ key: 'g', ctrlKey: true, shiftKey: true }, { editable: false })).toBeNull();
  expect(SHORTCUT_GROUPS[0].items).toContainEqual(['打组', 'Ctrl+G']);
});
