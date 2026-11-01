export type MotionReference = 'depth' | 'mesh';

/** 跟原话实时取默认；白模体检不通过时仍允许用户手动选。 */
export function defaultMotionReference(text: string, meshReady: boolean): MotionReference {
  return meshReady && /人|脸|发型|头发|衣|穿|服|装/.test(text) ? 'mesh' : 'depth';
}

export function selectedMotionReference(text: string, meshReady: boolean, manual: MotionReference | null): MotionReference {
  return manual ?? defaultMotionReference(text, meshReady);
}
