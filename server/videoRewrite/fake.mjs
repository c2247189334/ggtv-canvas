import { setTimeout } from 'node:timers/promises';

/** 假拆解（零花费）：照 10-30 窄拆解回话的样子，一人四衣一样东西；短片等比压缩换装秒数，长片保持三个换装点。 */
export async function fakeRound({ context }, { delayMs = 0 } = {}) {
  if (delayMs > 0) await setTimeout(delayMs);
  if (context.userText?.includes('假拆解失败')) throw Error('假拆解失败：这是验收用的拆解失败，没有调用本机 agent。');
  const { duration } = context;
  const factor = Math.min(1, duration / 15.05), time = value => Math.round(value * factor * 1e6) / 1e6;
  const boundaries = [0, time(5.5), time(9), time(12.5), duration];
  const onlyPerson = context.userText?.includes('假只换人'), empty = Boolean(context.userText?.includes('假无人'));
  const middle = (from, to) => Math.round((from + to) * 50) / 100;
  const scenes = context.userText?.includes('假多场景') ? ['客厅，暖光', '红墙，日光', '花园，日光', '海边，黄昏']
    .map((desc, i) => ({ id: `S${i + 1}`, desc, from: boundaries[i], to: boundaries[i + 1], frame: middle(boundaries[i], boundaries[i + 1]), empty }))
    : [{ id: 'S1', desc: '客厅，暖光', from: 0, to: duration, frame: middle(0, duration), empty }];
  // 11-19 说话版：一句镜头外的人问、两句出镜的人答；原话写「假无字幕」就回空的（小服务按人声时段铺空行）。
  const talk = context.talking && !context.userText?.includes('假无字幕')
    ? { lines: [{ who: '镜头外', text: '哎一样的东西你怎么买两个', from: 0, to: time(1.9) }, { who: 'P1', text: '我本来是给我妈买的', from: time(2.1), to: time(4.5) },
      { who: 'P1', text: '结果自己试了一下真的太好用了', from: time(4.6), to: time(7.5) }] } : context.talking ? { lines: [] } : {};
  return {
    ...talk,
    people: [{ id: 'P1', desc: '女生，黑色长发', from: 0, to: duration, ...(onlyPerson ? { where: '上半屏' } : {}) }],
    clothes: ['上衣长裤，浅色棉质', '连衣裙，红色', '短裙，深色', '长裙，浅色'].map((desc, i) => ({ id: `C${i + 1}`, person: 'P1', desc, from: boundaries[i], to: boundaries[i + 1], ...(onlyPerson && i === 3 ? { sameAs: 'C2' } : {}) })),
    things: [{ id: 'D1', desc: '吊扇叶片，深色木质' }],
    replace: onlyPerson ? ['P1'] : ['P1', 'C1', 'C2', 'C3', 'C4'], unsure: ['画面上方的东西是不是吊扇叶片'], scenes
  };
}
