export class ContextBuilder {
  static mergeContext(userContext: any, aiVisionAnalysis: any): any {
    return {
      userIntent: userContext || {},
      visionAnalysis: aiVisionAnalysis || {}
    };
  }
}
