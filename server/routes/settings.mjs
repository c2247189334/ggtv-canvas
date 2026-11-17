// 设置面板接口：填火山 Key 和 TOS 三项（写进 .env.local，只回填没填，不回值）。
// 11-17：这次保存了火山 Key 且给了 checkKey（正式启动才给，测试和假模式不给）就顺手验一下，回 keyCheck。
import { saveKeys } from '../envWrite.mjs';
import { HttpError, readJson, sendJson } from '../http.mjs';

export function settingsRoutes(router, { envFile, envTemplate, readEnv, checkKey, logError }) {
  router.add('POST', '/api/settings/keys', async ({ req, res }) => {
    if (!envFile) throw new HttpError(400, '这次启动没指定配置文件，填不了。请用记事本打开 .env.local 手动填。');
    const body = await readJson(req);
    let result;
    try { result = saveKeys(envFile, body, { template: envTemplate }); }
    catch (err) {
      // 写盘出错（文件被占、没权限）的原文可能带本机路径，只进日志；格式不对的人话原样给页面。
      if (err?.code) { logError?.('设置面板写 .env.local 失败', err); throw new HttpError(500, '写 .env.local 失败（可能被别的程序占着或没有权限），详情看黑窗口或 日志/服务端.log。'); }
      throw new HttpError(400, err.message);
    }
    if (checkKey && result.saved.includes('ARK_API_KEY')) {
      // 验不验得成都不影响保存：出错只当「这次没法验」。
      try { result.keyCheck = await checkKey(readEnv()); } catch { result.keyCheck = 'unknown'; }
    }
    sendJson(res, 200, result);
  });
}
