import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, type KeyCheck, type KeyName } from "@/api";
import { HelpTip } from "@/common/HelpTip";
import { keyStatus, mustFillKey } from "@/domain/settingsPanel";
import type { Health } from "@/types";

/** 11-17 用户定：普通人在设置里直接填 Key，不用自己开记事本改 .env.local。填过的只显示「已填」，绝不回显值。 */
const FIELDS: readonly { name: KeyName; label: string; secret: boolean; wide?: boolean; ready: (h: Health) => boolean }[] = [
  { name: "ARK_API_KEY", label: "火山方舟 API Key（出图、出视频要用）", secret: true, wide: true, ready: h => h.keyReady },
  { name: "TOS_ACCESS_KEY_ID", label: "Access Key ID", secret: true, ready: h => h.tosReady },
  { name: "TOS_SECRET_ACCESS_KEY", label: "Secret Access Key", secret: true, ready: h => h.tosReady },
  { name: "TOS_BUCKET", label: "桶名（北京区）", secret: false, ready: h => h.tosReady }
];

export type SaveResult = Awaited<ReturnType<typeof api.saveKeys>>;

/** 保存后的一句话。验出 Key 不对（火山回 401）时标红：值已经存了，但要重新填。 */
export function savedMessage(result: { saved: readonly string[]; tosReady: boolean; keyCheck?: KeyCheck }): { ok: boolean; text: string } {
  if (result.keyCheck === "rejected") return { ok: false, text: "已保存，但火山说这个 Key 不对（401）：可能复制漏了或多了字符，或者这个 Key 已经删掉了。检查一下重新填。" };
  const checked = result.keyCheck === "accepted" ? "火山认这个 Key。" : result.keyCheck === "unknown" ? "这次没连上火山，没法验 Key 对不对，出图时就知道。" : "";
  return { ok: true, text: `已保存 ${result.saved.length} 项，不用重启。${checked}${!result.tosReady ? "TOS 三项还没填齐，只有带参考视频出片才要。" : ""}` };
}

const link = (href: string, text: string) => <a href={href} target="_blank" rel="noreferrer">{text}</a>;
const line = (key: string, children: ReactNode) => <span key={key} className="help-tip__line">{children}</span>;
const tosConsole = link("https://console.volcengine.com/tos", "对象存储 TOS 控制台");
const tosKeyHelp = [
  line("1", <>1. 先在 {tosConsole} 点「立即开通」（第一次要勾选同意条款）。</>),
  line("2", <>2. 打开 {link("https://console.volcengine.com/iam/keymanage/", "API 访问密钥")}，新建一组 Access Key（不是 API Key），两串分别填 Access Key ID 和 Secret Access Key。</>)
];

/**
 * 每栏旁边「?」里的话（11-19 用户嫌铺开太长，改成移上去才浮出）。方舟网址照官方规则本地副本；
 * TOS 网址、按钮名、计费照官方 TOS、访问控制文档（2026-11-19 上网核过）；「只收视频网址」照官方视频生成教程。
 */
export const FIELD_HELP: Record<KeyName, ReactNode[]> = {
  ARK_API_KEY: [
    line("1", <>1. {link("https://console.volcengine.com/", "注册并登录火山引擎")}（要实名）。</>),
    line("2", <>2. 打开 {link("https://ark.volcengine.com/region:cn-beijing/apikey", "API Key 管理")}，点「创建 API Key」，复制下来粘到这里。</>),
    line("3", <>3. 到 {link("https://ark.volcengine.com/region:cn-beijing/openManagement?LLM=%7B%7D&advancedActiveKey=model&projectName=default&tab=ComputerVision", "开通管理")} 开通模型：出图 Seedream，出视频 Seedance。官方写开通 Seedance 前余额要 200 元以上或买了资源包，以官网为准。</>)
  ],
  TOS_ACCESS_KEY_ID: tosKeyHelp,
  TOS_SECRET_ACCESS_KEY: tosKeyHelp,
  TOS_BUCKET: [line("1", <>在 {tosConsole} 左边点「桶列表」→「创建桶」，区域选「华北2（北京）」，别的照默认；起的名字填这里。</>)]
};

const TOS_HELP = [
  line("why", "为什么要填：拿视频当参考出片时，火山只收视频网址，不收你电脑里的文件。所以先把视频传到你自己的 TOS（火山的网盘），再给火山一个 24 小时有效的临时链接。只出图、用文字或图片出视频用不到。"),
  line("cost", "花不花钱：火山按用量收，量很小（官方示例：存 1GiB 一个月约 0.1 元），以官网为准。视频留在你自己的桶里，不想留去 TOS 控制台删。")
];

