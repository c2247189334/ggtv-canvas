import type { AssetRef } from './types';
import type { RewriteMaterial } from './videoRewriteTypes';
import type { FinalSettings, RewriteCharge, RewriteVideoMeta } from './videoRewriteApiTypes';

/** where：这组在哪（11-04 晚起按实物组分）；sameAs：这组和哪个商品同款同色，只在提示词请求里带。 */
export type Product = { id: string; name: string; look: string; pairs: number; pieces: number; layout: string; where?: string; sameAs?: string };
export type ProductPlan = { products: Product[]; visible: string; face: boolean;
  looks: Array<{ id: string; kind: 'scene' | 'outfit'; what: string; now: string; target: string }>;
  timeline: Array<{ from: number; to: number; action: string }>; unsure: string[] };
export type ProductRole = { videoId: string; role: 'product' | 'background'; productId?: string; name?: string; where?: string; sameAs?: string };
export type ProductMaterial = RewriteMaterial & { role?: 'product' | 'background'; productId?: string };
export type ProductAnalyzeResult = RewriteCharge & RewriteVideoMeta & { plan: ProductPlan };
export type ProductPromptRequest = { cardId: string; plan: ProductPlan; userText: string; duration: number; sourceDuration?: number;
  ratio: string; model: string; materials: ProductMaterial[]; settings?: FinalSettings };
export type ProductCheckRequest = { cardId: string; videoPrompt: string; duration: number; materials: ProductMaterial[]; plan?: ProductPlan };
export type ProductState = { videoId: string; batchId: string; sourceId: string; source: AssetRef; userText: string };
