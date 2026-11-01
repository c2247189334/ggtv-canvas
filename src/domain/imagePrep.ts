/**
 * 上传前的图片处理（从旧项目搬来）。手机原图动不动 8~12MB，先缩到够用的尺寸再传；
 * 缩太狠会丢细节，所以留得比较宽：最长边 1600、JPG 质量 0.92；本来就小（≤ 900KB 且没超边）原样传。
 */
export const MAX_UPLOAD_EDGE = 1600;
export const JPEG_QUALITY = 0.92;
export const SKIP_RESIZE_BYTES = 900 * 1024;

export type ImageSize = { width: number; height: number };

/** 读一张图的原始宽高（发送前算「跟图N」的尺寸用）。 */
export function loadImageSize(url: string): Promise<ImageSize> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("参考图读不出来（可能被删了），断开它再发。"));
    image.src = url;
  });
}

export async function readImageSize(file: File): Promise<ImageSize> {
  const url = URL.createObjectURL(file);
  try {
    return await loadImageSize(url);
  } catch {
    throw new Error("图片读不出来，请换一张 PNG、JPG 或 WebP。");
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 算出缩放后的尺寸；本来就够小就原样返回。 */
export function fitWithin(size: ImageSize, maxEdge = MAX_UPLOAD_EDGE): ImageSize {
  const longest = Math.max(size.width, size.height);
  if (longest <= maxEdge) return { ...size };
  const scale = maxEdge / longest;
  return { width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) };
}

function replaceExtension(name: string, extension: string) {
  const lastDot = name.lastIndexOf(".");
  return `${lastDot > 0 ? name.slice(0, lastDot) : name}.${extension}`;
}

/** 需要缩的才缩；返回可以直接上传的 File。 */
export async function prepareUpload(file: File, maxEdge = MAX_UPLOAD_EDGE): Promise<File> {
  const size = await readImageSize(file);
  const target = fitWithin(size, maxEdge);
  const alreadySmall = target.width === size.width && target.height === size.height;
  if (alreadySmall && file.size <= SKIP_RESIZE_BYTES) return file;

  const canvas = document.createElement("canvas");
  canvas.width = target.width;
  canvas.height = target.height;
  const context = canvas.getContext("2d");
  if (!context) return file;

  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("图片解码失败。"));
      element.src = url;
    });
    context.drawImage(image, 0, 0, target.width, target.height);
  } finally {
    URL.revokeObjectURL(url);
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
  if (!blob) return file;
  return new File([blob], replaceExtension(file.name || "image", "jpg"), { type: "image/jpeg" });
}
