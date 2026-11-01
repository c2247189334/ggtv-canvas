import { describe, expect, it } from 'vitest';
import { newVideoCard, newAudioCard, newCard } from './cards';
import { videoRewriteMaterials, rewriteVideoHints } from './videoRewrite';
import { readCard } from './canvasDoc';
import type { AssetRef, CardData, CardNode } from '@/types';

const source: AssetRef = { type: 'upload', id: 'original-asset', media: 'video', seconds: 5, width: 480, height: 854 };
const node = (id: string, data: CardData): CardNode => ({ id, data, type: 'card', position: { x: 0, y: 0 } });
describe('改写视频独立素材检查', () => {
  it('素材表衣服时段与图片卡标题同样取一位小数，整数不补零，快照不变', () => {
    for (const [from, to, span] of [[0, 2.192691, '0-2.2'], [3.58804, 4.983389, '3.6-5'], [12, 15.047, '12-15']] as const) {
      const item = { id: 'coat', kind: '衣服' as const, desc: '原片衣服描述', from, to, frame: from };
      const nodes = [node('coat', { ...newCard('generate', 1), rewriteItem: item })];
      const table = videoRewriteMaterials(nodes, [{ source: 'coat', target: 'v' }], 'v');
      expect(table[0]).toEqual({ tag: '@图片1', purpose: `衣服 1（${span} 秒穿）`, itemId: item.id, originalDesc: item.desc });
      expect(nodes[0].data.kind === 'image' && nodes[0].data.rewriteItem).toEqual(item);
    }
  });
  it('用途只含称呼和时段，原描述独立从快照传给免费检查；旧卡仍兼容', () => {
    const item = { id: 'coat', kind: '衣服' as const, desc: '蓝黑底色带有复古花卉纹样的短款连衣裙', from: 0, to: 5.5, frame: 2 };
    const nodes = [node('coat', { ...newCard('generate', 1), rewriteItem: item, rewriteItemId: item.id }),
      node('old', newCard('generate', 2))];
    expect(videoRewriteMaterials(nodes, [{ source: 'coat', target: 'v' }, { source: 'old', target: 'v' }], 'v')).toEqual([
      { tag: '@图片1', purpose: '衣服 1（0-5.5 秒穿）', itemId: 'coat', originalDesc: item.desc },
      { tag: '@图片2', purpose: '图片参考' }
    ]);
  });
  it('只看当前连线、节点类型和标题生成准确对照表', () => {
    const nodes = [node('image', { ...newCard('generate', 1), title: '人物' }), node('depth', newVideoCard('depth', 2)),
      node('audio', newAudioCard('extracted', 3))];
    const edges = ['audio', 'image', 'depth', 'missing'].map(id => ({ source: id, target: 'video' }));
    expect(videoRewriteMaterials(nodes, edges, 'video')).toEqual([
      { tag: '@音频1', purpose: '原声，作为背景音乐和节奏参考' }, { tag: '@图片1', purpose: '人物' },
      { tag: '@视频1', purpose: '深度，参考机位、动作、空间和遮挡节奏' }
    ]);
    expect(videoRewriteMaterials(nodes, [{ source: 'original', target: 'depth' }], 'video')).toEqual([]);
  });
  it('只给改写生成视频提示模型2.0和原视频人脸，来源快照跨删除保留', () => {
    const data = { ...newVideoCard('generate', 5), rewriteId: 'r', rewriteSourceId: 'deleted', rewriteSource: source };
    const nodes = [node('copy', newVideoCard('upload', 1, [source]))];
    const edges = [{ source: 'copy', target: 'output' }];
    expect(rewriteVideoHints(data, nodes, edges, 'output')).toEqual(['时间戳会失效，请改回 2.5。', '原视频含人脸，建议只连深度卡。']);
    expect(rewriteVideoHints({ ...data, video: { ...data.video, model: 'doubao-seedance-2-5-260628' } }, nodes, [], 'output')).toEqual([]);
    expect(rewriteVideoHints(newVideoCard('generate', 5), nodes, edges, 'output')).toEqual([]);
    expect(readCard(data)).toMatchObject({ rewriteSource: source });
  });
});
