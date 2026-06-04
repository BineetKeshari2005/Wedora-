export class ContextBuilder {
  static mergeContext(userContext: any, aiVisionAnalysis: any): any {
    return {
      userIntent: userContext || {
        vibe: 'cinematic',
        targetPlatform: 'Instagram Reels'
      },
      visionAnalysis: {
        theme: aiVisionAnalysis?.themes?.join(', ') || 'general',
        mood: aiVisionAnalysis?.mood || 'neutral',
        aesthetics: aiVisionAnalysis?.aesthetics || 'standard',
        lighting: 'natural', // Can be expanded if vision detects lighting
        cameraStyle: 'dynamic'
      }
    };
  }
}
