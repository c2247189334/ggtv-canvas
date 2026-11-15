import type { MenuItem } from '@/common/PopMenu';

export function cardGroupMenuItems(group: () => void): MenuItem[] {
  return [{ label: '打组', shortcut: 'Ctrl+G', onSelect: group }];
}

export function groupMenuItems(commands: Record<'ungroup' | 'copy' | 'duplicate' | 'delete', () => void>): MenuItem[] {
  return [
    { label: '解组', onSelect: commands.ungroup },
    { label: '复制', shortcut: 'Ctrl+C', onSelect: commands.copy },
    { label: '创建副本', shortcut: 'Ctrl+D', onSelect: commands.duplicate },
    { label: '删除', shortcut: 'Delete', onSelect: commands.delete }
  ];
}
