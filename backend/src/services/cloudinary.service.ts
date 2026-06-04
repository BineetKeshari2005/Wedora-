import cloudinary from '../config/cloudinary';
import streamifier from 'streamifier';
import { UploadApiResponse } from 'cloudinary';

export class CloudinaryService {
  /**
   * Uploads a video buffer directly to Cloudinary via a stream.
   * This is highly efficient as it bypasses writing to disk.
   */
  static uploadVideoBuffer(buffer: Buffer, folder: string = 'wedora_raw'): Promise<UploadApiResponse> {
    return new Promise((resolve, reject) => {
      // Create a Cloudinary upload stream specifically for 'video' resource types
      const cldStream = cloudinary.uploader.upload_stream(
        {
          resource_type: 'video',
          folder: folder,
        },
        (error, result) => {
          if (error || !result) {
            reject(error || new Error('Unknown Cloudinary Error'));
          } else {
            resolve(result);
          }
        }
      );

      // Convert our Buffer into a Readable stream and pipe it to Cloudinary
      streamifier.createReadStream(buffer).pipe(cldStream);
    });
  }
}
