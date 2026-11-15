import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { GroupFrames } from './GroupFrames';
import { fitGroupTools } from './fitGroupTools';
import { newCard } from '@/domain/cards';
import type { CardNode } from '@/types';

// 使用真实文件读取；项目没有安装 Node 类型，不为样式测试增加依赖。
const { readFileSync } = await vi.importActual<{
  readFileSync: (path: URL, encoding: "utf8") => string;
}>("node:fs");
const boardCss = readFileSync(new URL("../styles/board.css", import.meta.url), "utf8");
const keys = vi.hoisted(() => ({ space: false, zoom: 1 }));
vi.mock('@xyflow/react', () => ({ ViewportPortal: ({ children }: { children: ReactNode }) => children,
  useKeyPress: () => keys.space, useStore: (pick: (state: { transform: number[] }) => unknown) => pick({ transform: [0, 0, keys.zoom] }) }));
const nodes: CardNode[] = [{ id: 'a', type: 'card', position: { x: 50, y: 70 }, data: {
  ...newCard('generate', 1), group: { id: 'g', name: 'Group 1' }
} }];
const run = () => {};
const props = { nodes, selected: null as string | null, onPointerDown: run, onContextMenu: run, onUngroup: run };

it('组框用画布绝对坐标外留24，组名在框外；只选中组显示解组和四角', () => {
  const html = renderToStaticMarkup(<GroupFrames {...props} />);
  expect(html).toContain('data-group-id="g"');
  expect(html).toContain('class="group-frame__name"');
  expect(html).toContain('Group 1');
  expect(html).toContain('translate(26px, 46px)');
  expect(html).toContain('width:328px');
  expect(html).not.toContain('>解组<');
  const selected = renderToStaticMarkup(<GroupFrames {...props} selected="g" />);
  expect(selected).toContain('is-selected');
  expect(selected).toContain('>解组<');
  expect(selected.match(/group-frame__corner /g)).toHaveLength(4);
  expect(renderToStaticMarkup(<GroupFrames {...props} nodes={[]} selected="g" />)).toBe('');
});

// 11-03 验收：解组放在组框里会跟着框一起压在卡片下面（框 z-index -1），旁边有卡叠着就点不到。
it('解组工具条不在组框里，层级高过选中的卡片（画布库选中卡是 1000）', () => {
  const selected = renderToStaticMarkup(<GroupFrames {...props} selected="g" />);
  expect(selected.indexOf('group-frame__tools')).toBeGreaterThan(selected.indexOf('</div>'));
  const tools = boardCss.match(/\.group-frame__tools\s*\{([^}]*)\}/)?.[1] ?? '';
  expect(Number(tools.match(/z-index:\s*(\d+)/)?.[1] ?? 0)).toBeGreaterThan(1000);
});

// 11-09 实测：组框贴屏幕上边时组工具条整条出屏，贴右上时被「排队 / 设置」那栏盖住；挂上按屏幕挪回来的 ref，换组就重挂。
it('组工具条挂按屏幕摆的 ref，记着是哪个组的', () => {
  const children = GroupFrames({ ...props, selected: 'g' }).props.children;
  const tools = children[children.length - 1];
  expect(tools.props.ref).toBe(fitGroupTools);
  expect(tools.props['data-tools-for']).toBe('g');
  expect(tools.key).toContain('g');
});

// 11-03：onUngroup(id = 当前选中) 有默认参数，把点击事件传进去会被当成组编号、什么都不解。
it('点解组不带参数调用 onUngroup', () => {
  const ungroup = vi.fn();
  const children = GroupFrames({ ...props, selected: 'g', onUngroup: ungroup }).props.children;
  const tools = children[children.length - 1];
  [tools.props.children].flat().find((child: { props?: { children?: unknown } } | null) => child?.props?.children === '解组').props.onClick({ stopPropagation: () => {} });
  expect(ungroup).toHaveBeenCalledTimes(1);
  expect(ungroup).toHaveBeenCalledWith();
});

it('组框空格左拖和中键交给画布平移，普通左拖才接管', () => {
  const down = vi.fn(), stop = vi.fn();
  const frame = () => GroupFrames({ ...props, onPointerDown: down }).props.children[0].props;
  keys.space = true;
  frame().onPointerDown({ button: 0 }); frame().onMouseDown({ button: 0, stopPropagation: stop });
  expect(down).not.toHaveBeenCalled(); expect(stop).not.toHaveBeenCalled();
  keys.space = false;
  frame().onPointerDown({ button: 1 }); frame().onMouseDown({ button: 1, stopPropagation: stop });
  expect(down).not.toHaveBeenCalled(); expect(stop).not.toHaveBeenCalled();
  frame().onPointerDown({ button: 0 }); frame().onMouseDown({ button: 0, stopPropagation: stop });
  expect(down).toHaveBeenCalledTimes(1); expect(stop).toHaveBeenCalledTimes(1);
});

// 11-04 晚：组名、工具条在屏幕上大小固定（按 1/缩放 反向放大），画布缩到一半字也不变小。
it('组名和工具条按 1/缩放 反向放大；工具条有排列三项', () => {
  keys.zoom = 0.5;
  const html = renderToStaticMarkup(<GroupFrames {...props} selected="g" onArrange={run} />);
  keys.zoom = 1;
  expect(html).toMatch(/class="group-frame__name" style="transform:scale\(2\)"/);
  expect(html).toContain('scale(2) translate(-50%, calc(-100% - 34px))');
  expect(html).toContain('排列 ▾');
  for (const label of ['宫格排列', '水平排列', '垂直排列']) expect(html).toContain(`>${label}<`);
});

it('商品组工具条：加一张 / 再加一组 / 跟哪组一样 ▾（列同一视频下别的组）；有图时灰，跟了以后加一张灰、能「不跟了」', () => {
  const product = (productId: string, extra: object = {}): CardNode => ({ id: `c-${productId}`, type: 'card', position: { x: 0, y: 0 }, data: {
    ...newCard('generate', 1), group: { id: `g-${productId}`, name: `商品${productId} · 鞋子`, productId, videoId: 'v' },
    productRole: { role: 'product' as const, productId, videoId: 'v' }, ...extra } });
  const tools = (list: CardNode[], id: string) => renderToStaticMarkup(<GroupFrames {...props} nodes={list} selected={id}
    onArrange={run} onAddImage={run} onAddGroup={run} onSameAs={run} />);
  const alone = tools([product('A')], 'g-A');
  expect(alone).toContain('>加一张<'); expect(alone).toContain('>再加一组<'); expect(alone).not.toContain('跟哪组一样');
  const two = tools([product('A'), product('B')], 'g-B');
  expect(two).toContain('跟哪组一样 ▾'); expect(two).toContain('>跟商品A · 鞋子一样<'); expect(two).not.toContain('不跟了');
  expect(tools([product('A'), product('B', { results: [{ type: 'upload' as const, id: 'x' }] })], 'g-B')).toMatch(/disabled=""[^>]*>跟哪组一样 ▾</);
  const on = tools([product('A'), product('B', { productRole: { role: 'product', productId: 'B', videoId: 'v', sameAs: 'A' } })], 'g-B');
  expect(on).toContain('✓ 跟商品A一样 ▾'); expect(on).toContain('>不跟了，自己传图<');
  expect(on).toMatch(/disabled=""[^>]*>加一张</);
});
