import os
import tempfile

from faster_whisper import WhisperModel
from flask import Flask, jsonify, request

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 25 * 1024 * 1024

MODEL_NAME = os.environ.get("SUBTITLE_MODEL", "base")
MODEL_DIR = os.environ.get("HF_HOME", "/models")
os.makedirs(MODEL_DIR, exist_ok=True)

# The model is loaded once per container and reused for each transcription.
model = WhisperModel(
    MODEL_NAME,
    device="cpu",
    compute_type="int8",
    download_root=MODEL_DIR,
    cpu_threads=int(os.environ.get("SUBTITLE_CPU_THREADS", "4")),
)


@app.get("/health")
def health():
    return jsonify({"status": "ok", "model": MODEL_NAME})


@app.post("/transcribe")
def transcribe():
    uploaded = request.files.get("file")
    if uploaded is None:
        return jsonify({"error": "Ficheiro de áudio em falta."}), 400

    audio_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as audio_file:
            audio_path = audio_file.name
            uploaded.save(audio_path)

        segments, _info = model.transcribe(
            audio_path,
            beam_size=5,
            vad_filter=True,
            condition_on_previous_text=False,
        )
        result = [
            {"start": float(segment.start), "end": float(segment.end), "text": segment.text.strip()}
            for segment in segments
            if segment.text.strip()
        ]
        if not result:
            return jsonify({"error": "Não foi detetada fala suficiente para criar legendas."}), 422
        return jsonify({"segments": result})
    except Exception as error:
        app.logger.exception("Local subtitle transcription failed")
        return jsonify({"error": "O modelo local de transcrição não conseguiu processar este áudio."}), 500
    finally:
        if audio_path and os.path.exists(audio_path):
            os.remove(audio_path)


@app.errorhandler(413)
def file_too_large(_error):
    return jsonify({"error": "O áudio é demasiado grande para gerar legendas automaticamente."}), 413
