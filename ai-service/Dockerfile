FROM python:3.12-slim

# Install system dependencies for Pillow and torch (CPU-only)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# If a GPU is available, the base image can be changed to nvidia/cuda if needed.
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
