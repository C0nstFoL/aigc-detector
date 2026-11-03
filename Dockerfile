FROM node:20-bookworm-slim@sha256:3d0f05455dea2c82e2f76e7e2543964c30f6b7d673fc1a83286736d44fe4c41c AS frontend
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY frontend/src ./src
COPY frontend/public ./public
RUN npm run build

FROM python:3.12-slim-bookworm@sha256:623674a14ef93d052bb9b0de4dbf5f28eb578a35263838941cc8aa43213c1487 AS runtime
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HF_HOME=/opt/huggingface \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1 \
    HF_HUB_DISABLE_TELEMETRY=1 \
    TOKENIZERS_PARALLELISM=false \
    AIGC_ENABLE_TRANSFORMER=0 \
    AIGC_MODEL_PATH=/app/data/models/aigc_detector_model.joblib \
    AIGC_TRANSFORMER_DEVICE=cuda \
    NVIDIA_DRIVER_CAPABILITIES=compute,utility
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 ca-certificates && rm -rf /var/lib/apt/lists/*
COPY docker/requirements.lock.txt /build/requirements.lock.txt
RUN --mount=type=cache,target=/root/.cache/pip \
    python -m pip install torch==2.10.0+cu128 --index-url https://download.pytorch.org/whl/cu128 && \
    python -m pip install -r /build/requirements.lock.txt && python -m pip check
COPY docker/bundle_models.py docker/model-manifest.json /build/
# The seed is optional: an empty seed downloads pinned weights during the build.
# Only model artifacts are copied; host credentials and global caches are excluded.
RUN --mount=type=bind,source=docker/model-cache,target=/seed,readonly \
    HF_HUB_OFFLINE=0 TRANSFORMERS_OFFLINE=0 python /build/bundle_models.py \
    --cache-dir /seed/hub --output-dir /opt/huggingface
COPY backend ./backend
COPY run.py pytest.ini ./
COPY data/models/aigc_detector_model.joblib data/models/aigc_detector_model.metadata.json data/models/runtime_config.json ./data/models/
COPY --from=frontend /build/frontend/build ./frontend/build
COPY docker/gunicorn.conf.py ./gunicorn.conf.py
COPY docker/smoke_test.py ./docker/smoke_test.py
RUN groupadd --gid 1000 app && useradd --uid 1000 --gid app --create-home --shell /usr/sbin/nologin app && \
    mkdir -p /app/backend/logs /home/app/.cache && chown -R app:app /app/backend/logs /home/app/.cache
ENV XDG_CACHE_HOME=/home/app/.cache
USER app:app
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD python -c "import json,urllib.request; d=json.load(urllib.request.urlopen('http://127.0.0.1:5000/health',timeout=3)); assert d['status']=='ok' and d['model_loaded']"
CMD ["gunicorn", "--config", "gunicorn.conf.py", "backend.app:app"]
