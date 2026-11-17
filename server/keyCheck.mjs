// 设置里保存火山 Key 后顺手验一下（11-17 用户定：新手填错了要当场知道，别等到出图才报错）。
// 做法：拿这把 Key 查一个不存在的视频任务。查询不花钱，也不会建任何东西。
// 只认 401（没通过身份验证）= Key 不对；别的状态（查不到、没开通……）都说明火山认了这把 Key；
// 连不上、超时 = 这次没法验。Key 只进请求头，不写日志、不回给页面。
import { seedreamConfig } from './seedream.mjs';
import { transport } from './net.mjs';

const PROBE_TASK = 'cgt-ggtv-key-check';

/** 返回 'accepted'（火山认）/ 'rejected'（火山回 401）/ 'unknown'（没法验）。不抛。 */
export async function checkArkKey(env, { fetch = transport({ TOS_BUCKET: String(env?.TOS_BUCKET ?? '').trim() }).fetch, timeout = 8000 } = {}) {
  let cfg;
  try { cfg = seedreamConfig(env); } catch { return 'unknown'; }
  try {
    const response = await fetch(`${cfg.base}/contents/generations/tasks/${PROBE_TASK}`, {
      headers: { Authorization: `Bearer ${cfg.key}` }, timeout
    });
    return response.status === 401 ? 'rejected' : 'accepted';
  } catch { return 'unknown'; }
}
