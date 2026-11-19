import type { AssetRef } from './types';

export type CharacterVideo = { status: 'asset' | 'trusted' | 'expired' | 'edited' | 'photo'; days?: number };
export type CharacterImage = { ref: Pick<AssetRef, 'type' | 'id'>; label: string; assetId?: string; video: CharacterVideo };
export type CharacterView = {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  images: CharacterImage[];
  status: 'ready' | 'generating' | 'failed';
  jobId?: string;
  error?: string | null;
  /** 11-19 第二期：声音样本（作品里的一段声音 + 一句嗓音描述），seconds 是小服务读出来的时长。 */
  voice?: CharacterVoice;
};
export type CharacterVoice = { ref: { type: 'work'; id: string }; desc: string; seconds: number };
export type CharacterSaveImage = Pick<AssetRef, 'type' | 'id'> & { assetId?: string };
export type CharacterSaveInput = { name: string; description: string; images: CharacterSaveImage[]; authorized: boolean };
export type CharacterPatch = { id: string; name?: string; description?: string; voice?: { workId: string; desc: string } | null };
export type CharacterGenerateInput = { description: string; id?: string };
