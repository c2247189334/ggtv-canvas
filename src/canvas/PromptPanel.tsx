import { useEffect, useRef, useState } from "react";
import { useEdges, useNodes, type Edge } from "@xyflow/react";
import { useBoard } from "@/canvas/boardContext";
import { GenOptions } from "@/canvas/GenOptions";
import { VideoOptions } from "./VideoOptions";
import { api } from "@/api";
import { FloatingPanel } from "./FloatingPanel";
import { MentionMenu } from "./MentionMenu";
import { usePromptRewrite } from "./usePromptRewrite";
import { assetUrl, cardTitle, currentResult } from "@/domain/cards";
import { appendToken, refToken } from "@/domain/prompt";
import { refSources } from "@/domain/refs";
import { insertMention, mentionTrigger, numberMediaRefs, type RefMedia } from "@/domain/mention";
import { durationLabel, videoProblems } from "@/domain/videoPanel";
import { shortcutAction } from "@/domain/shortcuts";
import { toVideoPrompt } from "@/domain/videoPrompt";
import { rewriteVideoHints } from "@/domain/videoRewrite";
import { useRewritePromptCheck } from "./useRewritePromptCheck";
import { RewriteImageUpload } from "./RewriteImageUpload";
import { RewritePromptButton } from './RewritePromptButton';
import { rewriteOutputProblem } from '@/domain/rewriteProgress';
import type { AssetRef, CardData, CardNode, Health, ImageCardData, VideoCardData } from "@/types";

/**
 * 选中生成卡时，卡片正下方浮出的提示词面板：
 * 一排小按钮（＋参考）→ 连进来的参考图缩略图（左上角编号，点一下把 @图片N 写进提示词，× 断开）
 * → 提示词框 → 底行选项和发送。
 */
export function PromptPanel({ id, data }: { id: string; data: CardData }) {
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
  const beforeInput = useRef<{ start: number; end: number } | undefined>(undefined);
  const sendingLock = useRef(false);
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
    const ref = node ? currentResult(node.data) : null;
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
  if (outputProblem) problems.push(outputProblem);
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

  const send = async () => {
    if (sendingLock.current || problems.length || ruleIssues.length) return;
    sendingLock.current = true;
    setSending(true);
    setError(null);
    try {
      await board.send(id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      sendingLock.current = false;
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
    <div className={`panel${rewriteCard ? " panel--rewrite" : ""} nodrag nowheel nopan`}>
      <div className="panel__tools">
        {data.kind === "image" ? <RewriteImageUpload id={id} data={data} /> : null}
        <button type="button" title="在当前画布中添加参考" onClick={() => board.startRefPick(id)}>＋参考</button>
        <button type="button" title="约 ¥0.02 / 次" disabled={!data.prompt.trim() || rewrite.loading} onClick={() => void rewrite.run()}>
          {rewrite.loading ? "改写中…" : "帮我改写"}
        </button>
      </div>
      {data.kind === 'video' && data.rewriteId ? <RewritePromptButton id={id} data={data} nodes={nodes} edges={edges} board={board} /> : null}
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
        placeholder={data.kind === "video" ? "描述你想要生成的画面内容，@引用素材" : refs.length ? "描述你想要的画面，用 @图片1 引用参考图" : "描述你想要的画面；要改图就先点「＋参考」接一张图"}
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
            if (!sending) void send();
          }
        }}
      />
      {mentionAt !== null && textarea.current ? (
        <FloatingPanel anchor={textarea.current} onClose={() => setMentionAt(null)}>
          <MentionMenu refs={numberedRefs} grouped={data.kind === "video"} onSelect={selectMention} />
        </FloatingPanel>
      ) : null}
      {error ? <div className="panel__error">{error}</div> : null}
      {rewrite.error ? <div className="panel__error">{rewrite.error}</div> : null}
      {data.kind === 'video' ? data.rewriteWarnings?.map((warning, index) => <div className="panel__hint" role="note" key={`warning-${index}`}>{warning}</div>) : null}
      {problems.map(problem => <div className="panel__error" key={problem}>{problem}</div>)}
      {[...ruleIssues, ...hints].map((issue, index) => <div className="panel__error" key={`rewrite-${index}`}>{issue}</div>)}
      {data.kind === "video" ? <VideoOptions video={data.video} refs={assets} sending={sending} disabled={problems.length > 0 || ruleIssues.length > 0}
        onChange={video => board.updateCard(id, { video })} onSend={() => void send()} /> :
        <GenOptions gen={data.gen} refCount={refs.length} sending={sending} onChange={(gen) => board.updateCard(id, { gen })} onSend={() => void send()} />}
    </div>
  );
}
