import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CharacterCard } from './CharacterCard';
import { NewCharacterDialog, CharacterDetailDialog } from './CharacterDialogs';
import type { CharacterView } from '@/characterTypes';
import { SaveCharacterDialog } from './SaveCharacterDialog';

const portal = vi.hoisted(() => ({ props: null as null | { onKeyDown: (event: { key: string; stopPropagation: () => void }) => void } }));
vi.mock('react-dom', () => ({ createPortal: (children: { props: typeof portal.props }) => { portal.props = children.props; return children; } }));
beforeEach(() => vi.stubGlobal('document', { body: {} }));
const character: CharacterView = { id: 'p', name: '阿青', description: '蓝色外套', createdAt: '', updatedAt: '', status: 'ready', images: [
  { ref: { type: 'work', id: 'w' }, label: '设定图', video: { status: 'trusted', days: 30 } }
] };
const noop = () => {};

it('人物卡显示首图、名字、图数和视频状态，拖入类型属于人物', () => {
  const html = renderToStaticMarkup(<CharacterCard character={character} busy={false} onOpen={noop} onRetry={noop} onDelete={noop} />);
  expect(html).toContain('class="character-card"');
  expect(html).toContain('class="character-card__image has-image"');
  expect(html).toContain('draggable="true"');
  expect(html).toContain('/api/works/file?id=w');
  expect(html).toContain('阿青'); expect(html).toContain('1 张图');
  expect(html).toContain('视频可用 · 剩 30 天');
});

it('人物生成中与失败保留状态和错误原话，并提供重试和删除', () => {
  const props = { busy: false, onOpen: noop, onRetry: noop, onDelete: noop };
  const pending = renderToStaticMarkup(<CharacterCard {...props} character={{ ...character, status: 'generating', images: [] }} />);
  expect(pending).toContain('生成中…'); expect(pending).not.toContain('draggable="true"');
  expect(pending).toContain('class="character-card__image"');
  const failed = renderToStaticMarkup(<CharacterCard {...props} character={{ ...character, status: 'failed', images: [], error: '火山原话' }} />);
  expect(failed).toContain('火山原话'); expect(failed).toContain('>重新生成<'); expect(failed).not.toContain('¥'); expect(failed).toContain('>删除<');
});

it('创建弹框有大标题、空白占位、描述入口和不写价格的发送按钮', () => {
  const html = renderToStaticMarkup(<NewCharacterDialog busy={false} error={null} onSubmit={noop} onClose={noop} />);
  expect(html).toContain('role="dialog"'); expect(html).toContain('创建你的新人物');
  expect(html).toContain('character-create__blank'); expect(html).toContain('placeholder="描述你的人物特征"');
  expect(html).toContain('data-character-send'); expect(html).not.toContain('¥'); expect(html).toContain('disabled=""');
});

it('人物详情每张图带视频提示，能改名描述、添加和删除，空图不能添加', () => {
  const props = { busy: false, error: null, onSave: noop, onAdd: noop, onDelete: noop, onClose: noop, onRemoveVoice: noop };
  const html = renderToStaticMarkup(<CharacterDetailDialog {...props} character={character} />);
  expect(html).toContain('aria-label="人物名字"'); expect(html).toContain('value="阿青"');
  expect(html).toContain('蓝色外套'); expect(html).toContain('设定图'); expect(html).toContain('视频可用 · 剩 30 天');
  expect(html).toContain('>添加到画布</button>'); expect(html).toContain('>删除</button>');
  const empty = renderToStaticMarkup(<CharacterDetailDialog {...props} character={{ ...character, images: [] }} />);
  expect(empty).toMatch(/<button[^>]*disabled=""[^>]*>添加到画布<\/button>/);
});

it('人物详情的声音一行：没声音写怎么存，有声音能试听、看嗓音描述、删掉', () => {
  const props = { busy: false, error: null, onSave: noop, onAdd: noop, onDelete: noop, onClose: noop, onRemoveVoice: noop };
  const none = renderToStaticMarkup(<CharacterDetailDialog {...props} character={character} />);
  expect(none).toContain('还没有声音'); expect(none).toContain('存为人物的声音'); expect(none).not.toContain('<audio');
  const voice = { ref: { type: 'work' as const, id: 'v1' }, desc: '清亮的年轻男声', seconds: 6 };
  const html = renderToStaticMarkup(<CharacterDetailDialog {...props} character={{ ...character, voice }} />);
  expect(html).toContain('<audio'); expect(html).toContain('/api/works/file?id=v1'); expect(html).toContain('清亮的年轻男声');
  expect(html).toContain('>删掉声音</button>');
});

it('创建、详情和保存弹框隔离画布快捷键，Esc仍交给弹层管理', () => {
  const dialogs = [
    <NewCharacterDialog busy={false} error={null} onSubmit={noop} onClose={noop} />,
    <CharacterDetailDialog character={character} busy={false} error={null} onSave={noop} onAdd={noop} onDelete={noop} onClose={noop} onRemoveVoice={noop} />,
    <SaveCharacterDialog images={[{ type: 'work', id: 'w' }]} busy={false} error={null} onSave={noop} onClose={noop} />
  ];
  for (const dialog of dialogs) {
    renderToStaticMarkup(dialog);
    const stop = vi.fn();
    portal.props!.onKeyDown({ key: 'Delete', stopPropagation: stop });
    portal.props!.onKeyDown({ key: 'z', stopPropagation: stop });
    portal.props!.onKeyDown({ key: 'Escape', stopPropagation: stop });
    expect(stop).toHaveBeenCalledTimes(2);
  }
});
