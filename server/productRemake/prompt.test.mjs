import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeProductPrompt } from './writePrompt.mjs';
import { lookProducts } from './lookProducts.mjs';
import { checkProductRules } from './rules.mjs';
import { planFixture, materialFixture, looksFixture } from './productFixture.mjs';

const input = () => ({ plan: planFixture(), materials: materialFixture(), duration: 15, ratio: '9:16', userText: '鞋子', model: 'doubao-seedance-2-0-260128' });
test('第6节例子逐字拼出，素材/数量/外观/时间轴/统一要求顺序固定', () => {
  const { videoPrompt, warnings } = writeProductPrompt(input(), looksFixture());
  assert.equal(videoPrompt, [
    '@视频1 是参考视频：严格参考它的动作、手脚和商品的接触、运镜、构图和场景布局，顺序和节奏与视频保持一致。',
    '@图片1、@图片2、@图片3 是同一款鞋子（商品A）的不同角度：商品A的外观、颜色和结构只照这几张图，不采用 @视频1 里原来那款鞋子的外观，也不采用图里的人、衣服和背景。商品A：米白低帮圆头免系带鞋，粉色弧形交叉侧条，白色细齿外底；直接套脚。',
    '数量和摆位：商品A全片共 1 双 2 只；开头两只穿在脚上，约 2 秒起脱下放在脚垫上……。',
    '外观：地面是深灰脚垫；车内饰是中棕色皮革；手腕是细银色手链。',
    '0-1 秒：……；1-4 秒：……；4-14 秒：……；14-15 秒：……。',
    '同一商品每次出现都保持一样；画面里只露出手和腿，不出现人脸；不要字幕。'
  ].join('\n'));
  assert.deepEqual(checkProductRules({ ...input(), videoPrompt }), []);
  assert.deepEqual(warnings, ['2.0 可能不认秒数，时间轴只作参考']);
});

test('单图、多商品、背景职责，原look/now禁入，未知图不写，提醒不阻拦', () => {
  const value = input(); value.plan.face = true; value.plan.unsure = ['脚垫边缘看不清'];
  value.plan.products.push({ id: 'B', name: '包', look: '原片红色包', pairs: 0, pieces: 1, layout: '右侧' });
  value.materials = [value.materials[0], value.materials[1], { tag: '@图片2', purpose: '背景', role: 'background' },
    { tag: '@图片3', purpose: '商品B', role: 'product', productId: 'B' }, { tag: '@图片4', purpose: '随手连的图' }];
  const { videoPrompt, warnings } = writeProductPrompt(value, { A: { features: '', wear: '看不出' }, B: { features: '蓝色帆布包', wear: '' } });
  assert.match(videoPrompt, /@图片1 是鞋子（商品A）/); assert.match(videoPrompt, /@图片3 是包（商品B）/);
  assert.match(videoPrompt, /@图片2 是场景：场景的颜色、材质和光线照它，布局和机位照 @视频1。/);
  assert.doesNotMatch(videoPrompt, /@图片4|看不出|原片黑色厚底鞋|米黄格纹地砖|深灰脚垫|中棕色皮革/);
  assert.match(videoPrompt, /外观：手腕是细银色手链。/);
  assert.ok(warnings.some(w => w.includes('原片可能露脸'))); assert.ok(warnings.some(w => w.includes('商品A') && w.includes('1')));
  assert.ok(warnings.includes('脚垫边缘看不清'));
  assert.ok(checkProductRules({ ...value, videoPrompt }).includes('@图片4 没身份：放进商品组或剪掉连线'));
});

test('看商品图只问features/wear，按商品聚合所有角度，带编号/编辑词丢掉、过长截断、非鞋不写wear', async () => {
  const value = input(), calls = [];
  value.plan.products.push({ id: 'B', name: '包', look: '', pairs: 0, pieces: 1, layout: '' });
  value.materials.push({ tag: '@图片4', purpose: '商品B', role: 'product', productId: 'B', asset: { type: 'upload', id: 'x' } });
  const result = await lookProducts({ products: value.plan.products, materials: value.materials.slice(1), images: ['1', '2', '3', '4'] }, {
    ask: async request => { calls.push(request); return { products: [{ id: 'A', features: '白'.repeat(100), wear: '直接套脚' }, { id: 'B', features: '@图片4 替换红包', wear: '要系带' }] }; }
  });
  assert.equal(calls.length, 1); assert.equal(calls[0].images.length, 4);
  assert.match(calls[0].text, /features/); assert.match(calls[0].text, /wear/); assert.doesNotMatch(calls[0].text, /plainClothes|views/);
  assert.deepEqual(result.A, { features: '白'.repeat(80), wear: '直接套脚' }); assert.deepEqual(result.B, { features: '', wear: '' });
  const numbered = await lookProducts({ products: value.plan.products.slice(0, 1), materials: value.materials.slice(1, 2), images: ['1'] },
    { ask: async () => ({ products: [{ features: '商品A白鞋', wear: '看不出' }] }) });
  assert.equal(numbered.A.features, '');
});

