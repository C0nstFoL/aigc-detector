"""Request-scoped model selection with lazy loading and serialized inference."""

import copy
import logging
import os
from threading import RLock

from .detector import AIGCDetector
from .transformer_branch import TransformerAIGCScorer

try:
    from backend.utils.text_processing import preprocess_text
except ImportError:  # 兼容从 backend 目录运行
    from utils.text_processing import preprocess_text


logger = logging.getLogger(__name__)

MODEL_PRESETS = {
    "default": {
        "name": "默认 · 轻量模型",
        "language": "zh",
        "model_id": None,
        "description": "内置轻量模型，使用 CPU，无需下载。",
    },
    "zh": {
        "name": "中文 · zhV3",
        "language": "zh",
        "model_id": "yuchuantian/AIGC_detector_zhv3",
        "max_length": 512,
        "description": "适合中文文本。首次使用需要加载模型，请稍候。",
    },
    "en": {
        "name": "英文 · n4.0",
        "language": "en",
        "model_id": "abhi099k/ai-text-detector-v-n4.0",
        "max_length": 256,
        "description": "适合英文文本，中文效果未验证。首次使用需要加载模型，请稍候。",
    },
}


class ModelUnavailableError(RuntimeError):
    """The requested model could not provide a result; do not fall back."""


class DetectorRegistry:
    def __init__(self, default_detector: AIGCDetector):
        self._lock = RLock()
        # Reuse the read-only sklearn objects, without mutating the legacy detector
        # or process environment shared by other requests.
        self._base = copy.copy(default_detector)
        self._base.transformer_scorer = None
        self._base.transformer_enabled = False
        self._base.transformer_model_id = None
        self._base.model_mode = {
            "ml_transformer_plus_heuristic": "ml_plus_heuristic",
            "transformer_plus_heuristic": "heuristic_only",
        }.get(default_detector.model_mode, default_detector.model_mode)
        self._detectors = {"default": self._base}
        self.default_key = "default"
        for key, preset in MODEL_PRESETS.items():
            if preset["model_id"] and preset["model_id"] == default_detector.transformer_model_id:
                self.default_key = key
                if default_detector.transformer_enabled:
                    scorer = copy.copy(default_detector.transformer_scorer)
                    scorer.max_length = preset["max_length"]
                    self._detectors[key] = self._with_scorer(scorer)

    def options(self):
        with self._lock:
            return {
                "default_model": self.default_key,
                "models": [
                    {"key": key, **preset, "loaded": key in self._detectors}
                    for key, preset in MODEL_PRESETS.items()
                ],
            }

    def _with_scorer(self, scorer):
        detector = copy.copy(self._base)
        detector.transformer_scorer = scorer
        detector.transformer_enabled = True
        detector.transformer_model_id = scorer.model_id
        detector.transformer_apply_to = "all"
        detector.transformer_weight = 1.0
        detector.model_blend_alpha = 1.0
        detector.model_mode = (
            "ml_transformer_plus_heuristic" if detector.model_loaded else "transformer_plus_heuristic"
        )
        return detector

    def _get_detector(self, key):
        if key not in MODEL_PRESETS:
            raise ValueError("未知模型，请选择默认、中文或英文模型")
        if key not in self._detectors:
            preset = MODEL_PRESETS[key]
            scorer = TransformerAIGCScorer(
                model_id=preset["model_id"],
                device=os.getenv("AIGC_TRANSFORMER_DEVICE", "auto").strip() or "auto",
                max_length=preset["max_length"],
            )
            if not scorer.available:
                logger.error("所选模型加载失败 key=%s reason=%s", key, scorer.reason)
                raise ModelUnavailableError(
                    f"{preset['name']}加载失败，请检查模型文件、代理和网络连接后重试"
                )
            self._detectors[key] = self._with_scorer(scorer)
        return self._detectors[key]

    def analyze(self, key, text, include_details=False):
        if not isinstance(key, str) or key not in MODEL_PRESETS:
            raise ValueError("未知模型，请选择默认、中文或英文模型")
        # Validate before downloading a model for an invalid request.
        cleaned = preprocess_text(text, preserve_newlines=True)
        if len(cleaned) < self._base.min_text_length:
            raise ValueError(
                f"文本长度不足，当前为 {len(cleaned)}，至少需要 {self._base.min_text_length} 个字符"
            )
        with self._lock:
            detector = self._get_detector(key)
            result = detector.analyze(text, include_details=True)
            if key != "default" and result["details"]["transformer_active_ratio"] != 1.0:
                raise ModelUnavailableError("所选模型推理失败，请重试或选择其他模型")
            if not include_details:
                result.pop("details", None)
            result["selected_model"] = {
                "key": key,
                "name": MODEL_PRESETS[key]["name"],
                "model_id": MODEL_PRESETS[key]["model_id"],
                "device": detector.transformer_scorer.device if key != "default" else "cpu",
            }
            return result
