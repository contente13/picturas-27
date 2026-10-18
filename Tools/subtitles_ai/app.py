import os
import tempfile

from flask import Flask, jsonify, request

import transcription

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 25 * 1024 * 1024


@app.get("/health")
def health():
    return jsonify({
        "status": "ok",
        "model": transcription.MODEL_NAME,
        "fastModel": transcription.FAST_MODEL_NAME,
        "longAudioSeconds": transcription.LONG_AUDIO_SECONDS,
    })


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

        try:
            duration = float(request.form.get("duration") or 0)
        except ValueError:
            duration = 0
        segments, language = transcription.transcribe_file(
            audio_path,
            language=(request.form.get("language") or "").strip() or None,
            duration=duration,
        )
        if not segments:
            return jsonify({"error": "Não foi detetada fala suficiente para criar legendas."}), 422
        return jsonify({"segments": segments, "language": language})
    except Exception as error:
        app.logger.exception("Local subtitle transcription failed")
        return jsonify({"error": "O modelo local de transcrição não conseguiu processar este áudio."}), 500
    finally:
        if audio_path and os.path.exists(audio_path):
            os.remove(audio_path)


@app.errorhandler(413)
def file_too_large(_error):
    return jsonify({"error": "O áudio é demasiado grande para gerar legendas automaticamente."}), 413
