import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { KeyNeededView } from './KeyNeededDialog';
import { KEY_NEEDED_TEXT, askIfKeyError, askIfKeyMissing, closeKeyNeeded, keyNeededOpen, keyReadyOrAsk, openSettings, requireKey, subscribeOpenSettings } from './keyNeeded';
import type { Health } from '@/types';

afterEach(() => closeKeyNeeded());
const health = (patch: Partial<Health>) => ({ ok: true, fake: false, keyReady: true, tosReady: true, todayYuan: 0, uncertainToday: 0, ...patch }) as Health;

// 11-17 用户定：没填 Key 点发送要弹框，不能只有面板里一行红字。
it('说明框讲清干嘛、花不花钱、缺什么、怎么办，带「去填 Key」和「先不填」两个按钮', () => {
  const html = renderToStaticMarkup(<KeyNeededView onFill={() => {}} onClose={() => {}} />);
  expect(html).toContain('role="dialog"'); expect(html).toContain('aria-modal="true"');
  for (const text of ['要先填火山 Key', '这一步干嘛', '花不花钱', '从你自己的火山账号扣', '现在缺什么', '这单没发出去，没花钱', '怎么办', '怎么拿 Key', '>去填 Key<', '>先不填<']) {
    expect(html).toContain(text);
  }
  expect(html).not.toContain('ARK_API_KEY');
  expect(html).not.toContain('.env.local');
});

it('填了、假模式、体检没带这一项都不弹；明确没填才弹，关掉就清', () => {
  expect(askIfKeyMissing(health({ keyReady: true }))).toBe(false);
  expect(askIfKeyMissing(health({ fake: true, keyReady: false }))).toBe(false);
  expect(askIfKeyMissing({ fake: false } as Health)).toBe(false);
  expect(keyNeededOpen()).toBe(false);
  expect(askIfKeyMissing(health({ keyReady: false }))).toBe(true);
  expect(keyNeededOpen()).toBe(true);
  closeKeyNeeded(); expect(keyNeededOpen()).toBe(false);
});

it('交单前读一次体检：没填就弹框并抛人话；体检读不到就放行（小服务会兜底拦）', async () => {
  expect(await keyReadyOrAsk(async () => health({ keyReady: true }))).toBe(true);
  await expect(requireKey(async () => health({ keyReady: true }))).resolves.toBeUndefined();
  await expect(requireKey(async () => health({ keyReady: false }))).rejects.toThrow(KEY_NEEDED_TEXT);
  expect(keyNeededOpen()).toBe(true); closeKeyNeeded();
  await expect(requireKey(async () => { throw Error('连不上'); })).resolves.toBeUndefined();
  expect(keyNeededOpen()).toBe(false);
});

it('小服务回「还没填火山 Key…」的报错也弹同一个框，别的报错不弹', () => {
  expect(askIfKeyError(Error('火山没接（401）：别的原话'))).toBe(false);
  expect(askIfKeyError('还没填火山 Key')).toBe(false);
  expect(keyNeededOpen()).toBe(false);
  expect(askIfKeyError(Error('还没填火山 Key（ARK_API_KEY）：点右上角「设置」填好再试，不用重启。这单没发出去。'))).toBe(true);
  expect(keyNeededOpen()).toBe(true);
});

it('「去填 Key」能叫右上角设置打开；退订后不再收到', () => {
  const opened = vi.fn();
  const off = subscribeOpenSettings(opened);
  openSettings(); expect(opened).toHaveBeenCalledTimes(1);
  off(); openSettings(); expect(opened).toHaveBeenCalledTimes(1);
});
