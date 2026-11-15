/** 刚交上单多久内再点不算：盖住双击（系统默认 0.5 秒内算双击）和手抖。 */
export const SEND_COOLDOWN_MS = 1000;

/**
 * 同一张卡的发送锁：上一单还在交、或刚交上 1 秒内，再点不算（真模式下多交一单就多花一份钱）。
 * 没交上（出错）不用等，马上能重试。锁按卡记、不跟面板走：面板关了重开也挡得住。
 */
export function createSendGuard(now: () => number = () => Date.now(), cooldown = SEND_COOLDOWN_MS) {
  const busy = new Set<string>(), sentAt = new Map<string, number>();
  return {
    begin(cardId: string) {
      const last = sentAt.get(cardId);
      if (busy.has(cardId) || (last !== undefined && now() - last < cooldown)) return false;
      busy.add(cardId);
      return true;
    },
    end(cardId: string, sent: boolean) {
      busy.delete(cardId);
      if (sent) sentAt.set(cardId, now());
    }
  };
}

export const sendGuard = createSendGuard();

/** 按住 Ctrl+Enter 不放时键盘自动重复的那些按键不算发送。 */
export const sendRepeatBlocked = (event: { repeat?: boolean }) => event.repeat === true;
