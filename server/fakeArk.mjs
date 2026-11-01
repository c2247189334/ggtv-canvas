// 假火山：验收时用，一分钱不花。和 generateOne 同一个形状，排队那边分不出真假。
// 只在 --fake 启动时用（页面右上角会显示「假火山」），数据默认落在 .fake-data/，不碰真的 数据/。
// 提示词里写「假失败」→ 假装被火山拒；写「假超时」→ 假装等超时。用来把失败那几条路点一遍。
import { createHash } from 'node:crypto';
import { solidPng } from './png.mjs';

/** 假图的尺寸：比例跟着要的尺寸走，长边 256（省硬盘）。 */
export function fakeSize(size) {
  const match = /^(\d+)x(\d+)$/.exec(String(size ?? ''));
  if (!match) return { width: 256, height: 256 };
  const width = Number(match[1]);
  const height = Number(match[2]);
  const scale = 256 / Math.max(width, height);
  return { width: Math.max(16, Math.round(width * scale)), height: Math.max(16, Math.round(height * scale)) };
}

export function createFakeArk({ delayMs = 1500 } = {}) {
  let made = 0;
  return async function generateOne({ prompt, size }) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    const text = String(prompt ?? '');
    if (text.includes('假失败')) return { ok: false, status: 400, message: '假火山：按提示词的要求拒绝了这单。' };
    if (text.includes('假超时')) throw new Error('EDIT_TIMEOUT');
    made += 1;
    const digest = createHash('sha256').update(`${text}#${made}`).digest();
    const { width, height } = fakeSize(size);
    return { ok: true, image: solidPng(width, height, [digest[0], digest[1], digest[2]]) };
  };
}
