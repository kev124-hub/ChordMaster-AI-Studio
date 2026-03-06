"""
ChordMaster AI Studio — Modal.com GPU service
=============================================
Deploys a web endpoint on a GPU (A10G) that:
  1. Downloads audio from a URL (YouTube via yt-dlp, or any signed URL)
  2. Runs noisereduce to clean up background noise
  3. Runs Demucs htdemucs_ft to separate stems (guitar/other channel)
  4. Returns the "other" stem (guitar + instruments minus vocals/bass/drums)
     as a mono 16 kHz WAV encoded in base64

Deploy:
  modal deploy modal/demucs_service.py

The resulting web endpoint URL must be set as:
  MODAL_ENDPOINT=<url>  (via Firebase Functions environment variable)
  or in .env.local for local dev

Authentication: the Firebase Function passes a base64-encoded
  MODAL_TOKEN_ID:MODAL_TOKEN_SECRET header.  Modal automatically
  validates requests to @modal.web_endpoint() using the workspace token,
  so no extra auth logic is needed here.
"""

import base64
import io
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Any

import modal
try:
    from pydantic import BaseModel
except ImportError:  # local env may not have pydantic; container always does
    BaseModel = object  # type: ignore[assignment,misc]

# ── Image ─────────────────────────────────────────────────────────────────────
# Build the container image with all required Python packages and system tools.

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "libsndfile1")
    .pip_install(
        "fastapi[standard]>=0.115.0",
        "yt-dlp>=2024.1.0",
        "demucs>=4.0.0",
        "noisereduce>=3.0.0",
        "librosa>=0.10.0",
        "soundfile>=0.12.0",
        "numpy>=1.24.0",
        "torch>=2.1.0",
        "torchaudio>=2.1.0",
        "requests>=2.31.0",
    )
    # Pre-download the Demucs model weights into /opt/demucs_cache so they are
    # baked into the image layer and never fetched at request time.
    .env({"TORCH_HOME": "/opt/demucs_cache"})
    .run_commands(
        "TORCH_HOME=/opt/demucs_cache python -c "
        "\"from demucs.pretrained import get_model; get_model('htdemucs_ft')\""
    )
)

app = modal.App("chordmaster-demucs", image=image)


class ProcessBody(BaseModel):
    url: str


# ── Constants ─────────────────────────────────────────────────────────────────
TARGET_SR = 16_000  # Gemini works best with 16 kHz
DEMUCS_MODEL = "htdemucs_ft"  # Fine-tuned hybrid transformer — best quality


# ── Helper: download audio ────────────────────────────────────────────────────

def _download_yt(url: str, out_path: str) -> None:
    """Download audio from a YouTube URL using yt-dlp."""
    cmd = [
        "yt-dlp",
        "--no-playlist",
        "--extract-audio",
        "--audio-format", "wav",
        "--audio-quality", "0",
        "--output", out_path,
        url,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if result.returncode != 0:
        raise RuntimeError(f"yt-dlp failed: {result.stderr[:500]}")


def _download_signed(url: str, out_path: str) -> None:
    """Download audio from a signed Storage URL (or any direct URL)."""
    import requests

    resp = requests.get(url, stream=True, timeout=60)
    resp.raise_for_status()
    with open(out_path, "wb") as f:
        for chunk in resp.iter_content(chunk_size=65536):
            f.write(chunk)


def _is_youtube_url(url: str) -> bool:
    return "youtube.com" in url or "youtu.be" in url


# ── Helper: run Demucs ────────────────────────────────────────────────────────

def _run_demucs(input_wav: str, out_dir: str) -> Path:
    """
    Run Demucs stem separation.  Returns path to the 'other' stem WAV
    (which captures guitar + other non-vocal instruments).
    """
    cmd = [
        "python", "-m", "demucs.separate",
        "--two-stems", "vocals",  # splits into vocals + other
        "--name", DEMUCS_MODEL,
        "--out", out_dir,
        input_wav,
    ]
    env = os.environ.copy()
    env["TORCH_HOME"] = "/opt/demucs_cache"
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=240, env=env)
    if result.returncode != 0:
        # Use the tail of stderr (progress bars fill the head; errors are at the end).
        # Include stdout too in case Demucs printed the error there.
        tail = (result.stderr + result.stdout)[-3000:]
        raise RuntimeError(f"Demucs failed (rc={result.returncode}): {tail}")

    # Find the output file: {out_dir}/{model}/{stem_name}/no_vocals.wav
    input_stem = Path(input_wav).stem
    other_path = Path(out_dir) / DEMUCS_MODEL / input_stem / "no_vocals.wav"
    if not other_path.exists():
        # Fallback: walk and find any no_vocals.wav
        candidates = list(Path(out_dir).rglob("no_vocals.wav"))
        if not candidates:
            raise RuntimeError("Demucs produced no output file.")
        other_path = candidates[0]

    return other_path


# ── Main endpoint ─────────────────────────────────────────────────────────────

@app.function(
    gpu="A10G",
    timeout=300,
    memory=8192,
)
@modal.fastapi_endpoint(method="POST")
def process_url(body: ProcessBody) -> dict[str, Any]:
    """
    POST body: { "url": "<youtube-or-signed-url>" }
    Response:  { "stem_b64": "<base64 WAV>", "mime": "audio/wav" }
    """
    from fastapi import HTTPException
    import numpy as np
    import noisereduce as nr
    import librosa
    import soundfile as sf

    url: str = body.url
    if not url:
        raise HTTPException(status_code=400, detail="url is required")

    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            raw_audio_path = os.path.join(tmpdir, "input.wav")
            demucs_out_dir = os.path.join(tmpdir, "stems")
            os.makedirs(demucs_out_dir, exist_ok=True)

            # ── Step 1: Download ─────────────────────────────────────────────
            if _is_youtube_url(url):
                _download_yt(url, raw_audio_path)
            else:
                _download_signed(url, raw_audio_path)

            # ── Step 2: noisereduce (stationary noise) ───────────────────────
            audio, sr = librosa.load(raw_audio_path, sr=None, mono=False)
            # noisereduce expects (samples,) for mono or (channels, samples) for stereo
            if audio.ndim == 1:
                audio_nr = nr.reduce_noise(y=audio, sr=sr, stationary=True, prop_decrease=0.75)
            else:
                # Process each channel independently
                channels_nr = [
                    nr.reduce_noise(y=ch, sr=sr, stationary=True, prop_decrease=0.75)
                    for ch in audio
                ]
                audio_nr = np.stack(channels_nr)

            # Save noise-reduced audio for Demucs
            nr_path = os.path.join(tmpdir, "input_nr.wav")
            sf.write(nr_path, audio_nr.T if audio_nr.ndim == 2 else audio_nr, sr)

            # ── Step 3: Demucs stem separation ───────────────────────────────
            other_stem_path = _run_demucs(nr_path, demucs_out_dir)

            # ── Step 4: Resample to 16 kHz mono ──────────────────────────────
            stem_audio, stem_sr = librosa.load(str(other_stem_path), sr=TARGET_SR, mono=True)

            wav_buffer = io.BytesIO()
            sf.write(wav_buffer, stem_audio, TARGET_SR, format="WAV", subtype="PCM_16")
            wav_bytes = wav_buffer.getvalue()

        stem_b64 = base64.b64encode(wav_bytes).decode("utf-8")
        return {"stem_b64": stem_b64, "mime": "audio/wav"}

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
