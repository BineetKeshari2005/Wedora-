export class ScaleFilter {
  /**
   * Generates a complex filter string that forces any video to exactly 1080x1920 (9:16).
   * It scales the video up, preserving aspect ratio, and crops the overflow (center crop).
   * 
   * @param inputStream e.g., '[0:v]'
   * @param outputStream e.g., '[scaled]'
   */
  static reelScale(inputStream: string, outputStream: string): string {
    return `${inputStream}scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:exact=1${outputStream}`;
  }
}
