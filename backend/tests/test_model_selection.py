import copy
from concurrent.futures import ThreadPoolExecutor

import pytest

from backend.api import routes
from backend.app import create_app
from backend.models import registry
from backend.models.transformer_branch import TransformerScore


TEXT = "这是用于验证中英文模型切换的测试文本，包含多个完整句子，确保能够正常检测。" * 5


@pytest.fixture
def selected_models(monkeypatch):
    calls = []

    class FakeScorer:
        def __init__(self, model_id, device="auto", max_length=512):
            self.model_id = model_id
            self.device = "cpu"
            self.max_length = max_length
            self.available = True
            self.reason = "ok"
            calls.append((model_id, max_length))

        def score_text(self, text):
            prob = 0.9 if self.model_id == registry.MODEL_PRESETS["zh"]["model_id"] else 0.1
            return TransformerScore(probability=prob, confidence=0.9, chunk_count=1)

    monkeypatch.setattr(registry, "TransformerAIGCScorer", FakeScorer)
    models = registry.DetectorRegistry(routes.detector)
    monkeypatch.setattr(routes, "model_registry", models)
    return create_app().test_client(), models, calls, FakeScorer


def test_model_options_do_not_download_weights(selected_models):
    client, _, calls, _ = selected_models
    response = client.get("/api/models")
    assert response.status_code == 200
    assert {item["key"] for item in response.json["models"]} == {"default", "zh", "en"}
    assert calls == []


def test_switching_uses_requested_model_and_caches_weights(selected_models):
    client, _, calls, _ = selected_models
    original_scorer = routes.detector.transformer_scorer
    for key, expected_score in (("zh", 90), ("en", 10), ("zh", 90)):
        response = client.post("/api/detect", json={"text": TEXT, "model": key, "include_details": True})
        assert response.status_code == 200
        data = response.json
        assert data["selected_model"]["key"] == key
        assert data["selected_model"]["model_id"] == registry.MODEL_PRESETS[key]["model_id"]
        assert data["aigc_score"] == pytest.approx(expected_score)
        assert data["details"]["transformer_weight"] == 1
        assert data["details"]["transformer_active_ratio"] == 1
        assert data["details"]["transformer_apply_to"] == "all"
    assert calls == [(registry.MODEL_PRESETS[k]["model_id"], registry.MODEL_PRESETS[k]["max_length"]) for k in ("zh", "en")]
    assert routes.detector.transformer_scorer is original_scorer


def test_default_selection_disables_environment_transformer(selected_models, monkeypatch):
    client, _, calls, _ = selected_models
    monkeypatch.setenv("AIGC_ENABLE_TRANSFORMER", "1")
    monkeypatch.setenv("AIGC_TRANSFORMER_MODEL_ID", "do-not-download")
    response = client.post("/api/detect", json={"text": TEXT, "model": "default", "include_details": True})
    assert response.status_code == 200
    assert response.json["selected_model"]["key"] == "default"
    assert response.json["selected_model"]["device"] == "cpu"
    assert response.json["details"]["transformer_enabled"] is False
    assert calls == []


def test_selected_model_metadata_without_details(selected_models):
    client, _, _, _ = selected_models
    response = client.post("/api/detect", json={"text": TEXT, "model": "en"})
    assert response.status_code == 200
    assert response.json["selected_model"]["key"] == "en"
    assert "details" not in response.json


@pytest.mark.parametrize("key", ["unknown", None, [], {}, 1, "https://example.org/model"])
def test_invalid_selection_is_rejected_without_loading(selected_models, key):
    client, _, calls, _ = selected_models
    response = client.post("/api/detect", json={"text": TEXT, "model": key})
    assert response.status_code == 400
    assert calls == []


def test_invalid_text_does_not_load_model(selected_models):
    client, _, calls, _ = selected_models
    response = client.post("/api/detect", json={"text": "太短", "model": "zh"})
    assert response.status_code == 400
    assert calls == []


def test_load_failure_is_not_silently_replaced_and_can_retry(selected_models, monkeypatch):
    client, _, _, scorer_class = selected_models

    class FailedScorer(scorer_class):
        def __init__(self, **kwargs):
            super().__init__(**kwargs)
            self.available = False
            self.reason = "download failed"

    monkeypatch.setattr(registry, "TransformerAIGCScorer", FailedScorer)
    response = client.post("/api/detect", json={"text": TEXT, "model": "zh"})
    assert response.status_code == 503
    assert response.json["error"]["code"] == "model_unavailable"
    assert "aigc_score" not in response.json
    monkeypatch.setattr(registry, "TransformerAIGCScorer", scorer_class)
    assert client.post("/api/detect", json={"text": TEXT, "model": "zh"}).status_code == 200


def test_inference_failure_is_not_silently_replaced(selected_models, monkeypatch):
    client, _, _, scorer_class = selected_models
    monkeypatch.setattr(scorer_class, "score_text", lambda self, text: None)
    response = client.post("/api/detect", json={"text": TEXT, "model": "en"})
    assert response.status_code == 503
    assert "aigc_score" not in response.json


def test_existing_scorer_is_reused_without_changing_legacy_configuration(selected_models):
    _, _, calls, scorer_class = selected_models
    source = copy.copy(routes.detector)
    source.transformer_scorer = scorer_class(registry.MODEL_PRESETS["en"]["model_id"], max_length=512)
    source.transformer_enabled = True
    source.transformer_model_id = source.transformer_scorer.model_id
    source.model_mode = "ml_transformer_plus_heuristic"
    models = registry.DetectorRegistry(source)
    assert models.default_key == "en"
    assert models.analyze("en", TEXT)["aigc_score"] == pytest.approx(10)
    assert models.analyze("default", TEXT)["model_mode"] == "ml_plus_heuristic"
    assert len(calls) == 1
    assert source.transformer_scorer.max_length == 512
    assert source.transformer_enabled is True


def test_concurrent_selections_remain_isolated(selected_models):
    _, models, calls, _ = selected_models
    keys = ["zh", "en", "zh", "en"]
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda key: models.analyze(key, TEXT), keys))
    assert [r["selected_model"]["key"] for r in results] == keys
    assert [r["aigc_score"] for r in results] == [90, 10, 90, 10]
    assert len(calls) == 2
