import { useState } from "react";
import { api, type KeyCheck, type KeyName } from "@/api";
import type { Health } from "@/types";

/** 11-17 用户定：普通人在设置里直接填 Key，不用自己开记事本改 .env.local。填过的只显示「已填」，绝不回显值。 */
const FIELDS: readonly { name: KeyName; label: string; secret: boolean; ready: (h: Health) => boolean }[] = [
  { name: "ARK_API_KEY", label: "火山方舟 API Key（出图、出视频要用）", secret: true, ready: h => h.keyReady },
  { name: "TOS_ACCESS_KEY_ID", label: "TOS Access Key ID（带参考视频出片要用）", secret: true, ready: h => h.tosReady },
  { name: "TOS_SECRET_ACCESS_KEY", label: "TOS Secret Access Key", secret: true, ready: h => h.tosReady },
  { name: "TOS_BUCKET", label: "TOS 桶名（北京区）", secret: false, ready: h => h.tosReady }
];

/** 保存后的一句话。验出 Key 不对（火山回 401）时标红：值已经存了，但要重新填。 */
export function savedMessage(result: { saved: readonly string[]; tosReady: boolean; keyCheck?: KeyCheck }): { ok: boolean; text: string } {
  if (result.keyCheck === "rejected") return { ok: false, text: "已保存，但火山说这个 Key 不对（401）：可能复制漏了或多了字符，或者这个 Key 已经删掉了。检查一下重新填。" };
  const checked = result.keyCheck === "accepted" ? "火山认这个 Key。" : result.keyCheck === "unknown" ? "这次没连上火山，没法验 Key 对不对，出图时就知道。" : "";
  return { ok: true, text: `已保存 ${result.saved.length} 项，不用重启。${checked}${!result.tosReady ? "TOS 三项还没填齐，只有带参考视频出片才要。" : ""}` };
}

const link = (href: string, text: string) => <a href={href} target="_blank" rel="noreferrer">{text}</a>;

/** 怎么拿 Key：网址照火山官方文档（2026-11 核过本地副本）；没填 Key 时默认展开。 */
export function KeyGuide({ open }: { open: boolean }) {
  return <details className="keys__guide" open={open}>
    <summary>怎么拿 Key（第一次用看这里）</summary>
    <ol>
      <li>{link("https://console.volcengine.com/", "注册并登录火山引擎")}（要实名）。</li>
      <li>打开 {link("https://ark.volcengine.com/region:cn-beijing/apikey", "API Key 管理")}，点「创建 API Key」，复制下来。</li>
      <li>到 {link("https://ark.volcengine.com/region:cn-beijing/openManagement?LLM=%7B%7D&advancedActiveKey=model&projectName=default&tab=ComputerVision", "开通管理")} 开通要用的模型：出图是 Seedream，出视频是 Seedance。官方写开通 Seedance 前账户余额要 200 元以上或买了资源包，以官网为准。</li>
      <li>回到这里，粘贴进第一个框，点保存。</li>
    </ol>
    <p className="settings__hint">TOS 三项只有「拿视频当参考出片」才要：在火山控制台开通对象存储 TOS，建一个北京区的桶，再新建一组访问密钥（Access Key ID 和 Secret Access Key），填进下面三个框。</p>
  </details>;
}

const EMPTY: Record<KeyName, string> = { ARK_API_KEY: "", TOS_ACCESS_KEY_ID: "", TOS_SECRET_ACCESS_KEY: "", TOS_BUCKET: "" };

export function KeyForm({ health, onSaved }: { health: Health; onSaved: (check?: KeyCheck) => void }) {
  const [values, setValues] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const filled = Object.values(values).some(value => value.trim());

  const save = async () => {
    setSaving(true); setMessage(null);
    try {
      const result = await api.saveKeys(Object.fromEntries(Object.entries(values).filter(([, value]) => value.trim())));
      setValues(EMPTY);
      setMessage(savedMessage(result));
      onSaved(result.keyCheck);
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    } finally { setSaving(false); }
  };

  return <form className="keys" onSubmit={event => { event.preventDefault(); if (filled && !saving) void save(); }}>
    <p className="settings__hint">在这里填好点保存，会写进项目文件夹的 .env.local，只存在你自己电脑上。填过的不会显示出来，要换就重新填。</p>
    <KeyGuide open={!health.keyReady} />
    {FIELDS.map(field => <label key={field.name} className="keys__field">
      <span>{field.label}</span>
      <input type={field.secret ? "password" : "text"} autoComplete="off" spellCheck={false} value={values[field.name]}
        placeholder={field.ready(health) ? "已填（不显示）" : "没填"}
        onChange={event => setValues(old => ({ ...old, [field.name]: event.target.value }))} />
    </label>)}
    <button type="submit" disabled={!filled || saving}>{saving ? "保存并检查中…" : "保存"}</button>
    {message ? <p className={message.ok ? "settings__hint" : "settings__error"} role="status">{message.text}</p> : null}
  </form>;
}