test('免费检查复用基础规则，通过正常词，拒绝缺编号/原描述/编辑词/非整数或断轴/字幕/背景无场景/视频缺动作运镜', () => {
  const value = input(), good = writeProductPrompt(value, looksFixture()).videoPrompt;
  const cases = [good.replace('@图片3', ''), good + '原片黑色厚底鞋', good + '替换', good.replace('1-4 秒', '1.2-4 秒'),
    good.replace('1-4 秒', '2-4 秒'), good.replace('不要字幕', '中文字幕'), good.replace('动作、', ''), good.replace('运镜、', '')];
  for (const videoPrompt of cases) assert.ok(checkProductRules({ ...value, videoPrompt }).length > 0, videoPrompt);
  assert.ok(checkProductRules({ ...value, videoPrompt: good + '@图片99' }).some(w => w.includes('不存在')));
  value.materials.push({ tag: '@图片4', purpose: '背景', role: 'background' });
  assert.ok(checkProductRules({ ...value, videoPrompt: good.replace('\n数量', '\n@图片4参考颜色。\n数量') }).some(w => w.includes('场景')));
});

// 11-04 改：编辑词只剔掉所在小句（原来整段丢，车里那条手表换色因「加上」整条没了）。
test('自动拼词过滤动作/摆位中的编辑触发词，整数时段到ceil来源结尾', () => {
  const value = input();
  value.duration = 15.1; value.plan.timeline = [{ from: 0, to: 16, action: '替换黑鞋，抬起左脚' }];
  value.plan.products[0].layout = '增加一双在右边';
  const written = writeProductPrompt(value, looksFixture());
  assert.doesNotMatch(written.videoPrompt, /替换|增加/);
  assert.match(written.videoPrompt, /0-16 秒：抬起左脚。/);
  assert.deepEqual(checkProductRules({ ...value, ...written }), []);
  const lone = input(); lone.plan.timeline = [{ from: 0, to: 15, action: '替换黑鞋' }];
  assert.match(writeProductPrompt(lone, looksFixture()).videoPrompt, /0-15 秒：按参考视频完成动作/);
});

test('11-04 真拆：原片商品的品牌颜色、时间段、小数秒按小句剔掉，商品名用用户原话，露出部位只留身体部位', () => {
  const value = input();
  value.plan.products[0] = { id: 'A', name: '阿迪达斯 adiSTAR 跑步鞋', look: '白色网眼鞋面，银色饰条，侧面三道黑色条纹，鞋舌有 adidas adiSTAR 标',
    pairs: 1, pieces: 2, layout: '0.6-2.0秒穿在脚上，踩在紫红色脚垫上，之后放在中控台上' };
  value.plan.looks = [{ id: 'S1', kind: 'scene', what: '地面', now: '紫红色的毛绒脚垫', target: '深灰脚垫' },
    { id: 'S2', kind: 'scene', what: 'adidas 鞋盒', now: '灰白盒身', target: '深蓝色盒身' },
    { id: 'O1', kind: 'outfit', what: '手腕', now: '银色链条手链', target: '金色皮质表带手表，加上黑色编绳手链' }];
  value.plan.visible = '手、手腕（戴银色手表）、小腿；一直到13秒后才露出短裤';
  value.plan.timeline = [{ from: 0, to: 5, action: '她拿起两只鞋，并排举到面前，亮出鞋头的银色饰条' },
    { from: 5, to: 10, action: '近拍 adidas 标，11.6 秒时只剩一条腿，随后放下' }, { from: 10, to: 15, action: '光脚踩在脚垫上' }];
  const { videoPrompt } = writeProductPrompt(value, looksFixture());
  assert.doesNotMatch(videoPrompt, /adidas|adiSTAR|阿迪达斯|紫红|0\.6|11\.6|13秒|饰条|加上/);
  assert.match(videoPrompt, /是同一款鞋子（商品A）的不同角度/);
  assert.match(videoPrompt, /数量和摆位：商品A全片共 1 双 2 只；之后放在中控台上。/);
  assert.match(videoPrompt, /外观：地面是深灰脚垫；鞋盒是深蓝色盒身；手腕是金色皮质表带手表。/);
  assert.match(videoPrompt, /0-5 秒：她拿起两只鞋，并排举到面前；5-10 秒：随后放下；10-15 秒：光脚踩在脚垫上。/);
  assert.match(videoPrompt, /画面里只露出手、手腕、小腿，不出现人脸/);
  assert.deepEqual(checkProductRules({ ...value, videoPrompt }), []);
});

