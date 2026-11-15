import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SaveCharacterForm } from './SaveCharacterDialog';

it('上传图显示授权勾选，不勾不能保存，勾选后可保存', () => {
  const props = { name: '测试人物', description: '', authorized: false, images: [{ type: 'upload' as const, id: 'u' }],
    busy: false, error: null, onName: vi.fn(), onDescription: vi.fn(), onAuthorized: vi.fn(), onSave: vi.fn(), onClose: vi.fn() };
  const html = renderToStaticMarkup(<SaveCharacterForm {...props} />);
  expect(html).toContain('我确认拥有该人物形象的合法使用授权');
  expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""[^>]*>保存<\/button>/);
  const authorized = renderToStaticMarkup(<SaveCharacterForm {...props} authorized />);
  expect(authorized).not.toMatch(/<button[^>]*type="submit"[^>]*disabled/);
  const generated = renderToStaticMarkup(<SaveCharacterForm {...props} images={[{ type: 'work', id: 'w' }]} />);
  expect(generated).not.toContain('合法使用授权');
  expect(generated).not.toMatch(/<button[^>]*type="submit"[^>]*disabled/);
});
