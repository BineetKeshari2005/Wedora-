import os
import io
import json
from typing import List

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from qwen_engine import QwenVisionModel

app = FastAPI(title="Qwen2-VL Inference Service", version="0.1.0")

# Load the model once at startup for efficiency
model = QwenVisionModel()

class AnalyzeResponse(BaseModel):
    themes: List[str]
    mood: str
    decor: List[str]
    style: str
    confidence: float

@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze_frames(files: List[UploadFile] = File(...)):
    """Receive a batch of JPEG/PNG frames and return aesthetic metadata.

    The client (backend worker) will zip frames or send them individually.
    For simplicity we accept multiple file uploads.
    """
    if not files:
        raise HTTPException(status_code=400, detail="No frames provided")

    # Load images into memory
    images = []
    for upload in files:
        content = await upload.read()
        images.append(io.BytesIO(content))

    # Run the multimodal model (implementation inside qwen_engine.py)
    try:
        result = model.analyze(images)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return JSONResponse(content=result)

# Health check
@app.get("/health")
async def health_check():
    return {"status": "ok"}
