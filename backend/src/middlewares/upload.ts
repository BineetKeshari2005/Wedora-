import multer from 'multer';

// Use memory storage. This keeps the uploaded file as a Buffer in RAM
// instead of saving it to the server's hard drive. Perfect for streaming to Cloudinary.
const storage = multer.memoryStorage();

// File validation filter
const fileFilter = (req: Express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  // Check if it's a video file
  if (file.mimetype.startsWith('video/')) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only video files are allowed.'));
  }
};

// Export the middleware with a 500MB size limit
export const uploadMiddleware = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB max size
  },
});
