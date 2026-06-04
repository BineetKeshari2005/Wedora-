"""
qwen_engine.py
--------------
This module is responsible for loading Qwen2-VL from HuggingFace and running
multimodal inference on a list of image file paths.

KEY CONCEPTS:
  - Multimodal: The model processes both text (our prompt) and images (the frames)
    at the same time by converting image pixels into "vision tokens".
  - 4-bit Quantization: We load the model in BitsAndBytesConfig (4-bit). This
    reduces the GPU VRAM requirement from ~18GB to ~6GB with minimal quality loss.
    On a CPU-only machine, this helps significantly with RAM.
  - The `processor`: Qwen2-VL has two components: the model (neural network) and
    the processor (converts images+text into tokens the model understands).
"""
import json
import logging
from pathlib import Path
from typing import Optional

from PIL import Image
import torch
from transformers import Qwen2VLForConditionalGeneration, AutoProcessor, BitsAndBytesConfig

logger = logging.getLogger(__name__)

# ----------------------------------------------------------------
# SYSTEM PROMPT: Strict instruction to force structured JSON output.
# This is the core of our Prompt Engineering strategy.
# ----------------------------------------------------------------
ANALYSIS_PROMPT = """You are an expert cinematic wedding director and aesthetic analyst.
You will receive several sample frames extracted from a wedding video.
Analyze the overall vibe, style, and mood across ALL frames.

Return ONLY valid JSON with no markdown and no explanation. Use this exact schema:
{
  "themes": ["array", "of", "theme", "tags"],
  "mood": "single mood word (romantic | joyful | melancholic | energetic | elegant)",
  "aesthetics": "single style word (cinematic | vintage | boho | luxury | minimalist)",
  "luxury_level": "low | medium | high",
  "decor_tags": ["array", "of", "decor", "elements"],
  "recommended_template": "cinematic-fade | energetic-cut | moody-slow"
}"""


class QwenEngine:
    """
    Singleton wrapper for the Qwen2-VL model.
    We use a singleton so the model is only loaded once into memory,
    not on every request (loading a 7B model takes 30-60 seconds!).
    """
    _instance: Optional['QwenEngine'] = None

    def __init__(self):
        logger.info("Loading Qwen2-VL model... (This can take 1-2 minutes on first run)")
        
        # 4-bit quantization config: Reduces VRAM requirement significantly
        # load_in_4bit=True is the key flag. "nf4" is the most common 4-bit format.
        bnb_config = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=torch.float16,
        )
        
        model_name = "Qwen/Qwen2-VL-7B-Instruct"
        
        self.processor = AutoProcessor.from_pretrained(model_name)
        
        self.model = Qwen2VLForConditionalGeneration.from_pretrained(
            model_name,
            # Use quantization if a GPU (CUDA) is available, otherwise use CPU
            quantization_config=bnb_config if torch.cuda.is_available() else None,
            device_map="auto",  # Automatically places model across GPUs/CPU
            torch_dtype=torch.float16 if torch.cuda.is_available() else torch.float32,
        )
        
        logger.info("Qwen2-VL model loaded successfully!")

    @classmethod
    def get_instance(cls) -> 'QwenEngine':
        if cls._instance is None:
            cls._instance = QwenEngine()
        return cls._instance

    def analyze_frames(self, image_paths: list[str]) -> dict:
        """
        Takes a list of image file paths, sends them all to Qwen2-VL
        along with our strict prompt, and returns parsed JSON metadata.
        """
        # Build the "messages" list in the ChatML format Qwen expects
        # We interleave images and a text prompt in one message
        content = []
        for img_path in image_paths:
            content.append({"type": "image", "image": f"file://{img_path}"})
        content.append({"type": "text", "text": ANALYSIS_PROMPT})

        messages = [{"role": "user", "content": content}]

        # The processor converts messages + images into model input tensors
        text_input = self.processor.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True
        )
        
        inputs = self.processor(
            text=[text_input],
            images=[Image.open(p).convert("RGB") for p in image_paths],
            return_tensors="pt",
        ).to(self.model.device)

        # Generate the response (max 256 tokens is enough for our JSON output)
        with torch.no_grad():
            output_ids = self.model.generate(
                **inputs, 
                max_new_tokens=256,
                do_sample=False,  # Deterministic output (no randomness)
            )

        # Decode the token IDs back to a readable string
        generated_ids = [
            out[len(inp):]
            for inp, out in zip(inputs.input_ids, output_ids)
        ]
        response_text = self.processor.batch_decode(
            generated_ids, skip_special_tokens=True
        )[0].strip()

        logger.info(f"Raw Qwen Response: {response_text}")

        # Parse the JSON response — handle errors gracefully
        try:
            return json.loads(response_text)
        except json.JSONDecodeError:
            logger.error("Model did not return valid JSON. Returning defaults.")
            return {
                "themes": ["romantic"],
                "mood": "romantic",
                "aesthetics": "cinematic",
                "luxury_level": "medium",
                "decor_tags": [],
                "recommended_template": "cinematic-fade",
            }
