import { useEffect, useState } from 'react';

function waitVideo(video: HTMLVideoElement, event: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      window.clearTimeout(timer); video.removeEventListener(event, ready); video.removeEventListener('error', failed); signal.removeEventListener('abort', failed);
    };
    const ready = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error('视频缩略图未能读取')); };
    const timer = window.setTimeout(failed, 10000);
    video.addEventListener(event, ready, { once: true }); video.addEventListener('error', failed, { once: true }); signal.addEventListener('abort', failed, { once: true });
    if (signal.aborted) failed();
  });
}

/** 独立解码器只取12张小图，不替代卡内原播放器；失败保留灰底，不影响剪辑。 */
export function useClipThumbnails(url: string, duration: number) {
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController(), video = document.createElement('video'), canvas = document.createElement('canvas');
    video.muted = true; video.preload = 'auto'; video.playsInline = true;
    setThumbnails([]); setFailed(false);
    const run = async () => {
      const ready = waitVideo(video, 'loadeddata', controller.signal);
      video.src = url; await ready;
      canvas.width = 96; canvas.height = 96 * video.videoHeight / video.videoWidth;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('不能读取视频缩略图');
      const images: string[] = [];
      for (let i = 0; i < 12; i++) {
        if (controller.signal.aborted) return;
        const second = i / 11 * Math.max(0, duration - 0.05);
        if (Math.abs(video.currentTime - second) > 0.0001) {
          const seeked = waitVideo(video, 'seeked', controller.signal);
          video.currentTime = second; await seeked;
        }
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        images.push(canvas.toDataURL('image/jpeg', 0.65));
      }
      if (!controller.signal.aborted) setThumbnails(images);
    };
    void run().catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => { controller.abort(); video.pause(); video.removeAttribute('src'); video.load(); };
  }, [url, duration]);
  return { thumbnails, failed };
}
