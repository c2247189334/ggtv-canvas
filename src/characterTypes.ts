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
};
export type CharacterSaveImage = Pick<AssetRef, 'type' | 'id'> & { assetId?: string };
export type CharacterSaveInput = { name: string; description: string; images: CharacterSaveImage[]; authorized: boolean };
export type CharacterPatch = { id: string; name?: string; description?: string };
export type CharacterGenerateInput = { description: string; id?: string };
