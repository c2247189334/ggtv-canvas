import { describe, expect, it } from 'vitest';
import { newVideoCard } from './cards';
import { toVideoPrompt } from './videoPrompt';
import { submitVideoBatch } from './videoSend';
import { readCard, toDoc, fromDoc } from './canvasDoc';
import type { VideoJobRequest } from '@/types';

describe('仅改写视频执行双向引用检查', () => {
  it('图片两种别名共享序号，图片视频音频都必须被提到', () => {
    expect(toVideoPrompt('@图像1 @图片2 @视频1 @音频1 背景音乐', 2, 1, 1, true)).toContain('@图像2');
    for (const [text, missing] of [['@图片1 @视频1', '@音频1'], ['@音频1 @视频1', '@图片1'], ['@图片1 @音频1', '@视频1']]) {
      expect(() => toVideoPrompt(text, 1, 1, 1, true)).toThrow(missing);
    }
    expect(() => toVideoPrompt('@图片01 @视频1 @音频1', 1, 1, 1, true)).not.toThrow();
    expect(() => toVideoPrompt('@图像0', 1, 0, 0, true)).toThrow('@图像0');
    expect(() => toVideoPrompt('@音频2', 0, 0, 1, true)).toThrow('@音频2');
    expect(toVideoPrompt('无引用词', 2, 1, 1)).toBe('无引用词');
  });
  it('只在改写出来的视频卡加reference且未提全部参考不交单，普通视频请求不变', async () => {
    const requests: VideoJobRequest[] = [];
    const base = { canvasId: 'c', cardId: 'v', health: { fake: true, tosReady: false }, refs: [{ type: 'upload' as const, id: 'image' }],
      submit: async (request: VideoJobRequest) => { requests.push(request); return { id: 'j' }; }, clear() {}, submitted() {} };
    const card = { ...newVideoCard('generate', 2), rewriteId: 'rewrite', rewriteSourceId: 'original', prompt: '@图片1。0-5秒，人物跳舞。' };
    card.video.model = 'doubao-seedance-2-5-260628';
    await submitVideoBatch({ ...base, card });
    expect(requests[0]).toMatchObject({ taskType: 'reference' });
    await expect(submitVideoBatch({ ...base, card: { ...card, prompt: '0-5秒，人物跳舞。' } })).rejects.toThrow('@图片1');
    expect(requests).toHaveLength(1);
    await submitVideoBatch({ ...base, card: { ...card, rewriteId: undefined, prompt: '普通词' } });
    expect(requests[1]).not.toHaveProperty('taskType');
    await submitVideoBatch({ ...base, card: { ...card, video: { ...card.video, model: 'doubao-seedance-2-0-mini-260615' } } });
    expect(requests[2]).not.toHaveProperty('taskType');
    const loaded = fromDoc(toDoc({ id: 'c', name: '测试' }, [{ id: 'v', type: 'card', position: { x: 0, y: 0 }, data: card }], [])).nodes[0].data;
    expect(loaded).toMatchObject({ rewriteId: 'rewrite', rewriteSourceId: 'original' });
    expect(readCard({ ...card, rewriteId: 2 })).not.toHaveProperty('rewriteId');
  });
  it('改写视频关着生成音频、原视频有声音时，交单带上配回原声的来源；开着声音或原片无声都不带', async () => {
    const requests: VideoJobRequest[] = [];
    const base = { canvasId: 'c', cardId: 'v', health: { fake: true, tosReady: false }, refs: [{ type: 'upload' as const, id: 'image' }],
      submit: async (request: VideoJobRequest) => { requests.push(request); return { id: 'j' }; }, clear() {}, submitted() {} };
    const source = { type: 'upload' as const, id: 'clip', media: 'video' as const, seconds: 9.687, hasAudio: true };
    const card = { ...newVideoCard('generate', 2), rewriteId: 'rewrite', rewriteSourceId: 'original', rewriteSource: source, prompt: '@图片1。0-10秒，人物跳舞。' };
    card.video = { ...card.video, model: 'doubao-seedance-2-5-260628', audio: false };
    await submitVideoBatch({ ...base, card });
    expect(requests[0].soundtrack).toEqual({ type: 'upload', id: 'clip' });
    await submitVideoBatch({ ...base, card: { ...card, video: { ...card.video, audio: true } } });
    await submitVideoBatch({ ...base, card: { ...card, rewriteSource: { ...source, hasAudio: false } } });
    await submitVideoBatch({ ...base, card: { ...card, rewriteId: undefined, prompt: '普通词' } });
    expect(requests.slice(1).map(request => request.soundtrack)).toEqual([undefined, undefined, undefined]);
  });
});
