import ffmpeg from 'fluent-ffmpeg';

export interface VideoMetadata {
  duration: number; // in seconds
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
}

export class FFprobeService {
  /**
   * Extracts metadata (duration, width, height, fps) from a video using ffprobe.
   * Can accept a local file path or a remote URL.
   */
  static async getMetadata(videoUrl: string): Promise<VideoMetadata> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(videoUrl, (err, metadata) => {
        if (err) {
          console.error(`FFprobe error for ${videoUrl}:`, err);
          return reject(err);
        }

        const videoStream = metadata.streams.find(s => s.codec_type === 'video');
        if (!videoStream) {
          return reject(new Error('No video stream found in the provided media.'));
        }

        const duration = metadata.format.duration || 0;
        const width = videoStream.width || 0;
        const height = videoStream.height || 0;
        
        let fps = 30; // fallback
        if (videoStream.r_frame_rate) {
          const parts = videoStream.r_frame_rate.split('/');
          if (parts.length === 2 && parseInt(parts[1], 10) !== 0) {
            fps = parseInt(parts[0], 10) / parseInt(parts[1], 10);
          } else if (parts.length === 1) {
            fps = parseFloat(parts[0]);
          }
        }

        const hasAudio = metadata.streams.some(s => s.codec_type === 'audio');

        resolve({
          duration: Number(duration),
          width: Number(width),
          height: Number(height),
          fps: Number(fps),
          hasAudio
        });
      });
    });
  }
}
