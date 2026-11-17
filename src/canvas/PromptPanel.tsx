import { useEffect, useRef, useState } from "react";
import { useEdges, useNodes, type Edge } from "@xyflow/react";
import { useBoard } from "@/canvas/boardContext";
import { GenOptions } from "@/canvas/GenOptions";
import { VideoOptions } from "./VideoOptions";
import { api } from "@/api";
import { FloatingPanel } from "./FloatingPanel";
import { MentionMenu } from "./MentionMenu";
import { usePromptRewrite } from "./usePromptRewrite";
import { assetUrl, cardTitle } from "@/domain/cards";
import { appendToken, refToken } from "@/domain/prompt";
import { refSources } from "@/domain/refs";
import { insertMention, mentionTrigger, numberMediaRefs, type RefMedia } from "@/domain/mention";
import { durationLabel, videoProblems } from "@/domain/videoPanel";
import { shortcutAction } from "@/domain/shortcuts";
import { sendGuard, sendRepeatBlocked } from "@/domain/sendGuard";
import { toVideoPrompt } from "@/domain/videoPrompt";
import { rewriteVideoHints } from "@/domain/videoRewrite";
import { useRewritePromptCheck } from "./useRewritePromptCheck";
import { RewriteImageUpload } from "./RewriteImageUpload";
import { RewritePromptButtonView, useRewritePrompt } from './RewritePromptButton';
import { rewriteOutputProblem, rewriteWaiting } from '@/domain/rewriteProgress';
import type { AssetRef, CardData, CardNode, Health, ImageCardData, VideoCardData } from "@/types";
import { productReference } from '@/domain/productPrompt';
import { usePanelFit } from './usePanelFit';
import { mergeTagIssues } from '@/domain/panelNotes';
import { HelpTip } from '@/common/HelpTip';
import { sceneTextStaleNotes, usesText } from '@/domain/rewriteTextScene';
import { SceneReads, SceneTextPanel, SceneTextToggle } from './SceneTextPanel';

/**
 * 选中生成卡时，卡片正下方浮出的提示词面板：
 * 一排小按钮（普通卡「帮我改写」；改写视频卡只有「生成提示词」，11-08 起它连看图定稿一起做）→ 连进来的参考图缩略图（左上角编号，点一下把 @图片N 写进提示词，× 断开）
 * → 提示词框 → 出错（同一句只写一次）→ 底行选项和发送；灰字提醒收进小按钮那排末尾的「N 条提醒 ?」，鼠标移上去才看。
 */
export function PromptPanel({ id, data }: { id: string; data: CardData }) {
  if (data.kind === "image" && usesText(data)) return <SceneTextPanel key={id} id={id} data={data} />;
  return data.kind === "audio" ? null : <GenerationPromptPanel key={id} id={id} data={data} />;
}

