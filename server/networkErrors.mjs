/** 网络原文只进日志；页面只给检查办法，不显示底层错误码。 */
export function humanNetworkError(error, { timeoutMinutes } = {}) {
  const raw = `${error?.code ?? ''} ${error?.message ?? error} ${error?.cause?.code ?? ''}`;
  let reason = '这台电脑连不上火山，检查一下网络。';
  if (raw.includes('REAL_DNS_PIPE_MISSING')) {
    reason = '当前代理开着假地址（fake-IP / TUN）模式，但不是兼容的 Clash Verge。请关掉这个模式，或改用 Clash Verge 后再试。';
  } else if (timeoutMinutes && (['AbortError', 'TimeoutError'].includes(error?.name) || /ETIMEDOUT/.test(raw))) {
    reason = `豆包 ${timeoutMinutes} 分钟还没答完，已停止等待。`;
  }
  return reason + (error?.notSent === true ? '这次没发出去，没花钱。' : '');
}
