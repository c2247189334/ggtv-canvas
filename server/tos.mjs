// TOS 签名只允许本项目对象前缀；凭据来自调用方读入的 .env.local。
import { createHash, createHmac } from 'node:crypto';
import { transport } from './net.mjs';

const sha = (value) => createHash('sha256').update(value).digest('hex');
const fail = (code) => { throw Object.assign(Error(code), { code }); };

export function tosConfig(env = {}) {
  const config = { TOS_REGION: 'cn-beijing' };
  for (const name of ['TOS_ACCESS_KEY_ID', 'TOS_SECRET_ACCESS_KEY', 'TOS_BUCKET']) {
    const value = String(env[name] ?? '').trim();
    if (!value || /^请/.test(value)) {
      const code = `${name}_MISSING`;
      throw Object.assign(Error(`.env.local 里没填 ${name}（存参考视频要用），这单没发出去，没花钱。`), { code, notSent: true });
    }
    config[name] = value;
  }
  return config;
}

// 下列签名算法逐字搬自旧项目指定范围，唯一修改是允许前缀。
const hmac = (key, value) => createHmac('sha256', key).update(value).digest();
const encode = (value) =>
  encodeURIComponent(String(value)).replace(/[!'()*]/g, (ch) => '%' + ch.charCodeAt(0).toString(16).toUpperCase());

/** 生成一个带签名的临时地址。只允许 GET/PUT，只允许 infinite-canvas/ 这个前缀。 */
export function signedURL(c, method, key, expires = 86400, now = new Date()) {
  if (!['GET', 'PUT'].includes(method) || !/^infinite-canvas\/[a-z0-9.-]+$/.test(key) || expires < 60 || expires > 86400) {
    fail('SIGNING_SCOPE_INVALID');
  }
  const host = `${c.TOS_BUCKET}.tos-cn-beijing.volces.com`;
  const date = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = date.slice(0, 8);
  const scope = `${day}/${c.TOS_REGION}/tos/request`;
  const params = {
    'X-Tos-Algorithm': 'TOS4-HMAC-SHA256',
    'X-Tos-Credential': `${c.TOS_ACCESS_KEY_ID}/${scope}`,
    'X-Tos-Date': date,
    'X-Tos-Expires': expires,
    'X-Tos-SignedHeaders': 'host'
  };
  const query = Object.keys(params).sort().map((k) => `${encode(k)}=${encode(params[k])}`).join('&');
  const path = '/' + key.split('/').map(encode).join('/');
  const canonical = [method, path, query, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const keyBytes = hmac(hmac(hmac(hmac(c.TOS_SECRET_ACCESS_KEY, day), c.TOS_REGION), 'tos'), 'request');
  const signature = hmac(keyBytes, ['TOS4-HMAC-SHA256', date, scope, sha(canonical)].join('\n')).toString('hex');
  return `https://${host}${path}?${query}&X-Tos-Signature=${signature}`;
}

export function createTos({ env = {}, fetch: suppliedFetch, now = () => new Date() } = {}) {
  return {
    async uploadVideo({ buffer, contentType = 'video/mp4' }) {
      const cfg = tosConfig(env);
      try {
        const fetch = suppliedFetch ?? transport(cfg).fetch;
        const bytes = Buffer.from(buffer);
        if (!bytes.length || bytes.length > 200 * 1024 * 1024) fail('TOS_VIDEO_SIZE_INVALID');
        const hash = sha(bytes);
        const key = `infinite-canvas/reference-${hash}.${contentType === 'video/quicktime' ? 'mov' : 'mp4'}`;
        const getUrl = () => signedURL(cfg, 'GET', key, 86400, now());
        let response = await fetch(getUrl(), { timeout: 60000 });
        if (response.status === 404) {
          const timeout = Math.min(1800000, Math.ceil(120000 + bytes.length / 16384 * 1000));
          let put;
          try {
            put = await fetch(signedURL(cfg, 'PUT', key, Math.max(900, Math.ceil(timeout / 1000)), now()), {
              method: 'PUT', headers: { 'Content-Type': contentType }, body: bytes, timeout
            });
          } catch (error) {
            if (error?.name === 'TimeoutError' || error?.cause?.name === 'TimeoutError') fail('TOS_UPLOAD_TIMEOUT');
            throw error;
          }
          if (put.status < 200 || put.status >= 300) fail('TOS_UPLOAD_FAILED');
          response = await fetch(getUrl(), { timeout: 60000 });
        }
        if (response.status < 200 || response.status >= 300) fail('TOS_REFERENCE_NOT_READABLE');
        if (sha(Buffer.from(await response.arrayBuffer())) !== hash) fail('TOS_REFERENCE_HASH_MISMATCH');
        return getUrl();
      } catch (error) {
        const allowed = ['TOS_VIDEO_SIZE_INVALID', 'TOS_UPLOAD_FAILED', 'TOS_UPLOAD_TIMEOUT', 'TOS_REFERENCE_NOT_READABLE', 'TOS_REFERENCE_HASH_MISMATCH'];
        const code = allowed.includes(error?.code) ? error.code : 'TOS_TRANSFER_FAILED';
        throw Object.assign(Error(`参考视频传到 TOS 失败（${code}），这单没发出去，没花钱。`), { code, notSent: true });
      }
    }
  };
}
