"""官方 Video-Depth-Anything Small，按镜头推理；不修改借用的源码和环境。"""
import argparse
from fractions import Fraction
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
import sys
import tempfile

SMALL_SHA256 = "13379300b739e659f076a59d52e9801bd8d38c541a7e71f73bbca4dcfb013609"
sys.dont_write_bytecode = True


def verify_checkpoint(model_dir):
    checkpoint = Path(model_dir) / "checkpoints" / "video_depth_anything_vits.pth"
    digest = hashlib.sha256()
    with checkpoint.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    if digest.hexdigest() != SMALL_SHA256:
        raise ValueError("模型权重 SHA256 不对，只允许官方 Small 权重")
    return checkpoint


def geometry(width, height, fps, resolution):
    if not 0.4 <= width / height <= 2.5:
        raise ValueError("原视频宽高比要在 0.4 到 2.5 之间")
    if not math.isfinite(fps) or fps <= 0:
        raise ValueError("原视频读不出帧率")
    factor = max(int(resolution[:-1]) / min(width, height), math.sqrt(407696 / (width * height)))
    return math.ceil(width * factor / 2) * 2, math.ceil(height * factor / 2) * 2, min(60, max(24, fps))


def run(args):
    result = subprocess.run(args, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if result.returncode:
        raise RuntimeError(result.stderr[-4000:])
    return result


def probe(path):
    payload = json.loads(run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                              "stream=width,height,avg_frame_rate,nb_frames,duration:stream_side_data=rotation:format=duration",
                              "-of", "json", str(path)]).stdout)
    stream = payload["streams"][0]
    # 手机竖拍常只写旋转标记，ffmpeg 解码会自动转正，宽高要按转过后的方向算。
    rotation = next((item.get("rotation") for item in stream.get("side_data_list", []) if "rotation" in item), 0)
    if abs(int(rotation)) % 180 == 90:
        stream["width"], stream["height"] = stream["height"], stream["width"]
    duration = float(stream.get("duration") or payload["format"]["duration"])
    return stream, duration


def cuts(path, fps, count):
    result = run(["ffmpeg", "-hide_banner", "-i", str(path), "-vf", "select=gt(scene\\,0.30),showinfo",
                  "-an", "-f", "null", "-"])
    times = [float(value) for value in re.findall(r"pts_time:([\d.]+)", result.stderr)]
    return sorted({0, count, *(round(t * fps) for t in times if 0 < round(t * fps) < count)})