test('数量：只见一只写「1 只」，双数和只数对得上才写「几双几只」，用户原话含拆解名时用拆解名', () => {
  const count = (pairs, pieces) => { const value = input(); Object.assign(value.plan.products[0], { pairs, pieces });
    return writeProductPrompt(value, looksFixture()).videoPrompt.match(/全片共 [^；。]+/)?.[0]; };
  assert.equal(count(1, 1), '全片共 1 只'); assert.equal(count(0, 1), '全片共 1 只');
  assert.equal(count(2, 4), '全片共 2 双 4 只'); assert.equal(count(1, 0), '全片共 1 双');
  const two = input(); two.userText = '鞋子和包';
  two.plan.products.push({ id: 'B', name: '包', look: '', pairs: 0, pieces: 1, layout: '' });
  two.materials.push({ tag: '@图片4', purpose: '商品B', role: 'product', productId: 'B' });
  assert.match(writeProductPrompt(two, looksFixture()).videoPrompt, /@图片4 是包（商品B）/);
});

test('11-04 晚三组同款鞋：每组一句带位置，跟商品A一样的组照 A 的图，结尾一句只有这 3 组', () => {
  const value = input();
  value.plan.products = [
    { id: 'A', name: '鞋子', where: '脚上', look: '原片香槟色尖头鞋', pairs: 1, pieces: 2, layout: '开头在台面上，拿起后穿在脚上' },
    { id: 'B', name: '鞋子', where: '后排上层', look: '原片银色尖头鞋', pairs: 1, pieces: 2, layout: '一直摆在后排上层', sameAs: 'A' },
    { id: 'C', name: '鞋子', where: '后排下层', look: '原片黑色尖头鞋', pairs: 1, pieces: 2, layout: '一直摆在后排下层' }];
  value.materials = [value.materials[0], value.materials[1], value.materials[2],
    { tag: '@图片3', purpose: '商品C', role: 'product', productId: 'C' }];
  const { videoPrompt, warnings } = writeProductPrompt(value, { A: { features: '', wear: '' }, C: { features: '', wear: '' } });
  assert.match(videoPrompt, /@图片1、@图片2 是同一款鞋子（商品A，脚上那组）的不同角度：.*不采用 @视频1 里原来那组鞋子的外观/);
  assert.match(videoPrompt, /商品B（后排上层那组）和商品A同款同色：外观、颜色和结构也只照 @图片1、@图片2，不采用 @视频1 里原来那组鞋子的外观。/);
  assert.match(videoPrompt, /@图片3 是鞋子（商品C，后排下层那组）/);
  assert.match(videoPrompt, /商品A（脚上）全片共 1 双 2 只；开头在台面上，拿起后穿在脚上；商品B（后排上层）全片共 1 双 2 只；一直摆在后排上层；商品C（后排下层）/);
  assert.match(videoPrompt, /画面里的鞋子只有商品A、商品B、商品C这 3 组，每组照各自的图，不出现 @视频1 里原来的鞋子。/);
  assert.doesNotMatch(videoPrompt, /香槟|银色尖头|黑色尖头/);
  assert.ok(!warnings.some(w => w.includes('商品B')));
  assert.deepEqual(checkProductRules({ ...value, videoPrompt }), []);
});

test('鞋子和包两款时不写「只有以上几组」，单款仍写「原来那款」', () => {
  const value = input();
  value.plan.products.push({ id: 'B', name: '包', look: '', pairs: 0, pieces: 1, layout: '右侧' });
  value.materials.push({ tag: '@图片4', purpose: '商品B', role: 'product', productId: 'B' });
  const { videoPrompt } = writeProductPrompt(value, {});
  assert.match(videoPrompt, /原来那款鞋子/); assert.match(videoPrompt, /原来那款包/);
  assert.doesNotMatch(videoPrompt, /只有商品/);
});
