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
# Note: audio I/O is handled entirely via torchaudio (ffmpeg backend) to avoid
# libsndfile/soundfile compatibility issues across cffi versions.

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install(
        "fastapi[standard]>=0.115.0",
        "yt-dlp>=2024.1.0",
        "demucs>=4.0.0",
        "noisereduce>=3.0.0",
        "numpy>=1.24.0",
        "scipy>=1.10.0",
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

def _download_yt(url: str, out_dir: str) -> str:
    """Download audio from a YouTube URL using yt-dlp. Returns actual output path."""
    template = os.path.join(out_dir, "yt_audio.%(ext)s")
    cmd = [
        "yt-dlp",
        "--no-playlist",
        "--extract-audio",
        "--audio-format", "wav",
        "--audio-quality", "0",
        "--output", template,
        url,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if result.returncode != 0:
        raise RuntimeError(f"yt-dlp failed: {result.stderr[:500]}")
    candidates = list(Path(out_dir).glob("yt_audio.*"))
    if not candidates:
        raise RuntimeError("yt-dlp produced no output file")
    return str(candidates[0])


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
        tail = (result.stderr + result.stdout)[-3000:]
        raise RuntimeError(f"Demucs failed (rc={result.returncode}): {tail}")

    # Demucs output: {out_dir}/{model}/{input_stem}/no_vocals.wav
    input_stem = Path(input_wav).stem
    other_path = Path(out_dir) / DEMUCS_MODEL / input_stem / "no_vocals.wav"
    if not other_path.exists():
        candidates = list(Path(out_dir).rglob("no_vocals.wav"))
        if not candidates:
            all_files = list(Path(out_dir).rglob("*"))
            raise RuntimeError(f"Demucs produced no output. Files found: {all_files}")
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
    import traceback
    from fastapi import HTTPException
    import numpy as np
    import noisereduce as nr
    import torch
    import torchaudio
    import torchaudio.functional as TAF

    url: str = body.url
    if not url:
        raise HTTPException(status_code=400, detail="url is required")

    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            demucs_out_dir = os.path.join(tmpdir, "stems")
            os.makedirs(demucs_out_dir, exist_ok=True)

            # ── Step 1: Download ─────────────────────────────────────────────
            print("[1] Downloading audio…", flush=True)
            if _is_youtube_url(url):
                raw_audio_path = _download_yt(url, tmpdir)
            else:
                raw_audio_path = os.path.join(tmpdir, "input.wav")
                _download_signed(url, raw_audio_path)
            print(f"[1] Downloaded: {raw_audio_path}", flush=True)

            # ── Step 2: Load audio via torchaudio (ffmpeg backend) ───────────
            print("[2] Loading audio…", flush=True)
            waveform, sr = torchaudio.load(raw_audio_path)
            # waveform: (channels, samples) float32 in [-1, 1]
            audio = waveform.numpy()
            print(f"[2] Loaded: shape={audio.shape}, sr={sr}", flush=True)

            # ── Step 3: noisereduce ───────────────────────────────────────────
            print("[3] Running noisereduce…", flush=True)
            if audio.shape[0] == 1:
                audio_nr = nr.reduce_noise(
                    y=audio[0], sr=sr, stationary=True, prop_decrease=0.75
                )
                audio_nr = audio_nr[np.newaxis, :]
            else:
                channels_nr = [
                    nr.reduce_noise(y=ch, sr=sr, stationary=True, prop_decrease=0.75)
                    for ch in audio
                ]
                audio_nr = np.stack(channels_nr)
            print(f"[3] Noisereduce done: shape={audio_nr.shape}", flush=True)

            # Save noise-reduced audio for Demucs (torchaudio → no soundfile needed)
            nr_path = os.path.join(tmpdir, "input_nr.wav")
            torchaudio.save(nr_path, torch.from_numpy(audio_nr.astype(np.float32)), sr)
            print(f"[3] Saved nr audio: {nr_path}", flush=True)

            # ── Step 4: Demucs stem separation ───────────────────────────────
            print("[4] Running Demucs…", flush=True)
            other_stem_path = _run_demucs(nr_path, demucs_out_dir)
            print(f"[4] Demucs done: {other_stem_path}", flush=True)

            # ── Step 5: Resample to 16 kHz mono and encode ───────────────────
            print("[5] Resampling and encoding…", flush=True)
            stem_waveform, stem_sr = torchaudio.load(str(other_stem_path))
            if stem_sr != TARGET_SR:
                stem_waveform = TAF.resample(stem_waveform, stem_sr, TARGET_SR)
            stem_mono = stem_waveform.mean(dim=0, keepdim=True)  # (1, T)

            out_wav = os.path.join(tmpdir, "output.wav")
            torchaudio.save(out_wav, stem_mono, TARGET_SR, encoding="PCM_S", bits_per_sample=16)
            with open(out_wav, "rb") as f:
                wav_bytes = f.read()
            print(f"[5] Output WAV: {len(wav_bytes)} bytes", flush=True)

        stem_b64 = base64.b64encode(wav_bytes).decode("utf-8")
        print("[OK] Returning result.", flush=True)
        return {"stem_b64": stem_b64, "mime": "audio/wav"}

    except HTTPException:
        raise
    except Exception as exc:
        print(f"ERROR in process_url: {exc}\n{traceback.format_exc()}", flush=True)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
