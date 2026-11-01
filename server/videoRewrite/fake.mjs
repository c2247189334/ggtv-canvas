import { setTimeout } from 'node:timers/promises';

/** 假拆解（零花费）：照 10-30 窄拆解回话的样子，一人四衣一样东西；短片等比压缩换装秒数，长片保持三个换装点。 */
export async function fakeRound({ context }, { delayMs = 0 } = {}) {
  if (delayMs > 0) await setTimeout(delayMs);
  if (context.userText?.includes('假拆解失败')) throw Error('假拆解失败：这是验收用的拆解失败，没有调用豆包。');
  const { duration } = context;
  const factor = Math.min(1, duration / 15.05), time = value => Math.round(value * factor * 1e6) / 1e6;
  const boundaries = [0, time(5.5), time(9), time(12.5), duration];
  return {
    people: [{ id: 'P1', desc: '女生，黑色长发', from: 0, to: duration }],
    clothes: ['上衣长裤，浅色棉质', '连衣裙，红色', '短裙，深色', '长裙，浅色'].map((desc, i) => ({ id: `C${i + 1}`, person: 'P1', desc, from: boundaries[i], to: boundaries[i + 1] })),
    things: [{ id: 'D1', desc: '吊扇叶片，深色木质' }],
    replace: ['P1', 'C1', 'C2', 'C3', 'C4'], unsure: ['画面上方的东西是不是吊扇叶片']
  };
}
