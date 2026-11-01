"""仅标准库测试；显卡、模型、ffmpeg 均不执行。"""
import importlib.util
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace, ModuleType
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location("depth_video", Path(__file__).with_name("depth_video.py"))
depth = importlib.util.module_from_spec(spec)
spec.loader.exec_module(depth)


class DepthTest(unittest.TestCase):
    def test_integer_rounding_cannot_break_temporal_limit(self):
        # 合法浮点映射恰好差3；银行家舍入会把0.5/3.5变成0/4。
        with patch.object(depth, "stabilize_tables", return_value=[[0.5, 64.5, 255], [3.5, 67.5, 255]]):
            tables = depth.temporal_tables([[1, 1, 1], [1, 1, 1]])
        self.assertLessEqual(max(abs(a - b) for a, b in zip(*tables)), 3)
        self.assertTrue(all(a <= b for row in tables for a, b in zip(row, row[1:])))

    def test_temporal_mapping_handles_drifting_ground_without_flicker(self):
        histograms, positions = [], []
        for frame in range(120):
            ground = 12 + frame // 6
            subject = ground + 6
            counts = [0] * 256
            for value in range(ground - 3, ground + 4):
                counts[value] += 20
            for value in range(subject - 2, subject + 3):
                counts[value] += 20
            counts[255] = 80  # 贴镜头的近物，不参与定位任何画面区域。
            histograms.append(counts)
            positions.append((ground, subject))
        saved = [row[:] for row in histograms]
        tables = depth.temporal_tables(histograms)
        self.assertEqual(histograms, saved)
        for table, (ground, subject) in zip(tables, positions):
            self.assertGreaterEqual(table[subject] - table[ground], 40)
            self.assertTrue(all(a <= b for a, b in zip(table, table[1:])))
            self.assertTrue(all(0 <= value <= 255 for value in table))
        self.assertLessEqual(max(abs(a - b) for left, right in zip(tables, tables[1:])
                                 for a, b in zip(left, right)), 3)
        other = depth.temporal_tables([list(reversed(row)) for row in histograms])
        self.assertNotEqual(tables, other)
        self.assertEqual(tables, depth.temporal_tables(histograms))

    def test_clipped_histogram_brightens_subject_and_limits_noise(self):
        # 地面2~9、主体12~17、贴镜头近物255；原线性亮度差仅9。
        values = list(range(2, 10)) * 100 + list(range(12, 18)) * 100 + [255] * 600
        table = depth.histogram_lut(values)
        self.assertGreaterEqual(table[15] - table[6], 40)
        self.assertGreater(table[15] - table[6], 4 * (15 - 6))
        self.assertTrue(all(a <= b for a, b in zip(table, table[1:])))
        self.assertLessEqual(max(b - a for a, b in zip(table, table[1:])), 9)
        counts = [values.count(value) for value in range(256)]
        adaptive = depth.temporal_tables([counts])[0]
        self.assertGreaterEqual(adaptive[15] - adaptive[6], 40)
        self.assertTrue(all(a <= b for a, b in zip(adaptive, adaptive[1:])))

    def test_legacy_mapping_is_consistent_and_shots_are_independent(self):
        frames = [[2, 6, 15, 255] * 100, [3, 6, 15, 255] * 120]
        mapping = depth.shot_mapping(frames)
        lower, upper, table = mapping
        self.assertEqual((lower, upper), (2, 255))
        self.assertEqual(depth.map_sample(15, mapping), table[depth.depth_bin(15, lower, upper)])
        self.assertEqual([depth.map_sample(frame[2], mapping) for frame in frames], [table[13]] * 2)
        other = depth.shot_mapping([[0, 90, 100] * 100])
        self.assertNotEqual(mapping, other)
        self.assertNotEqual(depth.map_sample(15, mapping), depth.map_sample(15, other))

    def test_truncated_decoder_rejects_missing_frames(self):
        capture = Mock()
        capture.isOpened.return_value = True
        capture.read.side_effect = [(True, "frame"), (False, None)]
        cv2 = SimpleNamespace(VideoCapture=lambda _: capture, cvtColor=lambda frame, _: frame, COLOR_BGR2RGB=1)
        with self.assertRaisesRegex(ValueError, "解码帧数"):
            depth.decode_frames("clip", 2, cv2, Mock())
        capture.release.assert_called_once()

    def test_wrong_checkpoint_rejected_before_model_import(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / "checkpoints"
            target.mkdir()
            (target / "video_depth_anything_vits.pth").write_bytes(b"not official small")
            with self.assertRaisesRegex(ValueError, "SHA256.*Small"):
                depth.verify_checkpoint(folder)

    def test_geometry_minimum_area_and_fps(self):
        self.assertEqual(depth.geometry(1920, 1080, 30, "480p"), (854, 480, 30))
        self.assertEqual(depth.geometry(1000, 1000, 12, "480p"), (640, 640, 24))
        self.assertEqual(depth.geometry(1080, 1920, 90, "720p"), (720, 1280, 60))
        with self.assertRaisesRegex(ValueError, "宽高比"):
            depth.geometry(100, 1000, 30, "480p")

    def test_no_cuda_never_loads_model_or_cpu(self):
        model = Mock()
        vendor = ModuleType("video_depth_anything.video_depth")
        vendor.VideoDepthAnything = model
        modules = {"cv2": ModuleType("cv2"), "numpy": ModuleType("numpy"),
                   "torch": SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: False)),
                   "video_depth_anything": ModuleType("video_depth_anything"),
                   "video_depth_anything.video_depth": vendor}
        with patch.dict(sys.modules, modules):
            with self.assertRaisesRegex(RuntimeError, "NO_CUDA"):
                depth.infer("in", "out", 854, 480, 30, 2, "checkpoint")
        model.assert_not_called()

    def test_ffmpeg_shot_detection_and_probe_use_injected_executor(self):
        executor = Mock(return_value=SimpleNamespace(returncode=0, stderr="pts_time:1.0", stdout=""))
        with patch.object(depth.subprocess, "run", executor):
            self.assertEqual(depth.cuts("input.mp4", 30, 60), [0, 30, 60])
        args = executor.call_args.args[0]
        self.assertEqual(args[0], "ffmpeg")
        self.assertIn("select=gt(scene\\,0.30),showinfo", args)
        self.assertEqual(args[args.index("-i") + 1], "input.mp4")

    def test_probe_swaps_size_for_phone_rotation(self):
        def reply(rotation):
            stream = {"width": 1920, "height": 1080, "avg_frame_rate": "30/1", "duration": "2.0",
                      **({"side_data_list": [{"rotation": rotation}]} if rotation is not None else {})}
            return SimpleNamespace(returncode=0, stderr="", stdout=depth.json.dumps({"streams": [stream], "format": {}}))
        for rotation, size in [(-90, (1080, 1920)), (270, (1080, 1920)), (180, (1920, 1080)), (None, (1920, 1080))]:
            with patch.object(depth.subprocess, "run", Mock(return_value=reply(rotation))):
                stream, duration = depth.probe("input.mp4")
            self.assertEqual((stream["width"], stream["height"]), size)
            self.assertEqual(duration, 2.0)


if __name__ == "__main__":
    unittest.main()
