import axios, { AxiosInstance } from 'axios';
import { VideoMetadata } from './ffprobe.service';
import { EditPlan, validateEditPlan } from '../schemas/editPlan';

export class EditPlanService {
  private client: AxiosInstance;
  private model: string;

  constructor() {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error('GROQ_API_KEY not set in environment');
    }
    this.model = process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile';
    this.client = axios.create({
      baseURL: 'https://api.groq.com/openai/v1',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 60_000, 
    });
  }

  public async generateEditPlan(metadata: VideoMetadata, editPreferences: any): Promise<EditPlan> {
    const systemPrompt = `You are a strict FFmpeg EditPlan JSON generator.
Your job is to read video metadata and user editing preferences, and output a valid JSON object matching this EditPlan schema exactly:

{
  "version": "1.0",
  "editingStyle": "standard",
  "editingIntensity": "low" | "medium" | "high",
  "transitionStyle": "none" | "fade" | "slide" | "zoom",
  "cutFrequency": "slow" | "normal" | "fast",
  "aspectRatio": "16:9" | "9:16" | "1:1" | "original",
  "trimStrategy": {
    "enabled": false,
    "startTime": 0,
    "endTime": 0
  },
  "overlays": [
    {
      "text": "string",
      "startTime": 0,
      "endTime": 0,
      "position": "top" | "center" | "bottom"
    }
  ],
  "renderSettings": {
    "resolution": "1080p",
    "fps": 30,
    "format": "mp4"
  }
}

Ensure all times are within the video duration (${metadata.duration}s).
Respond ONLY with raw JSON, no markdown, no explanation.`;

    const userPrompt = `
Video Metadata:
Duration: ${metadata.duration}s
Resolution: ${metadata.width}x${metadata.height}
FPS: ${metadata.fps}

User Edit Preferences:
${JSON.stringify(editPreferences, null, 2)}
    `;

    try {
      const response = await this.client.post('/chat/completions', {
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.2, // low temp for deterministic JSON
        response_format: { type: "json_object" }
      });

      const content = response.data.choices[0]?.message?.content;
      if (!content) throw new Error('No content from Groq');

      const jsonString = content.replace(/```json/g, '').replace(/```/g, '').trim();
      const rawData = JSON.parse(jsonString);
      return validateEditPlan(rawData);
    } catch (err) {
      console.error('Groq EditPlan Error:', err);
      throw err;
    }
  }
}
