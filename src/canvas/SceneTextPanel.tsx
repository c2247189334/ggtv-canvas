import { useRef } from "react";
import { useEdges, useNodes, type Edge } from "@xyflow/react";
import { useBoard } from "./boardContext";
import { usePanelFit } from "./usePanelFit";
import { isRewriteBackground, MAX_SCENE_TEXT, rewriteVideoOf, SCENE_TEXT_PLACEHOLDER } from "@/domain/rewriteTextScene";
import type { CardNode, ImageCardData, SceneRead } from "@/types";

/**
 * 11-13 改写背景卡的「不出图，用文字」/「改回用图」按钮（面板工具行，挨着「上传这项图片」）。
 * 切到用文字：剪掉这张卡到视频卡的线；改回用图：重新连回去（编号排到最后），卡上的字留着。
 */
export function SceneTextToggle({ id, data }: { id: string; data: ImageCardData }) {
  const board = useBoard();
  const nodes = useNodes<CardNode>();
  const edges = useEdges<Edge>();
  if (!isRewriteBackground(data)) return null;
  const video = rewriteVideoOf(nodes, data);
  if (!video) return null;
  const on = data.rewriteTextOn === true;
  const linked = edges.some(edge => edge.source === id && edge.target === video.id);
  const toggle = () => {
    if (on) {
      board.updateCard(id, { rewriteTextOn: false });
      if (!linked) board.connect?.(id, video.id);
      return;
    }
    if (linked) board.disconnect(id, video.id);
    board.updateCard(id, { rewriteTextOn: true, rewriteSceneText: data.rewriteSceneText ?? "" });
  };
  return <button type="button" disabled={data.jobs.length > 0} onClick={toggle}
    title={on ? "重新连回视频卡，这一段用这张卡的图" : "这一段不出背景图：在卡上写一句话，生成提示词时交给 AI 结合原片写"}>
    {on ? "改回用图" : "不出图，用文字"}
  </button>;
}

/** 用文字的背景卡选中时，卡下面的面板只剩切换按钮和写字的框，不能发送出图。 */
export function SceneTextPanel({ id, data }: { id: string; data: ImageCardData }) {
  const board = useBoard();
  const panel = useRef<HTMLDivElement>(null);
  usePanelFit(panel);
  const text = data.rewriteSceneText ?? "";
  return (
    <div ref={panel} className="panel nodrag nowheel nopan" data-focus-ready="true">
      <div className="panel__tools"><SceneTextToggle id={id} data={data} /></div>
      <textarea className="panel__prompt" data-prompt-field="true" rows={4} maxLength={MAX_SCENE_TEXT} value={text} placeholder={SCENE_TEXT_PLACEHOLDER}
        onChange={event => board.updateCard(id, { rewriteSceneText: event.target.value.slice(0, MAX_SCENE_TEXT) })} />
      <div className="panel__scene-note">
        <span>这张卡不出图。点视频卡的「生成提示词」时，这句话会和原片这一段的截图一起交给 AI 写进提示词。</span>
        <span className="panel__scene-count">{text.length}/{MAX_SCENE_TEXT}</span>
      </div>
    </div>
  );
}

/** 视频卡面板：生成提示词后直接露出 AI 对每张背景卡的字是怎么理解的（不收进「N 条提醒」）。 */
export function SceneReads({ reads }: { reads?: SceneRead[] }) {
  if (!reads?.length) return null;
  return (
    <div className="panel__reads">
      <div className="panel__reads-title">背景卡的字我是这么理解的</div>
      {reads.map((row, index) => <div className="panel__reads-row" key={index}>{row.title}：你写「{row.text}」→ {row.read}</div>)}
    </div>
  );
}
