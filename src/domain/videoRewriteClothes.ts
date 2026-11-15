import type { FrameRegion } from '@/types';
import type { RewriteItem, RewritePlan } from '@/videoRewriteTypes';

/**
 * 11-06 用户：只写换人时，衣服要和原片一样。没写要换的衣服从原片截图、AI 抽成不带脸的衣服图，自动连进视频卡。
 * 11-06 真试（凤冠霞帔、红官服）：这段话抽出来细节保得住、图里没有脸；Seedance 不收带真人脸的参考图，所以截图不能直接用。
 */
const CLOTHES_BODY = '穿戴的全套服饰，衣服的款式、颜色、花纹、刺绣、珠饰、腰带、头冠或帽子都和原图完全一致，不要改动、不要简化。'
  + '把衣服穿在无头人台上，正面全身展示，头冠或帽子单独摆在人台脖子上方的空中。'
  + '去掉人、脸、手和手里的东西，原图没拍到的下半身按同样的款式自然补全。纯白色背景，不出现人脸。';
/** 无头人台是竖的，横屏视频也按竖版出图。 */
export const REWRITE_CLOTHES_ASPECT = '9:16';

/** 没写要换、要从原片抽的衣服：隔一段穿回的同一套只抽第一件，按时间排。 */
export function keptClothes(plan: RewritePlan): RewriteItem[] {
  return plan.items.filter(item => item.kind === '衣服' && !plan.replace.includes(item.id) && !item.sameAs).sort((a, b) => a.from - b.from);
}
const ownerOf = (item: RewriteItem, plan: RewritePlan) => item.kind === '人物' ? item : plan.items.find(entry => entry.kind === '人物' && entry.id === item.person);

/** 分屏时只截这个人那半边（人看自己、衣服看主人，11-11 起人物对照截图也用）；拆解的 where 是一句话，认「上半、下半、左半、右半」。 */
export function clothesFrameRegion(item: RewriteItem, plan: RewritePlan): FrameRegion | undefined {
  const where = ownerOf(item, plan)?.where ?? '';
  return where.includes('上半') ? 'top' : where.includes('下半') ? 'bottom' : where.includes('左半') ? 'left' : where.includes('右半') ? 'right' : undefined;
}

/** 同框不止一个人又没法裁时，点名是谁、哪一件，免得抽错人。 */
export function rewriteClothesPrompt(item: RewriteItem, plan: RewritePlan): string {
  const crowded = plan.items.filter(entry => entry.kind === '人物').length > 1 && !clothesFrameRegion(item, plan);
  const owner = ownerOf(item, plan);
  const name = owner?.where ?? owner?.desc.split(/[，,]/)[0].trim();
  return `提取图中${crowded && name ? `${name}（${item.desc}）` : '人物'}${CLOTHES_BODY}`;
}
