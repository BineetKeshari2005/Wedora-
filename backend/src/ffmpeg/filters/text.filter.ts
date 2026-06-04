export class TextFilter {
  /**
   * Generates a drawtext filter for elegant cinematic text centering.
   */
  static drawCenteredText(inputStream: string, text: string, outputStream: string): string {
    // Note: In production, you would provide a path to a real font file (.ttf)
    // For now, we rely on FFmpeg's default system fonts if available.
    return `${inputStream}drawtext=text='${text}':fontcolor=white:fontsize=72:x=(w-text_w)/2:y=(h-text_h)/2${outputStream}`;
  }
}
