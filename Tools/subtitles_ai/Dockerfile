FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY subtitles_ai/requirements.txt requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY subtitles_ai/app.py app.py
COPY subtitles_ai/healthcheck.py healthcheck.py

EXPOSE 9100
CMD ["gunicorn", "--bind", "0.0.0.0:9100", "--workers", "1", "--threads", "1", "--timeout", "900", "app:app"]
