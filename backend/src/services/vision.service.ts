import fs from 'fs';
import path from 'path';

export class VisionService {
  /**
   * Analyze extracted frames using the OpenRouter API.
   * Returns a mock result if the service fails, preventing job failure.
   */
  static async analyzeFrames(framesDir: string, maxRetries = 3): Promise<any> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      console.warn('[VisionService] OPENROUTER_API_KEY is not set. Returning mock analysis.');
      return this.getMockAnalysis();
    }

    console.log('[VisionService] Analyzing frames at', framesDir, 'using OpenRouter API');
    
    try {
      const files = fs.readdirSync(framesDir).filter((f) => f.match(/\.(jpe?g|png)$/i));
      if (files.length === 0) {
        throw new Error(`No image files found in ${framesDir}`);
      }

      // Sort files numerically to maintain sequence
      files.sort((a, b) => {
        const numA = parseInt(a.replace(/[^\d]/g, ''), 10) || 0;
        const numB = parseInt(b.replace(/[^\d]/g, ''), 10) || 0;
        return numA - numB;
      });

      // Sample a maximum of 10 evenly spaced frames to avoid payload limits
      const sampleRate = Math.max(1, Math.floor(files.length / 10));
      const sampledFiles = files.filter((_, idx) => idx % sampleRate === 0).slice(0, 2);

      const contentParts: any[] = [
        {
          type: "text",
          text: `Analyze these sequential frames from a video.
Return ONLY a JSON object (without markdown wrappers or \`\`\`json blocks) with this exact schema:
{
  "themes": [],
  "weddingStyle": "",
  "luxuryLevel": "",
  "decorStyle": "",
  "recommended_template": "default-template"
}

Constraint: choose recommended_template ONLY from this list: [cinematic-fade, moody-slow, energetic-cut, default-template]`
        }
      ];

      sampledFiles.forEach(file => {
        const filePath = path.join(framesDir, file);
        const mimeType = file.match(/\.png$/i) ? 'image/png' : 'image/jpeg';
        const base64Data = Buffer.from(fs.readFileSync(filePath)).toString("base64");
        contentParts.push({
          type: "image_url",
          image_url: {
            url: `data:${mimeType};base64,${base64Data}`
          }
        });
      });

      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "http://localhost:5001", // Required by OpenRouter
          "X-Title": "Wedora Vision Analysis"
        },
        body: JSON.stringify({
          model: 'qwen/qwen2.5-vl-72b-instruct', // You can switch this to another vision-capable model on OpenRouter
          max_tokens: 300,
          temperature: 0.1,
          messages: [
            {
              role: "user",
              content: contentParts
            }
          ]
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        console.log(await response.text());
        throw new Error(`OpenRouter API Error: ${response.status} ${errText}`);
      }

      const result = await response.json();
      const responseText = result.choices?.[0]?.message?.content || "";
      
      console.log('[VisionService] Raw response text:', responseText);

      const jsonStart = responseText.indexOf('{');
      const jsonEnd = responseText.lastIndexOf('}');
      if (jsonStart !== -1 && jsonEnd !== -1) {
        const jsonText = responseText.substring(jsonStart, jsonEnd + 1);
        const parsed = JSON.parse(jsonText);
        
        console.log('[VisionService] Parsed analysis:', parsed);
        
        return {
          themes: Array.isArray(parsed.themes) ? parsed.themes : [],
          mood: parsed.mood || 'neutral',
          aesthetics: parsed.aesthetics || 'standard',
          recommended_template: parsed.recommended_template || 'default-template',
          rawVisionData: parsed
        };
      }
      throw new Error("No JSON found in response");
    } catch (err: any) {
      console.error('[VisionService] OpenRouter API failed, returning mock analysis.', err.message);
      return this.getMockAnalysis();
    }
  }

  private static getMockAnalysis() {
    return {
      
      "themes": [],
      "weddingStyle": "",
      "luxuryLevel": "",
      "decorStyle": "",
      "recommended_template": "default-template"
    };
  }
}
