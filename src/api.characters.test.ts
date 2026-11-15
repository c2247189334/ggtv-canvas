import { afterEach, expect, it, vi } from 'vitest';
import { api } from './api';

afterEach(() => vi.unstubAllGlobals());

it('人物五接口保留完整响应，写入字段和请求路径正确', async () => {
  const character = { id: 'p', name: '人物', description: '描述', images: [], status: 'generating' };
  const fetcher = vi.fn(async (_path: string, init?: RequestInit) => new Response(JSON.stringify(
    init?.method === 'GET' ? [character] : init?.method === 'DELETE' ? { ok: true } : character)));
  vi.stubGlobal('fetch', fetcher);
  const save = { name: '人物', description: '', images: [{ type: 'upload' as const, id: 'u', assetId: 'asset_1' }], authorized: true };
  await expect(api.listCharacters()).resolves.toEqual([character]);
  await expect(api.saveCharacter(save)).resolves.toEqual(character);
  await expect(api.generateCharacter({ description: '描述', id: 'p' })).resolves.toEqual(character);
  await expect(api.patchCharacter({ id: 'p', name: '新名字', description: '新描述' })).resolves.toEqual(character);
  await expect(api.deleteCharacter('p with space')).resolves.toEqual({ ok: true });
  expect(fetcher.mock.calls.map(([path, init]) => [path, init?.method])).toEqual([
    ['/api/characters', 'GET'], ['/api/characters', 'POST'], ['/api/characters/generate', 'POST'],
    ['/api/characters', 'PATCH'], ['/api/characters?id=p%20with%20space', 'DELETE']
  ]);
  expect(JSON.parse(fetcher.mock.calls[1][1]!.body as string)).toEqual(save);
  expect(JSON.parse(fetcher.mock.calls[2][1]!.body as string)).toEqual({ description: '描述', id: 'p' });
});

it('人物接口失败显示服务给出的中文原话', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: '先勾选授权' }), { status: 400 })));
  await expect(api.saveCharacter({ name: '人', description: '', images: [], authorized: false })).rejects.toThrow('先勾选授权');
});
