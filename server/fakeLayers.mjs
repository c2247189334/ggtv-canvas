// 假图层分离：验收用，一分钱不花。和 splitLayers 同一个形状。
// 底图 = 原图原样；拆出两个透明椭圆图层，位置在图的左上和右下。
// 提示词写「假失败」→ 假装被火山拒；写「假超时」→ 假装等超时；写「假下载失败」→ 假装扣了费但图层没下到。
import { imageSize } from './imageSize.mjs';
import { shapePng } from './png.mjs';

export function createFakeLayers({ delayMs = 1500 } = {}) {
  return async function splitLayers({ image, prompt }) {
    await new Promise(resolve => setTimeout(resolve, delayMs));
    const text = String(prompt ?? '');
    if (text.includes('假失败')) return { ok: false, status: 400, message: '假火山：按提示词的要求拒绝了这单。', charged: 0 };
    if (text.includes('假超时')) throw new Error('EDIT_TIMEOUT');
    if (text.includes('假下载失败')) return { ok: false, status: 0, charged: 3, message: '火山已经拆好并扣费（3 张），但图层下载失败（试了 3 次）。没有自动重发。' };
    const size = imageSize(image.buffer) ?? { width: 512, height: 512 };
    const { width, height } = size;
    const box = (x1, y1, x2, y2) => [x1, y1, x2, y2].map((value, index) => Math.round(value * (index % 2 ? height : width)));
    const shapes = [
      { name: '假图层 圆', box: box(0.1, 0.1, 0.4, 0.35), color: [230, 80, 60] },
      { name: '假图层 椭圆', box: box(0.55, 0.6, 0.9, 0.85), color: [60, 140, 230] }
    ];
    // 真火山给的图层比框大好几倍（11-16 真测约 4 倍），假的也放大 2 倍，页面要按框的大小显示。
    const layers = shapes.map(shape => ({ name: shape.name, box: shape.box,
      buffer: shapePng((shape.box[2] - shape.box[0]) * 2, (shape.box[3] - shape.box[1]) * 2, shape.color) }));
    return { ok: true, count: 1 + layers.length, base: { buffer: image.buffer, width, height }, layers };
  };
}

/**
 * 假图层重绘：和真的（generateOne 透明底）同一个形状。出一张同样大小的绿色透明椭圆。
 * 提示词写「假失败」→ 假装被火山拒；写「假超时」→ 假装等超时。
 */
export function createFakeRedraw({ delayMs = 1500 } = {}) {
  return async function redraw({ prompt, images }) {
    await new Promise(resolve => setTimeout(resolve, delayMs));
    const text = String(prompt ?? '');
    if (text.includes('假失败')) return { ok: false, status: 400, message: '假火山：按提示词的要求拒绝了这单。' };
    if (text.includes('假超时')) throw new Error('EDIT_TIMEOUT');
    const { width, height } = imageSize(images?.[0]?.buffer ?? Buffer.alloc(0)) ?? { width: 256, height: 256 };
    return { ok: true, image: shapePng(width, height, [40, 180, 90]) };
  };
}
