import { beforeEach, expect, it, vi } from 'vitest';
import { CharactersPanel } from './CharactersPanel';
import { NewCharacterDialog, CharacterDetailDialog } from './CharacterDialogs';
import { CharacterCard } from './CharacterCard';
import { Confirm } from '@/common/Confirm';
import { api } from '@/api';
import { subscribeCharacterAdd } from './characterEvents';
import type { CharacterView } from '@/characterTypes';

const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0, effects: [] as Array<() => void | (() => void)> }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.values)) hooks.values[index] = initial;
    return [hooks.values[index], (value: unknown) => { hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value; }];
  },
  useRef: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.values)) hooks.values[index] = { current: initial };
    return hooks.values[index];
  },
  useEffect: (effect: () => void) => { hooks.effects.push(effect); }
}));
vi.mock('@/api', () => ({ api: { generateCharacter: vi.fn(), patchCharacter: vi.fn(), deleteCharacter: vi.fn() } }));
vi.mock('./worksEvents', () => ({ bumpWorks: vi.fn() }));
const person: CharacterView = { id: 'p', name: '名字', description: '外套', createdAt: '', updatedAt: '', status: 'failed', images: [], error: '假失败原话' };
const props = { characters: [person], error: null, notify: vi.fn(), onUpdate: vi.fn(), onRemove: vi.fn() };
type Element = { type: unknown; props: Record<string, any> };
function find(value: unknown, type: unknown): Element | undefined {
  if (Array.isArray(value)) return value.map(child => find(child, type)).find(Boolean);
  if (!value || typeof value !== 'object' || !('type' in value)) return;
  const element = value as Element;
  return element.type === type ? element : find(element.props.children, type);
}
const render = () => { hooks.index = 0; hooks.effects = []; return CharactersPanel(props); };
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
beforeEach(() => {
  hooks.values = []; hooks.index = 0; hooks.effects = [];
  vi.clearAllMocks();
  vi.mocked(api.generateCharacter).mockResolvedValue({ ...person, status: 'generating' });
  vi.mocked(api.patchCharacter).mockResolvedValue({ ...person, name: '改名' });
  vi.mocked(api.deleteCharacter).mockResolvedValue({ ok: true });
});

it('创建发送和失败重试接生成接口，响应立即更新清单', async () => {
  find(render(), 'button')!.props.onClick();
  find(render(), NewCharacterDialog)!.props.onSubmit('新的描述');
  await settle();
  expect(api.generateCharacter).toHaveBeenCalledWith({ description: '新的描述' });
  expect(props.onUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'generating' }));
  expect(find(render(), NewCharacterDialog)).toBeUndefined();
  find(render(), CharacterCard)!.props.onRetry(); await settle();
  expect(api.generateCharacter).toHaveBeenLastCalledWith({ id: 'p', description: '外套' });
});

it('详情改名描述接PATCH，添加广播给画布并关闭详情，删除先确认', async () => {
  find(render(), CharacterCard)!.props.onOpen();
  find(render(), CharacterDetailDialog)!.props.onSave('改名', '新外套'); await settle();
  expect(api.patchCharacter).toHaveBeenCalledWith({ id: 'p', name: '改名', description: '新外套' });
  const received = vi.fn(), dispose = subscribeCharacterAdd(received);
  find(render(), CharacterDetailDialog)!.props.onAdd();
  expect(received).toHaveBeenCalledWith(person);
  expect(find(render(), CharacterDetailDialog)).toBeUndefined(); dispose();
  find(render(), CharacterCard)!.props.onDelete();
  const confirmation = find(render(), Confirm)!;
  expect(confirmation.props.text).toBe('删掉人物「名字」？画布上已经放好的不受影响，图还在作品库里。');
  expect(api.deleteCharacter).not.toHaveBeenCalled();
  confirmation.props.onOk(); await settle();
  expect(api.deleteCharacter).toHaveBeenCalledWith('p'); expect(props.onRemove).toHaveBeenCalledWith('p');
});

it('生成失败显示原话，重复发送只交一单，卸载后不更新清单', async () => {
  let reject!: (reason: Error) => void;
  vi.mocked(api.generateCharacter).mockImplementation(() => new Promise((_yes, no) => { reject = no; }));
  find(render(), 'button')!.props.onClick();
  const send = find(render(), NewCharacterDialog)!.props.onSubmit;
  send('描述'); send('描述');
  expect(api.generateCharacter).toHaveBeenCalledTimes(1);
  reject(Error('火山没接的原话')); await settle();
  expect(find(render(), NewCharacterDialog)!.props.error).toBe('火山没接的原话');
  let finish!: (person: CharacterView) => void;
  vi.mocked(api.generateCharacter).mockImplementation(() => new Promise(yes => { finish = yes; }));
  const tree = render(), dispose = hooks.effects[0]();
  find(tree, NewCharacterDialog)!.props.onSubmit('描述');
  if (typeof dispose === 'function') dispose();
  finish({ ...person, status: 'generating' }); await settle();
  expect(props.onUpdate).not.toHaveBeenCalled();
});
