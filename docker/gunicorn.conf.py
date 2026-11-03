bind = "0.0.0.0:5000"
# A single process owns the GPU model cache; threads keep health checks responsive.
workers = 1
worker_class = "gthread"
threads = 4
timeout = 300
graceful_timeout = 30
accesslog = "-"
errorlog = "-"
capture_output = True
preload_app = False
