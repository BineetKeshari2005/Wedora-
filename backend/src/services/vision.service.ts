import fs from 'fs';
import path from 'path';
import { selectRepresentativeFrames } from '../utils/frameSelector';

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
      const sampledFiles = selectRepresentativeFrames(framesDir, 8);
      
      if (sampledFiles.length === 0) {
        throw new Error(`No image files found in ${framesDir}`);
      }

      const contentParts: any[] = [
        {
          type: "text",
          text: `Analyze these sequential frames from a video.
Return ONLY a JSON object (without markdown wrappers or \`\`\`json blocks) with this exact schema:
{
  "sceneSummary": "<1-2 sentence factual description of what is visible>",
  "visibleElements": ["<object1>", "<object2>", ...],
  "decorElements": ["<decor1>", "<decor2>", ...],
  "venueFeatures": ["<feature1>", "<feature2>", ...],
  "dominantColors": ["<color1>", "<color2>", ...],
  "lightingCharacteristics": ["<lighting1>", ...],
  "cameraMovements": ["<movement1>", ...],
  "peopleAndActivities": ["<activity1>", ...],
  "uniqueVisualDetails": ["<detail1>", ...]
}

Rules:
- Report ONLY what is directly visible in the frames.
- Do NOT infer emotions or marketing qualities — stick to factual observations.
- Be specific: say "red and gold flower garlands" not just "decorations".
- Vary your descriptions — don't repeat the same words across different videos.
- Maximum 5 items per array.
- Keep the sceneSummary under 40 words.
- Return valid JSON only, no markdown.`
        }
      ];

      sampledFiles.forEach(filePath => {
        const mimeType = filePath.match(/\.png$/i) ? 'image/png' : 'image/jpeg';
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
          model: 'qwen/qwen2.5-vl-72b-instruct',
          max_tokens: 500,
          temperature: 0.3,
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
          sceneSummary: parsed.sceneSummary || '',
          visibleElements: Array.isArray(parsed.visibleElements) ? parsed.visibleElements : [],
          decorElements: Array.isArray(parsed.decorElements) ? parsed.decorElements : [],
          venueFeatures: Array.isArray(parsed.venueFeatures) ? parsed.venueFeatures : [],
          dominantColors: Array.isArray(parsed.dominantColors) ? parsed.dominantColors : [],
          lightingCharacteristics: Array.isArray(parsed.lightingCharacteristics) ? parsed.lightingCharacteristics : [],
          cameraMovements: Array.isArray(parsed.cameraMovements) ? parsed.cameraMovements : [],
          peopleAndActivities: Array.isArray(parsed.peopleAndActivities) ? parsed.peopleAndActivities : [],
          uniqueVisualDetails: Array.isArray(parsed.uniqueVisualDetails) ? parsed.uniqueVisualDetails : [],
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
      sceneSummary: "No visual data available",
      visibleElements: [],
      decorElements: [],
      venueFeatures: [],
      dominantColors: [],
      lightingCharacteristics: [],
      cameraMovements: [],
      peopleAndActivities: [],
      uniqueVisualDetails: [],
      rawVisionData: {}
    };
  }
}