function GenerationPromptPanel({ id, data }: { id: string; data: ImageCardData | VideoCardData }) {
  const board = useBoard();
  const edges = useEdges<Edge>();
  const nodes = useNodes<CardNode>();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mentionAt, setMentionAt] = useState<number | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  usePanelFit(panel);
  const beforeInput = useRef<{ start: number; end: number } | undefined>(undefined);
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);

  useEffect(() => {
    if (data.kind !== "video") return;
    let alive = true;
    const refresh = async () => {
      try {
        const next = await api.health();
        if (alive) { setHealth(next); setHealthError(null); }
      } catch (err) {
        if (alive) setHealthError((err as Error).message);
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [data.kind]);

  const refs = refSources(edges, id).map((sourceId, index) => {
    const node = nodes.find((n) => n.id === sourceId);
    const ref = node ? productReference(node, data) : null;
    const media: RefMedia = ref?.media === "audio" || node?.data.kind === "audio" ? "audio" :
      ref?.media === "video" || node?.data.kind === "video" ? "video" : "image";
    return { sourceId, number: index + 1, url: ref ? assetUrl(ref) : null, title: node ? cardTitle(node.data) : "", media, seconds: ref?.seconds,
      blocked: data.blocked?.includes(index + 1), asset: ref ?? ({ type: "upload", id: sourceId, ...(media !== "image" ? { media } : {}) } as AssetRef) };
  });
  const mediaNumbers = numberMediaRefs(refs);
  const numberedRefs = data.kind === "video" ? refs.map((ref, index) => ({ ...ref, ...mediaNumbers[index] })) : refs;
  const assets = refs.map(ref => ref.asset);
  const rewrite = usePromptRewrite(id, data, refs, board);
  const hasVideo = refs.some(ref => ref.media === "video");
  const problems = data.kind === "video" ? videoProblems(data.video, assets, health) : [];
  const outputProblem = data.kind === 'video' ? rewriteOutputProblem(data) : null;
  const waiting = data.kind === 'video' && rewriteWaiting(data);
  if (outputProblem) problems.push(outputProblem);
  const lookPrompt = useRewritePrompt(id, data, nodes, edges, board);
  // 写词按钮灰着的原因：和上面拆解状态是同一句就不再写一遍。
  const lookReason = lookPrompt && !lookPrompt.view.loading && lookPrompt.view.reason !== outputProblem ? lookPrompt.view.reason : null;
  const ruleIssues = useRewritePromptCheck(id, data, nodes, edges);
  const hints = data.kind === "video" ? rewriteVideoHints(data, nodes, edges, id) : [];
  // 改写的提示词十几行，面板加宽、写好词后输入框加高（用户 10-30）。
  const rewriteCard = data.kind === "video" && Boolean(data.rewriteId);
  if (data.kind === "video" && data.rewriteId && data.prompt.trim()) {
    try { toVideoPrompt(data.prompt, refs.filter(ref => ref.media === "image").length,
      refs.filter(ref => ref.media === "video").length, refs.filter(ref => ref.media === "audio").length, true); }
    catch (reason) { problems.push((reason as Error).message); }
  }
  if (data.kind === "video" && hasVideo) {
    if (healthError) problems.push(healthError);
    else if (!health) problems.push("正在检查参考视频的存储设置…");
  }
  // 11-13：背景卡的字在生成提示词之后改过 / 切换过，红字提醒再生成一次，不拦发送。
  const issues = mergeTagIssues([...ruleIssues, ...hints, ...(data.kind === "video" ? sceneTextStaleNotes(nodes, data, edges) : [])]);
  const warnings = data.kind === 'video' ? mergeTagIssues(data.rewriteWarnings ?? []) : [];
  // 11-08 用户定：灰字的说明 / 提醒（写词按钮为什么灰、拆解提醒、等待中）收进「N 条提醒 ?」，鼠标移上去才看；红字出错照旧露在面板里。
  const waitingNote = waiting && outputProblem && problems.includes(outputProblem) ? outputProblem : null;
  const tips = [...(lookReason ? [lookReason] : []), ...(waitingNote ? [waitingNote] : []), ...warnings];
  const errors = [error, rewrite.error, lookPrompt?.error, ...problems.filter(problem => problem !== waitingNote), ...issues]
    .filter((text): text is string => Boolean(text));

  const send = async () => {
    if (problems.length || ruleIssues.length || !sendGuard.begin(id)) return;
    setSending(true);
    setError(null);
    let sent = false;
    try {
      await board.send(id);
      sent = true;
    } catch (err) {
      setError((err as Error).message);
    } finally {
      sendGuard.end(id, sent);
      setSending(false);
    }
  };

  const selectMention = (number: number, media: RefMedia = "image") => {
    if (mentionAt === null) return;
    const result = insertMention(data.prompt, mentionAt, number, media);
    setMentionAt(null);
    if (!result) return;
    board.updateCard(id, { prompt: result.text });
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(result.caret, result.caret);
    });
  };

  return (
    <div ref={panel} className={`panel${rewriteCard ? " panel--rewrite" : data.kind === "video" ? " panel--video" : ""} nodrag nowheel nopan`}
      data-focus-ready={data.kind !== 'video' || health !== null || healthError !== null}>
      <div className="panel__tools">
        {data.kind === "image" ? <><RewriteImageUpload id={id} data={data} /><SceneTextToggle id={id} data={data} /></> : null}
        {/* 11-08 用户定：改写视频卡的提示词只走「生成提示词」一步（拼底稿 + 看图定稿），不再放「帮我改写」。 */}
        {!rewriteCard ? <button type="button" disabled={!data.prompt.trim() || rewrite.loading} onClick={() => void rewrite.run()}>
          {rewrite.loading ? "改写中…" : "帮我改写"}
        </button> : null}
        {lookPrompt ? <RewritePromptButtonView {...lookPrompt.view} /> : null}
        {tips.length ? <HelpTip label={`${tips.length} 条提醒`} name="提醒">
          {tips.map((tip, index) => <span className="help-tip__line" key={index}>{tip}</span>)}
        </HelpTip> : null}
      </div>
      {refs.length ? (
        <div className="panel__refs">
          {numberedRefs.map((ref) => {
            const token = ref.media === "audio" ? `@音频${ref.number}` : ref.media === "video" ? `@视频${ref.number}` : refToken(ref.number);
            const insert = () => board.updateCard(id, { prompt: appendToken(data.prompt, token) });
            return <div key={ref.sourceId} className={`panel__ref${ref.blocked ? " is-blocked" : ""}`} title={`${ref.title}：点一下把 ${token} 写进提示词`}>
              {ref.media === "audio" ? <button type="button" className="panel__ref-audio" onClick={insert} aria-label={`引用${token}`}>♪</button> : ref.url ? ref.media === "video" ? (
                <video src={ref.url} preload="metadata" muted playsInline onClick={insert} />
              ) : (
                <img src={ref.url} alt={ref.title} draggable={false}
                  onClick={insert} />
              ) : (
                <div className="panel__ref-empty">{ref.media === "video" ? "还没视频" : "还没图"}</div>
              )}
              <span className="panel__ref-no">{ref.number}</span>
              {ref.media !== "image" ? <span className="panel__ref-duration">{ref.media === "audio" ? "♪" : "▶"} {durationLabel(ref.seconds)}</span> : null}
              {ref.blocked ? <span className="panel__ref-blocked">被拦</span> : null}
              <button type="button" className="panel__ref-x" title={ref.media === "audio" ? "断开这段参考音频" : ref.media === "video" ? "断开这段参考视频" : "断开这张参考图"} onClick={() => board.disconnect(ref.sourceId, id)}>×</button>
            </div>;
          })}
        </div>
      ) : null}
      <textarea
        ref={textarea}
        className={`panel__prompt${rewriteCard && data.prompt.trim() ? " panel__prompt--long" : ""}`}
        data-prompt-field="true"
        rows={4}
        value={data.prompt}
        placeholder={data.kind === "video" ? "描述你想要生成的画面内容，@引用素材" : refs.length ? "描述你想要的画面，用 @图片1 引用参考图" : "描述你想要的画面；要改图就先从别的卡拖线连一张图进来"}
        onBeforeInput={(event) => {
          beforeInput.current = { start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd };
        }}
        onChange={(event) => {
          const text = event.target.value;
          setMentionAt(mentionTrigger(data.prompt, text, event.target.selectionStart, beforeInput.current));
          beforeInput.current = undefined;
          board.updateCard(id, { prompt: text });
        }}
        onKeyDown={(event) => {
          if (shortcutAction({ ...event, isComposing: event.nativeEvent.isComposing }, { editable: true, prompt: true }) === "send") {
            event.preventDefault();
            event.stopPropagation();
            if (!sending && !sendRepeatBlocked(event)) void send();
          }
        }}
      />
      {mentionAt !== null && textarea.current ? (
        <FloatingPanel anchor={textarea.current} onClose={() => setMentionAt(null)}>
          <MentionMenu refs={numberedRefs} grouped={data.kind === "video"} onSelect={selectMention} />
        </FloatingPanel>
      ) : null}
      {data.kind === "video" ? <SceneReads reads={data.rewriteSceneReads} /> : null}
      {/* 11-08 用户定：出错收进一个区，太多就在区里滚动，只差素材编号的同一句合成一句，发送那一行不被挤出屏。 */}
      {errors.length ? <div className="panel__notes">
        {errors.map((text, index) => <div className="panel__error" key={index}>{text}</div>)}
      </div> : null}
      {data.kind === "video" ? <VideoOptions video={data.video} refs={assets} sending={sending} disabled={problems.length > 0 || ruleIssues.length > 0}
        onChange={video => board.updateCard(id, { video })} onSend={() => void send()} /> :
        <GenOptions gen={data.gen} refCount={refs.length} sending={sending} onChange={(gen) => board.updateCard(id, { gen })} onSend={() => void send()} />}
    </div>
  );
}
