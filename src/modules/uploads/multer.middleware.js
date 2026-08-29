import multer from 'multer';
import ApiError from '../../common/utils/ApiError.js';

const storage = multer.memoryStorage();

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

const fileFilter = (_req, file, cb) => {
  if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new ApiError(400, `Unsupported file format '${file.mimetype}'. Allowed: JPEG, PNG, WEBP, PDF`), false);
  }
};

export const uploadSingle = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter,
}).single('file');

export default uploadSingle;
