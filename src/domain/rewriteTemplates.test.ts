import { expect, it } from 'vitest';
import { rewriteImageTemplate } from './rewriteTemplates';

it('各类出图模板与服务端 imageTemplate 逐字一致，模板只留填写位置', async () => {
  const modulePath = '../../server/videoRewrite/roles.mjs';
  const { imageTemplate } = await import(modulePath);
  for (const kind of ['人物', '衣服', '场景', '道具', '遮挡物', '其他']) {
    expect(rewriteImageTemplate(kind)).toBe(imageTemplate(kind));
    expect(rewriteImageTemplate(kind)).toContain('（在这里写你想要的');
  }
  expect(rewriteImageTemplate('人物')).toContain('单人全身正面照');
  expect(rewriteImageTemplate('衣服')).toContain('不出现人脸');
});
