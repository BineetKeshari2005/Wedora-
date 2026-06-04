# AI Vision & Reasoning Architecture (Qwen2-VL)

Welcome to the cutting edge of AI. To analyze wedding aesthetics, we cannot use traditional computer vision (like simple object detection). We need a model that actually *understands* vibe, luxury, and mood. We will use **Qwen2-VL**, an advanced Multimodal Large Language Model (MLLM).

## User Review Required

> [!IMPORTANT]  
> Please review the architecture and theory for the AI microservice below. Since Python is the industry standard for AI inference, we are introducing a Python microservice. Once you approve, I will generate the Python architecture and integrate it with our Node.js backend.

---

## 1. Multimodal AI Systems (Deep Dive)

**What is an MLLM?**
Traditional language models (like ChatGPT initially) only understand text. **Multimodal** models can natively "see" images and video. Qwen2-VL converts the pixels of an image into tokens (just like words) and feeds them into the neural network alongside your text prompt.

**Why not analyze the whole video?**
Processing 30 frames-per-second of a 5-minute video means asking an AI to analyze 9,000 images. This is computationally devastating (slow and expensive).
*   **The Optimization:** Our FFmpeg worker is extracting 1 frame every 3 seconds. For a 15-second raw clip, that's just 5 images. We feed these 5 frames simultaneously to Qwen2-VL. It easily grasps the aesthetic without wasting compute power.

## 2. System Architecture (The Python Microservice)

While our main backend is Node.js, the vast majority of AI libraries (HuggingFace, PyTorch, vLLM) are built for Python. 
We will build a lightweight **FastAPI Python Server** that sits alongside our Node.js server.

### The Workflow:
1.  **Node.js (`ai.worker.ts`)** gets the folder path of the 5 extracted JPEG frames.
2.  It sends a POST request (`/analyze`) to our Python Server with the images.
3.  **Python (FastAPI)** loads the images and feeds them to Qwen2-VL with a strict System Prompt.
4.  Qwen2-VL returns a structured JSON string (`{ "themes": [...], "mood": "romantic" }`).
5.  FastAPI returns the JSON back to Node.js.
6.  Node.js saves it to Prisma.

---

## 3. Prompt Engineering for Aesthetics

Language models love to ramble (e.g., "In this image I can see a bride wearing a white dress..."). We don't want that. We want structured data to make programmatic rendering decisions.

We will use a highly constrained prompt:
```text
You are an expert cinematic wedding director. Analyze these frames.
Return ONLY valid JSON in this exact format:
{
  "themes": ["floral", "outdoor", "luxury"],
  "mood": "romantic",
  "aesthetics": "vintage",
  "recommended_template": "cinematic-fade" // Must be one of: cinematic-fade, energetic-cut, moody-slow
}
Do not include markdown or explanations.
```

## 4. Code Folder Structure

I will generate a new folder in our monorepo for the Python service:

```text
wedora/
├── backend/ (Node.js)
├── frontend/ (Next.js)
└── ai-service/ (Python)
    ├── main.py           # FastAPI entry point
    ├── qwen_engine.py    # The logic that loads the model via HuggingFace
    ├── requirements.txt  # Python dependencies (fastapi, uvicorn, transformers, torch)
    └── Dockerfile        # Containerizing the heavy AI environment
```

## 5. Production Optimization Strategies

1.  **Quantization (4-bit/8-bit):** Qwen2-VL is massive. If you don't have an $80,000 Nvidia H100 GPU cluster, we load the model in "4-bit quantization." It slightly lowers the math precision to shrink the RAM requirement by 75% while keeping 95% of the "smartness".
2.  **vLLM Inference Engine:** Instead of raw PyTorch, production systems use `vLLM` or `SGLang` to serve the model. It handles batching so 10 users can analyze videos at the same time. *(For this tutorial phase, we will use basic HuggingFace Transformers, but the architecture will be ready to swap).*

---

## Verification Plan

If you approve this plan:
1. I will initialize the `ai-service` folder.
2. I will generate `requirements.txt` and the FastAPI server.
3. I will write the `qwen_engine.py` using HuggingFace `transformers`.
4. I will update our Node.js `ai.worker.ts` to make HTTP calls to this new Python service instead of using dummy mock data.

> [!TIP]
> Reply "Approve" to let me generate the Python AI Vision architecture!
