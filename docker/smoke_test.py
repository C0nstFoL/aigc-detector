"""Validate all bundled models, including CUDA inference, without network access."""

import json
import sys
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from backend.app import create_app


def main():
    assert torch.cuda.is_available(), "CUDA is not available in the container"
    x = torch.ones((64, 64), device="cuda")
    assert torch.all(x @ x == 64).item()
    print(json.dumps({
        "python": sys.version.split()[0],
        "torch": torch.__version__,
        "cuda": torch.version.cuda,
        "gpu": torch.cuda.get_device_name(0),
    }), flush=True)
    client = create_app().test_client()
    assert client.get("/").status_code == 200
    assert client.get("/health").get_json()["model_loaded"]
    assert {item["key"] for item in client.get("/api/models").get_json()["models"]} == {"default", "zh", "en"}
    texts = {
        "zh": "这是一段用于验证部署环境的中文测试文本。程序需要使用指定模型完成推理，并返回模型名称和检测结果。通过这些检查，可以确认镜像中的权重和运行环境完整。",
        "en": "This paragraph is used to verify the deployed text detection service. It checks that the chosen model can load and run inference from the bundled weights, returning a score and its actual identity without downloading any additional files.",
    }
    for key in ("default", "zh", "en", "zh"):
        response = client.post("/api/detect", json={
            "model": key, "text": texts.get(key, texts["zh"]), "include_details": True,
        })
        result = response.get_json()
        assert response.status_code == 200, result
        assert result["selected_model"]["key"] == key
        assert result["details"]["transformer_enabled"] == (key != "default")
        if key != "default":
            assert result["selected_model"]["device"] == "cuda"
            assert result["details"]["transformer_active_ratio"] == 1.0
        print(json.dumps({"model": result["selected_model"], "seconds": result["processing_time"]}, ensure_ascii=False), flush=True)
    print("Offline Docker smoke test passed", flush=True)


if __name__ == "__main__":
    main()
