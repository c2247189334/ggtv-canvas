import { featureChecklist, type FeatureRow } from "@/domain/featureChecklist";
import { mustFillKey, showAgent } from "@/domain/settingsPanel";
import type { Health } from "@/types";

function Pill({ row, optional = false }: { row: FeatureRow; optional?: boolean }) {
  return <li className={`features__pill${row.ok ? " is-ok" : ""}${optional ? " is-optional" : ""}`} title={row.state}>
    <span className="features__mark" aria-hidden="true">{row.ok ? "✓" : "!"}</span>{row.name}{optional && !row.ok ? "（没装）" : ""}
  </li>;
}

const Fixes = ({ rows }: { rows: FeatureRow[] }) => <ul className="features__fixes">
  {rows.map(row => <li key={row.name}><b>{row.name}</b>：{row.state}。{row.fix}</li>)}
</ul>;

/**
 * 功能清单（11-19 用户定：一眼看清哪些能用）：每个功能一个小标签打勾；不能用的才在下面写缺什么、怎么办。
 * 深度、白模是选装，单独一排，怎么装默认折叠（11-17 用户定）。
 */
export function HealthDetails({ health, keyRejected = false }: { health: Health; keyRejected?: boolean }) {
  const { main, optional } = featureChecklist(health, keyRejected);
  // 下面「火山 Key」那块摊开了填写框、「本机 AI 助手」那块露着（会写怎么登录）时，只缺那些的行就不再重复写一大段。
  const shownBelow = { keys: mustFillKey(health, keyRejected), agent: showAgent(health) };
  const broken = main.filter(row => !row.ok && !(row.handledBy && shownBelow[row.handledBy])), missing = optional.filter(row => !row.ok);
  return <>
    {health.fake ? <p className="settings__hint">假火山模式：出的是纯色假图，免费，数据存在 .fake-data 文件夹。</p> : null}
    <ul className="features">{main.map(row => <Pill key={row.name} row={row} />)}</ul>
    {broken.length ? <Fixes rows={broken} /> : null}
    <ul className="features features--optional">
      <li className="features__label">选装</li>
      {optional.map(row => <Pill key={row.name} row={row} optional />)}
    </ul>
    {missing.length ? <details className="features__optional"><summary>选装的怎么装（不装不影响别的）</summary><Fixes rows={missing} /></details> : null}
  </>;
}
