export const planFixture = () => ({
  products: [{ id: 'A', name: '鞋子', look: '原片黑色厚底鞋', pairs: 1, pieces: 2,
    layout: '开头两只穿在脚上，约 2 秒起脱下放在脚垫上……' }],
  visible: '手和腿', face: false,
  looks: [{ id: 'S1', kind: 'scene', what: '地面', now: '米黄格纹地砖', target: '深灰脚垫' },
    { id: 'S2', kind: 'scene', what: '车内饰', now: '亮黑塑料内饰', target: '中棕色皮革' },
    { id: 'O1', kind: 'outfit', what: '手腕', now: '金色宽手镯', target: '细银色手链' }],
  timeline: [{ from: 0, to: 1, action: '……' }, { from: 1, to: 4, action: '……' },
    { from: 4, to: 14, action: '……' }, { from: 14, to: 15, action: '……' }], unsure: []
});
export const materialFixture = () => [
  { tag: '@视频1', purpose: '原视频，参考动作和运镜' },
  ...[1, 2, 3].map(n => ({ tag: `@图片${n}`, purpose: '商品A · 鞋子', role: 'product', productId: 'A' }))
];
export const looksFixture = () => ({ A: { features: '米白低帮圆头免系带鞋，粉色弧形交叉侧条，白色细齿外底', wear: '直接套脚' } });
