import { useState } from 'react';
import { useBoard } from './boardContext';
import { addLine, editLine, lineSpeakers, MAX_LINE_TEXT, removeLine, talkingLines } from '@/domain/rewriteLines';
import type { VideoCardData } from '@/types';

/**
 * 11-19「露脸 · AI 自己配音」做的卡：提示词面板里「生成提示词」上面的台词表（能收起，超过 4 行在表里滚动）。
 * 拆解读出来的字可能读错，所以每句都能改；改了不自动改提示词，要再点一次「生成提示词」。
 */
export function RewriteLinesTable({ id, data }: { id: string; data: VideoCardData }) {
  const board = useBoard();
  const [open, setOpen] = useState(true);
  const plan = data.rewritePlan;
  if (!data.rewriteTalking || !plan) return null;
  const lines = talkingLines(data), duration = data.rewriteSource?.seconds ?? data.video.duration;
  const save = (next: typeof plan) => board.updateCard(id, { rewritePlan: next });
  const speakers = lineSpeakers(plan);
  return <div className="rewrite-lines">
    <div className="rewrite-lines__head">
      <button type="button" className="rewrite-lines__toggle" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? '▾' : '▸'} 台词（{lines.length} 句）</button>
      {open ? <button type="button" onClick={() => save(addLine(plan, duration))}>加一句</button> : null}
    </div>
    {open ? <>
      <div className="rewrite-lines__rows">
        {lines.map(line => <div className="rewrite-lines__row" key={line.id}>
          {/* 秒数写完（离开输入框）才存：边打边存会被夹成「结束比开始晚 0.1 秒」。 */}
          <input type="number" key={`from:${line.id}:${line.from}`} aria-label="从第几秒" min={0} max={duration} step={0.1} defaultValue={line.from}
            onBlur={event => { if (Number(event.target.value) !== line.from) save(editLine(plan, line.id, { from: Number(event.target.value) }, duration)); }} />
          <span>-</span>
          <input type="number" key={`to:${line.id}:${line.to}`} aria-label="到第几秒" min={0} max={duration} step={0.1} defaultValue={line.to}
            onBlur={event => { if (Number(event.target.value) !== line.to) save(editLine(plan, line.id, { to: Number(event.target.value) }, duration)); }} />
          <select aria-label="谁说" value={line.who} onChange={event => save(editLine(plan, line.id, { who: event.target.value }, duration))}>
            {speakers.map(row => <option key={row.id} value={row.id}>{row.label}</option>)}
          </select>
          <input type="text" className="rewrite-lines__text" aria-label="台词" maxLength={MAX_LINE_TEXT} value={line.text}
            placeholder="这句说了什么" onChange={event => save(editLine(plan, line.id, { text: event.target.value }, duration))} />
          <button type="button" aria-label="删掉这句" title="删掉这句" onClick={() => save(removeLine(plan, line.id))}>×</button>
        </div>)}
      </div>
      <label className="rewrite-lines__voice">声音
        <input type="text" maxLength={200} value={data.rewriteVoice ?? ''} placeholder="例如：清亮自然的年轻男声，语速偏快，语气轻松；空着由 AI 照人物图写"
          onChange={event => board.updateCard(id, { rewriteVoice: event.target.value })} /></label>
      {data.prompt.trim() ? <div className="rewrite-lines__note">台词或声音改了，重新点「生成提示词」才生效</div> : null}
    </> : null}
  </div>;
}
