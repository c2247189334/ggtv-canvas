// 11-19 第二期「人物带声音」（设计 docs/specs/2026-11-19-口播改写-design.md 第 8 节）的纯逻辑：
// 声音卡存成人物的声音、人物拖进说话版时铺声音卡并连到视频卡、交提示词时用途写「音色」（和 server/videoRewrite/talkingPrompt.mjs 的 VOICE_PURPOSE 同一个字）。
import type { Edge } from '@xyflow/react';
import type { AssetRef, CardNode } from '@/types';
import type { CharacterView } from '@/characterTypes';
import { currentResult, newAudioCard } from './cards';
import { linkId } from './refs';
import { rewriteNodeHeight, rewriteSpot } from './videoRewriteLayout';

export const VOICE_PURPOSE = '音色';
/** 和小服务 server/characterInput.mjs 同样的上下限。 */
export const VOICE_MIN_SECONDS = 2, VOICE_MAX_SECONDS = 15, VOICE_DESC_MAX = 200;
const AUDIO_CARD_HEIGHT = 120;

export const voicePurpose = (name: string) => `${VOICE_PURPOSE}，${name}说话的声音样本`;

/** 右键「存为人物的声音」：只认有声音作品的声音卡；返回那段作品，不行时返回原因。 */
export function voiceSaveSource(node: CardNode | undefined): { ref: AssetRef } | { problem: string } {
  if (node?.data.kind !== 'audio') return { problem: '选一张声音卡才能存为人物的声音。' };
  const ref = currentResult(node.data);
  if (!ref || ref.type !== 'work') return { problem: '这张声音卡还没有声音。' };
  const seconds = ref.seconds;
  if (typeof seconds === 'number' && (seconds < VOICE_MIN_SECONDS || seconds > VOICE_MAX_SECONDS)) {
    return { problem: `声音样本要在 ${VOICE_MIN_SECONDS} 到 ${VOICE_MAX_SECONDS} 秒之间（这段 ${seconds.toFixed(1)} 秒）：先用「片段截取」截 5～10 秒他说话的片段，再「提取原声」。` };
  }
  return { ref };
}

export function voiceDescProblem(desc: string): string | null {
  const text = desc.trim();
  if (!text) return '写一句嗓音描述，比如：清亮自然的年轻男声，语速偏快，语气轻松。';
  if ([...text].length > VOICE_DESC_MAX) return `嗓音描述最多 ${VOICE_DESC_MAX} 字。`;
  return /[{}]/.test(text) ? '嗓音描述里不能有 { }（那是写台词用的）。' : null;
}

export type VoiceDropPlan = {
  videoId: string;
  /** 已经连着的声音样本卡就换声音，没有就新建一张连过去。 */
  replaceId?: string; node?: CardNode; edge?: Pick<Edge, 'id' | 'source' | 'target'>;
  result: AssetRef; name: string;
  /** 视频卡「声音」栏空着才填人物那句；已经写了别的字就不动，提醒用户。 */
  voiceText?: string; keptVoice?: boolean;
};

/** 人物拖到改写的人物卡上：这张卡连着说话版视频卡、人物又有声音时，铺一张声音样本卡连到那张视频卡。别的情况返回 null，照旧只填图。 */
export function voiceDropPlan(nodes: readonly CardNode[], edges: readonly Pick<Edge, 'source' | 'target'>[], personId: string,
  character: Pick<CharacterView, 'name' | 'voice'>, newId = () => `card-${crypto.randomUUID().slice(0, 8)}`): VoiceDropPlan | null {
  const person = nodes.find(node => node.id === personId);
  const voice = character.voice;
  if (!voice || person?.data.kind !== 'image' || person.data.rewriteItem?.kind !== '人物') return null;
  const video = edges.filter(edge => edge.source === personId).map(edge => nodes.find(node => node.id === edge.target))
    .find(node => node?.data.kind === 'video' && node.data.rewriteTalking);
  if (!video || video.data.kind !== 'video') return null;
  const result: AssetRef = { type: 'work', id: voice.ref.id, media: 'audio', seconds: voice.seconds };
  const typed = video.data.rewriteVoice?.trim() ?? '';
  const words = typed ? (typed === voice.desc ? {} : { keptVoice: true }) : { voiceText: voice.desc };
  const existing = edges.filter(edge => edge.target === video.id).map(edge => nodes.find(node => node.id === edge.source))
    .find(node => node?.data.kind === 'audio' && node.data.voiceOf);
  if (existing) return { videoId: video.id, replaceId: existing.id, result, name: character.name, ...words };
  const id = newId();
  const at = rewriteSpot({ x: video.position.x, y: video.position.y + rewriteNodeHeight(video) + 40 }, nodes, AUDIO_CARD_HEIGHT);
  const node: CardNode = { id, type: 'card', position: at,
    data: { ...newAudioCard('work', 0, [result]), title: `${character.name} · 声音`, voiceOf: character.name } };
  return { videoId: video.id, node, edge: { id: linkId(id, video.id), source: id, target: video.id }, result, name: character.name, ...words };
}
