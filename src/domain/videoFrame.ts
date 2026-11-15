import type { Edge } from '@xyflow/react';
import type { AssetRef, CardNode } from '@/types';
import { newCanvasCard } from './cards';
import { rightOf, type Point } from './placement';
import { linkId } from './refs';

/** 11-09 用户定的视频截图：当前帧 / 首帧 / 尾帧。 */
export type FrameKind = 'current' | 'first' | 'last';
/** 卡里播放器此刻的时间和它读到的时长（读不到是 NaN）。 */
export type Playhead = { time: number; duration: number };

/** 尾帧、播到头的当前帧都往前挪这么多秒，免得截到片尾外面。 */
const END_MARGIN = 0.05;
/** 同一个位置已有卡时，新截图往右下错开的距离。 */
export const FRAME_STACK_STEP = 30;

const pad = (value: number, size = 2) => String(value).padStart(size, '0');

export function frameTitle(kind: FrameKind, second: number): string {
  if (kind === 'first') return '首帧';
  if (kind === 'last') return '尾帧';
  const ms = Math.round(Math.max(0, second) * 1000);
  const total = Math.floor(ms / 1000), hours = Math.floor(total / 3600);
  const clock = `${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}.${pad(ms % 1000, 3)}`;
  return `截图 ${hours > 0 ? `${pad(hours)}:` : ''}${clock}`;
}

/** 要截第几秒；尾帧读不到时长返回 null。卡上记的时长优先，没有再看播放器。 */
export function frameSecond(kind: FrameKind, playhead: Playhead, seconds: number | undefined): number | null {
  const duration = typeof seconds === 'number' && seconds > 0 ? seconds : playhead.duration > 0 ? playhead.duration : null;
  const lastSecond = duration === null ? null : Math.max(0, Math.round((duration - END_MARGIN) * 1000) / 1000);
  if (kind === 'first') return 0;
  if (kind === 'last') return lastSecond;
  // 卡里视频地址带 #t=0.001（为了显示第一帧），没播过时读到的就是它，按 0 算。
  const time = Number.isFinite(playhead.time) && playhead.time > 0.001 ? playhead.time : 0;
  return lastSecond !== null && time > lastSecond ? lastSecond : time;
}

/** 视频右边顶对齐（隔 100）；那里已有卡就往右下错开 30，直到空出来，不往别处躲。 */
export function stackedFrameSpot(base: Point, nodes: readonly CardNode[]): Point {
  const taken = (spot: Point) => nodes.some(node => Math.abs(node.position.x - spot.x) < 1 && Math.abs(node.position.y - spot.y) < 1);
  let step = 0;
  while (taken({ x: base.x + step * FRAME_STACK_STEP, y: base.y + step * FRAME_STACK_STEP })) step += 1;
  return { x: base.x + step * FRAME_STACK_STEP, y: base.y + step * FRAME_STACK_STEP };
}

/** 截图卡 = 不占编号的上传图片卡，记下来源视频（有它才画左接点）；来源线和新卡由调用方同一批加入，撤销只算一步。 */
export function frameChild(source: CardNode, video: AssetRef, frameId: string, title: string, id: string,
  nodes: readonly CardNode[]): { node: CardNode; edge: Edge } {
  // 图片结果照存档的规矩不写 media（只有视频 / 音频才记）。
  const data = newCanvasCard('upload', () => 0, [{ type: 'upload', id: frameId }], 'image', title);
  data.mediaSource = { ...video, media: 'video' };
  return { node: { id, type: 'card', position: stackedFrameSpot(rightOf(source.position), nodes), selected: false, data },
    edge: { id: linkId(source.id, id), source: source.id, target: id } };
}