def decode_frames(source, expected, cv2, np):
    capture = cv2.VideoCapture(str(source))
    if not capture.isOpened():
        raise RuntimeError("OpenCV 无法打开输入视频")
    frames = []
    try:
        while True:
            valid, bgr = capture.read()
            if not valid:
                break
            frames.append(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
    finally:
        capture.release()
    if not frames:
        raise ValueError("视频没有可解码的帧")
    if len(frames) != expected:
        raise ValueError("解码帧数与 ffprobe 不一致，视频可能损坏")
    return np.stack(frames)


def histogram_lut(values=None, histogram=None):
    """全镜头256桶限幅均衡；桶上限8倍均值，溢出均匀回填以限制增益。"""
    counts = [0] * 256 if histogram is None else list(histogram)
    if values is not None:
        for value in values:
            counts[value] += 1
    total = sum(counts)
    if total <= 0:
        raise ValueError("深度直方图为空")
    limit = 8 * total / 256
    excess = sum(max(0, count - limit) for count in counts) / 256
    cumulative, table = 0, []
    for count in counts:
        cumulative += min(count, limit) + excess
        table.append(min(255, round(255 * cumulative / total)))
    return table


def depth_bin(value, lower, upper):
    return max(0, min(255, int((value - lower) * 255 / (upper - lower))))


def shot_mapping(frames, np=None):
    if np is None:
        values = [value for frame in frames for value in frame]
        lower, upper = min(values), max(values)
    else:
        lower, upper = float(frames.min()), float(frames.max())
    if upper - lower < 1e-6:
        raise ValueError("模型输出是全平灰度")
    if np is None:
        table = histogram_lut(depth_bin(v, lower, upper) for v in values)
    else:
        counts = np.zeros(256, dtype=np.int64)
        for frame in frames:
            bins = np.clip((frame.astype(np.float64) - lower) * (255 / (upper - lower)), 0, 255).astype(np.uint8)
            counts += np.bincount(bins.ravel(), minlength=256)
        table = histogram_lut(histogram=counts.tolist())
    return lower, upper, table


def map_sample(value, mapping):
    lower, upper, table = mapping
    return table[depth_bin(value, lower, upper)]

def temporal_tables(histograms, max_step=3, np=None):
    """逐帧限幅CDF，加全图自动曝光和时间约束；不依赖画面区域。"""
    targets = []
    for counts in histograms:
        total, cumulative, quantiles = sum(counts), 0, []
        if total <= 0:
            raise ValueError("深度直方图为空")
        for index, count in enumerate(counts):
            cumulative += count
            while len(quantiles) < 2 and cumulative >= total * (0.1, 0.6)[len(quantiles)]:
                quantiles.append(index)
        # 以主体分布宽度限幅，避免贴镜头的长尾压低全部对比度。
        cap = 2 * total / max(1, quantiles[1] - quantiles[0])
        excess = sum(max(0, count - cap) for count in counts) / len(counts)
        cumulative, target = 0, []
        for count in counts:
            cumulative += min(count, cap) + excess
            target.append(min(255, max(0, 255 * (2 * cumulative / total - 0.5))))
        targets.append(target)
    if not targets:
        raise ValueError("镜头没有深度帧")
    targets = stabilize_tables(targets, histograms, max_step, np)
    lower, upper = [row[:] for row in targets], [row[:] for row in targets]
    for order, previous in ((range(1, len(targets)), -1), (range(len(targets) - 2, -1, -1), 1)):
        for index in order:
            lower[index] = [min(a, b + max_step) for a, b in zip(lower[index], lower[index + previous])]
            upper[index] = [max(a, b - max_step) for a, b in zip(upper[index], upper[index + previous])]
    rounded = [[round((a + b) / 2) for a, b in zip(lo, hi)] for lo, hi in zip(lower, upper)]
    for index in range(1, len(rounded)):
        rounded[index] = [min(b + max_step, max(b - max_step, a)) for a, b in zip(rounded[index], rounded[index - 1])]
    return rounded

def stabilize_tables(targets, histograms, max_step, np=None):
    bound = max_step - 0.5
    if np is not None:
        tables = np.array(targets, dtype=np.float64)
        weights = np.asarray(histograms, dtype=np.float64)
        weights /= weights.sum(axis=1, keepdims=True)
        for _ in range(256):
            means = (tables * weights).sum(axis=1)
            active = (weights * ((tables > 0) & (tables < 255))).sum(axis=1)
            shift = np.clip((127.5 - means) / np.maximum(active, 0.01), -16, 16) * 0.5
            tables = np.clip(tables + shift[:, None], 0, 255)
            for parity in (0, 1):
                left, right = tables[parity:-1:2], tables[parity + 1::2]
                delta = right - left
                correction = (delta - np.clip(delta, -bound, bound)) / 2
                left += correction
                right -= correction
            if np.abs((tables * weights).sum(axis=1) - 127.5).max() <= 4 and (
                    len(tables) == 1 or np.abs(np.diff(tables, axis=0)).max() <= bound + 0.1):
                break
        return tables.tolist()
    tables = [row[:] for row in targets]
    weights = [[n / sum(row) for n in row] for row in histograms]
    for _ in range(256):
        for index, (row, weight) in enumerate(zip(tables, weights)):
            mean = sum(a * b for a, b in zip(row, weight))
            active = sum(w for value, w in zip(row, weight) if 0 < value < 255)
            shift = min(16, max(-16, (127.5 - mean) / max(active, 0.01))) * 0.5
            tables[index] = [min(255, max(0, value + shift)) for value in row]
        for parity in (0, 1):
            for index in range(parity, len(tables) - 1, 2):
                left, right = tables[index:index + 2]
                changes = [(b - a - min(bound, max(-bound, b - a))) / 2 for a, b in zip(left, right)]
                tables[index] = [a + delta for a, delta in zip(left, changes)]
                tables[index + 1] = [b - delta for b, delta in zip(right, changes)]
        exposure = max(abs(sum(a * b for a, b in zip(row, weight)) - 127.5) for row, weight in zip(tables, weights))
        jump = max((abs(a - b) for left, right in zip(tables, tables[1:]) for a, b in zip(left, right)), default=0)
        if exposure <= 4 and jump <= bound + 0.1:
            break
    return tables

def shot_gray(depths, np):
    """只用本镜头全图统计，不使用帧率、秒数或画面位置。"""
    if depths.ndim != 3 or not depths.size or not np.isfinite(depths).all():
        raise ValueError("镜头深度数组为空、尺寸不对或含无效值")
    lower, upper = float(depths.min()), float(depths.max())
    if upper - lower < 1e-6:
        raise ValueError("模型输出是全平灰度")
    scale = 4095 / (upper - lower)
    histogram = []
    for frame in depths:
        bins = np.clip((frame.astype(np.float64) - lower) * scale, 0, 4095).astype(np.int32)
        histogram.append(np.bincount(bins.ravel(), minlength=4096).tolist())
    tables = np.asarray(temporal_tables(histogram, np=np), dtype=np.uint8)
    gray = np.empty(depths.shape, dtype=np.uint8)
    for index, frame in enumerate(depths):
        bins = np.clip((frame.astype(np.float64) - lower) * scale, 0, 4095).astype(np.int32)
        gray[index] = tables[index][bins]
    return gray

def infer(source, output, width, height, fps, duration, checkpoint):
    # 只在配置和权重通过后导入借来的环境；CUDA 缺失绝不回退 CPU。
    import cv2
    import numpy as np
    import torch
    from video_depth_anything.video_depth import VideoDepthAnything

    if not torch.cuda.is_available():
        raise RuntimeError("NO_CUDA：没找到可用的 CUDA 显卡，不会改用 CPU")
    info, _ = probe(source)
    frames = decode_frames(source, int(info["nb_frames"]), cv2, np)
    boundaries = cuts(source, fps, len(frames))
    model = VideoDepthAnything(encoder="vits", features=64, out_channels=[48, 96, 192, 384])
    model.load_state_dict(torch.load(checkpoint, map_location="cpu", weights_only=True), strict=True)
    model = model.to("cuda").eval()
    # 错误写临时文件，避免 ffmpeg 的 stderr 管道写满造成推理挂住。
    with tempfile.TemporaryFile() as errors:
        encoder = subprocess.Popen([
            "ffmpeg", "-v", "error", "-n", "-f", "rawvideo", "-pixel_format", "gray",
            "-video_size", f"{width}x{height}", "-framerate", str(fps), "-i", "pipe:0",
            "-an", "-t", str(duration), "-c:v", "libx264", "-crf", "18", "-preset", "fast",
            "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(output)],
            stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=errors)
        try:
            for shot, (start, end) in enumerate(zip(boundaries[:-1], boundaries[1:]), 1):
                print(json.dumps({"shot": shot, "shots": len(boundaries) - 1}), flush=True)
                with torch.inference_mode():
                    depths, result_fps = model.infer_video_depth(frames[start:end], fps, input_size=518,
                                                                device="cuda", fp32=False)
                torch.cuda.synchronize()
                if depths.shape != (end - start, height, width) or result_fps != fps:
                    raise ValueError("模型输出尺寸或帧率与输入不一致")
                if not np.isfinite(depths).all():
                    raise ValueError("模型输出含无效的深度值")
                grays = shot_gray(depths, np)
                for gray in grays:
                    if float(gray.std()) < 1:
                        raise ValueError("模型输出含接近全平的灰度帧")
                    encoder.stdin.write(gray.tobytes())
                del depths, grays
            encoder.stdin.close()
            if encoder.wait():
                errors.seek(0)
                raise RuntimeError(errors.read().decode("utf-8", errors="replace")[-4000:])
        except BaseException:
            if encoder.poll() is None:
                encoder.kill()
                encoder.wait()
            raise


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--resolution", choices=["480p", "720p"], required=True)
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--extra-packages", type=Path)
    args = parser.parse_args()
    if args.output.exists():
        raise FileExistsError("输出文件已经存在，不覆盖")
    checkpoint = verify_checkpoint(args.model_dir)
    sys.path[:0] = ([str(args.extra_packages)] if args.extra_packages else []) + [str(args.model_dir)]
    info, duration = probe(args.input)
    if duration > 30:
        raise ValueError("原片超过 30 秒，火山参考视频最长 30 秒，请先截短。")
    width, height, fps = geometry(int(info["width"]), int(info["height"]),
                                  float(Fraction(info["avg_frame_rate"])), args.resolution)
    # 先规整到参考视频尺寸，避免把6K源片全帧放进内存，按原时长补帧/丢帧。
    with tempfile.TemporaryDirectory(dir=args.output.parent) as folder:
        normalized = Path(folder) / "normalized.mp4"
        run(["ffmpeg", "-v", "error", "-n", "-i", str(args.input), "-an", "-vf",
             f"scale={width}:{height},fps={fps}", "-t", str(duration), "-c:v", "libx264",
             "-crf", "18", "-pix_fmt", "yuv420p", str(normalized)])
        infer(normalized, args.output, width, height, fps, duration, checkpoint)
    result, result_duration = probe(args.output)
    if int(result["width"]) != width or int(result["height"]) != height:
        raise ValueError("编码后尺寸不一致")
    if abs(float(Fraction(result["avg_frame_rate"])) - fps) > 0.001 or abs(result_duration - duration) > 1 / fps + 0.001:
        raise ValueError("编码后帧率或时长不一致")


if __name__ == "__main__":
    main()
