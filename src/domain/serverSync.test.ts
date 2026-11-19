import { describe, expect, it } from 'vitest';
import { LAYER_YUAN, MAX_LAYER_IMAGES } from './layers';
import { uploadKind } from './media';
import { IMAGE_MODELS } from './pricing';
import { lastTenth } from './rewriteLines';
import { TEXT_KINDS } from './rewritePeers';
import { STRENGTH_OPTIONS } from './settingsPanel';
import { DEFAULT_VIDEO_SETTINGS, VIDEO_MODELS, VIDEO_RATIOS, checkVideoRefs, normalizeVideoSettings } from './videoModels';
import {
  REWRITE_MESH_PURPOSE, REWRITE_NEW_SCENE_PURPOSE, REWRITE_VIDEO_MODEL,
  outfitChangeSeconds, planChangeSeconds, sceneItems, scenesInUse
} from './videoRewrite';
import type { RewriteItem, RewriteMaterial, RewritePlan } from '@/videoRewriteTypes';

// 两边对账：页面和小服务各写一份的表、常量和规则，改了一边忘了另一边，这里就红。
// 小服务是没有类型的 .mjs，用变量路径动态载入（和 rewriteTemplates.test.ts 同一个办法）。
// 以后再出现「两边一起改」的东西，在这里加一条。
const server = (file: string) => {
  const path = '../../server/' + file;
  return import(path);
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

describe('视频模型表', () => {
  it('比例、型号、清晰度、像素表、各项上限和默认设置两边一样', async () => {
    const s = await server('videoModels.mjs');
    expect(s.VIDEO_RATIOS).toEqual(VIDEO_RATIOS);
    expect(s.DEFAULT_VIDEO_SETTINGS).toEqual(DEFAULT_VIDEO_SETTINGS);
    // 单价只在小服务那份里（页面不显示金额），去掉再比。
    const serverModels = (s.VIDEO_MODELS as Array<Record<string, unknown>>)
      .map(model => Object.fromEntries(Object.entries(model).filter(([key]) => key !== 'prices')));
    expect(serverModels).toEqual(VIDEO_MODELS);
  });

  it('页面能选的每个清晰度，小服务都有单价', async () => {
    const s = await server('videoModels.mjs');
    for (const model of VIDEO_MODELS) for (const resolution of model.resolutions)
      expect(s.videoPrice(model.id, resolution), `${model.name} ${resolution}`).toBeGreaterThan(0);
  });

  it('设置纠正：同样的输入，两边纠成一样', async () => {
    const s = await server('videoModels.mjs');
    const diffs: string[] = [];
    for (const model of [...VIDEO_MODELS.map(entry => entry.id), '认不出的型号', undefined])
      for (const mode of ['reference', 'first_frame', '乱写', undefined])
        for (const ratio of [...VIDEO_RATIOS, '2:1', undefined])
          for (const resolution of ['480p', '720p', '1080p', '4k', undefined])
            for (const duration of [1, 4, 5, 7.6, 15, 16, 30, 99, Number.NaN, undefined])
              for (const audio of [true, false, undefined]) {
                const input = { model, mode, ratio, resolution, duration, audio };
                if (!same(s.normalizeVideoSettings(input), normalizeVideoSettings(input))) diffs.push(JSON.stringify(input));
              }
    expect(diffs.slice(0, 5)).toEqual([]);
  });

  it('参考检查：同样的参考，两边报同样的问题（原话也一样）', async () => {
    const s = await server('videoModels.mjs');
    const seconds: number[][] = [[], [5], [1], [16], [31], [5, 5, 5], [5, 5, 5, 5], [10, 10, 10, 10], Array<number>(11).fill(2)];
    const diffs: string[] = [];
    for (const model of [...VIDEO_MODELS.map(entry => entry.id), '认不出的型号'])
      for (const mode of ['reference', 'first_frame', '乱写'])
        for (const images of [0, 1, 2, 9, 10, 30, 31, 41, -1, 1.5])
          for (const videos of seconds)
            for (const audios of [undefined, ...seconds]) {
              const input = { model, mode, images, videos, audios };
              if (!same(s.checkVideoRefs(input), checkVideoRefs(input))) diffs.push(JSON.stringify(input));
            }
    expect(diffs.slice(0, 5)).toEqual([]);
  });
});

describe('出图和上传', () => {
  it('页面列的出图型号和小服务的单价表是同一批', async () => {
    const s = await server('pricing.mjs');
    expect(Object.keys(s.IMAGE_PRICES).sort()).toEqual(IMAGE_MODELS.map(model => model.id).sort());
  });

  it('图层拆分：页面提示里写的单价和张数上限，就是小服务用的', async () => {
    const [prices, split] = await Promise.all([server('pricing.mjs'), server('layerSplit.mjs')]);
    expect(LAYER_YUAN).toBe(prices.IMAGE_PRICES[split.LAYER_MODEL]);
    expect(MAX_LAYER_IMAGES).toBe(split.MAX_LAYER_IMAGES);
  });

  it('视频上传大小上限：页面拦的和小服务收的是同一个数', async () => {
    const s = await server('routes/assets.mjs');
    const file = (size: number) => ({ name: 'a.mp4', type: 'video/mp4', size });
    expect(uploadKind(file(s.MAX_VIDEO_UPLOAD_BYTES), true).kind).toBe('video');
    expect(() => uploadKind(file(s.MAX_VIDEO_UPLOAD_BYTES + 1), true)).toThrow();
  });
});

describe('视频改写', () => {
  const item = (id: string, kind: RewriteItem['kind'], from: number, to: number, more: Partial<RewriteItem> = {}): RewriteItem =>
    ({ id, kind, desc: id, from, to, frame: from, ...more });
  const planOf = (items: RewriteItem[], changes: number[] = []): RewritePlan => ({
    summary: '', items, changes: changes.map(second => ({ second, how: '' })), actions: [], replace: items.map(entry => entry.id), unsure: []
  });
  const plans: Record<string, RewritePlan> = {
    一套衣服一个场景: planOf([item('P1', '人物', 0, 15), item('C1', '衣服', 0, 15), item('S1', '场景', 0, 15)]),
    // 4.75 卡在「开始前 0.3 秒」的窗口边上：窗口改小就不算了，下面 4.6 那张是窗口改大才算。
    换一次装变化点在交界前: planOf([item('C1', '衣服', 0, 5), item('C2', '衣服', 5, 15)], [4.75, 9]),
    变化点早了一点不算交界: planOf([item('C1', '衣服', 0, 5), item('C2', '衣服', 5, 15)], [4.6]),
    两套中间隔了一段: planOf([item('C1', '衣服', 0, 4), item('C2', '衣服', 6, 15)], [3.6, 3.8, 5]),
    换两次装中间穿回第一套: planOf([item('C1', '衣服', 0, 4), item('C2', '衣服', 4, 9), item('C3', '衣服', 9, 15, { sameAs: 'C1' })], [3.9, 4, 8.5]),
    两个人各换各的: planOf([
      item('A1', '衣服', 0, 6, { person: 'P1' }), item('A2', '衣服', 6, 15, { person: 'P1' }),
      item('B1', '衣服', 0.4, 8, { person: 'P2' }), item('B2', '衣服', 8, 15, { person: 'P2' })
    ], [5.8]),
    换了三个地方顺序打乱: planOf([item('S2', '场景', 3.7, 6.5), item('S1', '场景', 0, 3.7), item('S3', '场景', 6.5, 17)]),
    同一秒又换装又换场: planOf([item('C1', '衣服', 0, 5), item('C2', '衣服', 5, 12), item('S1', '场景', 0, 5), item('S2', '场景', 5, 12)])
  };

  it('素材用途的原话、能用文字的种类、改写用的型号两边一样', async () => {
    const [roles, itemTexts, models] = await Promise.all([
      server('videoRewrite/roles.mjs'), server('videoRewrite/itemTexts.mjs'), server('videoModels.mjs')
    ]);
    expect(REWRITE_NEW_SCENE_PURPOSE).toBe(roles.NEW_SCENE_PURPOSE);
    expect(REWRITE_MESH_PURPOSE).toBe(roles.MESH_PURPOSE);
    expect([...TEXT_KINDS]).toEqual(itemTexts.TEXT_KINDS);
    expect(models.videoModelOf(REWRITE_VIDEO_MODEL)).toBeTruthy();
  });

  it('换装点、换场点：同一张拆解单，两边算出同样的秒数', async () => {
    const rules = await server('videoRewrite/rules.mjs');
    for (const [name, plan] of Object.entries(plans)) {
      expect(rules.outfitChangeSeconds(plan), name).toEqual(outfitChangeSeconds(plan));
      expect(rules.sceneItems(plan), name).toEqual(sceneItems(plan));
      expect(rules.planChangeSeconds(plan), name).toEqual(planChangeSeconds(plan));
    }
  });

  it('换新背景时还算数的场景：两边留下的是同一批', async () => {
    const input = await server('videoRewrite/input.mjs');
    const plan = plans.换了三个地方顺序打乱;
    const fresh = (itemId?: string): RewriteMaterial => ({ tag: '@图片1', purpose: REWRITE_NEW_SCENE_PURPOSE, ...(itemId ? { itemId } : {}) });
    const cases: Array<{ name: string; materials: RewriteMaterial[]; texts: string[] }> = [
      { name: '背景跟原片', materials: [{ tag: '@图片1', purpose: '背景', itemId: 'S1' }], texts: [] },
      { name: '只连着第一段', materials: [fresh('S1')], texts: [] },
      { name: '连着第一段，第三段用文字', materials: [fresh('S1')], texts: ['S3'] },
      { name: '新场景卡没带场景编号', materials: [fresh()], texts: [] }
    ];
    for (const { name, materials, texts } of cases)
      expect(input.scenesInUse(plan, materials, texts.map(sceneId => ({ sceneId }))), name).toEqual(scenesInUse(plan, materials, texts));
  });
});

describe('设置', () => {
  it('写词强度：页面能点的档，就是小服务认的档，顺序一样', async () => {
    const s = await server('agentStrength.mjs');
    expect(STRENGTH_OPTIONS.map(option => option.id)).toEqual(Object.keys(s.STRENGTHS));
    expect(STRENGTH_OPTIONS.map(option => option.id)).not.toContain(s.CUSTOM);
  });
});

describe('说话版台词秒数', () => {
  // 11-19 上传前审查：先夹再四舍五入会把 8.47 秒的片尾进成 8.5、超出片长；两边都改成往下取到 0.1 秒为上限。
  it('片长往下取到 0.1 秒的上限两边一样', async () => {
    const s = await server('videoRewrite/lines.mjs');
    for (const duration of [4, 8.4, 8.45, 8.466667, 8.49, 12.05, 15.3, 29.999, 30]) {
      expect(s.lastTenth(duration)).toBe(lastTenth(duration));
      expect(lastTenth(duration)).toBeLessThanOrEqual(duration);
    }
  });
});