const EMPTY: Record<KeyName, string> = { ARK_API_KEY: "", TOS_ACCESS_KEY_ID: "", TOS_SECRET_ACCESS_KEY: "", TOS_BUCKET: "" };

/** 填写框：只把填了字的那几项发出去，空着的不动。保存成了交给 onSaved，没成在框下面说原话。 */
export function KeyForm({ health, onSaved }: { health: Health; onSaved: (result: SaveResult) => void }) {
  const [values, setValues] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const filled = Object.values(values).some(value => value.trim());

  const save = async () => {
    setSaving(true); setError(null);
    try {
      const result = await api.saveKeys(Object.fromEntries(Object.entries(values).filter(([, value]) => value.trim())));
      setValues(EMPTY);
      onSaved(result);
    } catch (err) {
      setError((err as Error).message);
    } finally { setSaving(false); }
  };

  // 问号是按钮，不能包在 <label> 里（点字会点到问号），所以字用 htmlFor 指向输入框。
  const input = (field: typeof FIELDS[number]) => <div key={field.name} className={field.wide ? "keys__field is-wide" : "keys__field"}>
    <span className="keys__name"><label htmlFor={`key-${field.name}`}>{field.label}</label><HelpTip name={`${field.label}怎么拿`}>{FIELD_HELP[field.name]}</HelpTip></span>
    <input id={`key-${field.name}`} type={field.secret ? "password" : "text"} autoComplete="off" spellCheck={false} value={values[field.name]}
      placeholder={field.ready(health) ? "已填（不显示）" : "没填"}
      onChange={event => setValues(old => ({ ...old, [field.name]: event.target.value }))} />
  </div>;

  // 两列排：方舟 Key 占一整行，TOS 三项和「保存」两两一行，省得一长条拉到底（11-19 用户嫌留白多）。
  return <form className="keys" onSubmit={event => { event.preventDefault(); if (filled && !saving) void save(); }}>
    <p className="settings__hint">存在本机 .env.local，不上传；只填要换的那项。费用是火山从你自己的账号直接扣，本工具免费，不加价、不抽成。</p>
    {!health.keyReady ? <p className="settings__hint">不知道怎么拿：鼠标移到每栏旁边的「?」上，有步骤和网址。</p> : null}
    <div className="keys__grid">
      {input(FIELDS[0])}
      <span className="keys__group keys__name is-wide">TOS（只有拿视频当参考出片才要，可以先不填）<HelpTip name="TOS 是干嘛的">{TOS_HELP}</HelpTip></span>
      {FIELDS.slice(1).map(input)}
      <button type="submit" disabled={!filled || saving}>{saving ? "保存并检查中…" : "保存"}</button>
    </div>
    {error ? <p className="settings__error" role="status">{error}</p> : null}
  </form>;
}

type SectionProps = {
  health: Health; keyRejected: boolean; editing: boolean; focus: number;
  onEditing: (editing: boolean) => void; onSaved: (check?: KeyCheck) => void;
};

/**
 * 设置面板里「火山 Key」那块（11-19 用户定）：填好了只显示一行打勾 +「重新填」；没填、或火山说不对才直接摊开填写框。
 * 保存成了、火山没说不对，就自己收回打勾那行。focus 变了（黄牌子、「去填 Key」叫的）就滚到这块。
 */
export function KeySection({ health, keyRejected, editing, focus, onEditing, onSaved }: SectionProps) {
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { if (focus) ref.current?.scrollIntoView({ block: "nearest" }); }, [focus]);
  const must = mustFillKey(health, keyRejected);
  const open = must || editing;

  const saved = (result: SaveResult) => {
    const said = savedMessage(result);
    setMessage(said);
    onSaved(result.keyCheck);
    if (said.ok && result.keyReady) onEditing(false);
  };
  const edit = () => { setMessage(null); onEditing(true); };

  return <section className="setp__sec" ref={ref}>
    <header className="setp__head">
      <h3>火山 Key</h3>
      {open && !must ? <button type="button" className="setp__link" onClick={() => onEditing(false)}>收起</button> : null}
      {!open ? <button type="button" className="setp__link" onClick={edit}>重新填</button> : null}
    </header>
    {open ? <KeyForm health={health} onSaved={saved} /> : <ul className="features">
      {keyStatus(health, keyRejected).map(item => <li key={item.name} className={`features__pill${item.ok ? " is-ok" : ""}`}>
        <span className="features__mark" aria-hidden="true">{item.ok ? "✓" : "!"}</span>{item.name} {item.note}
      </li>)}
    </ul>}
    {message ? <p className={message.ok ? "settings__hint" : "settings__error"} role="status">{message.text}</p> : null}
    {!health.fake && !health.keyReady ? <p className="settings__hint">没填 Key 也能先用画布、上传、剪辑；出图、出视频那一步才要。</p> : null}
  </section>;
}
