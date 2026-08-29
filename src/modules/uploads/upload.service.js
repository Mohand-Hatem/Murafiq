import sharp from 'sharp';
import streamifier from 'streamifier';
import cloudinary from '../../config/cloudinary.config.js';
import ApiError from '../../common/utils/ApiError.js';

const ALLOWED_FOLDERS = new Set([
  'avatars',
  'kyc-documents',
  'portfolio',
  'request-images',
  'wardrobe',
]);

/**
 * Compresses an image buffer in-memory using Sharp.
 * Capped at 1920x1920 (no upscaling) with format-appropriate compression.
 */
export const compressImage = async (buffer, mimeType) => {
  let pipeline = sharp(buffer).resize(1920, 1920, { fit: 'inside', withoutEnlargement: true });

  if (mimeType === 'image/webp') {
    pipeline = pipeline.webp({ quality: 82 });
  } else if (mimeType === 'image/png') {
    pipeline = pipeline.png({ quality: 85, compressionLevel: 8 });
  } else {
    // Default to JPEG with mozjpeg optimization
    pipeline = pipeline.jpeg({ quality: 85, mozjpeg: true });
  }

  return pipeline.toBuffer();
};

export const uploadFile = async (user, folder, file) => {
  if (!ALLOWED_FOLDERS.has(folder)) {
    throw new ApiError(400, `Invalid upload folder '${folder}'. Allowed: ${Array.from(ALLOWED_FOLDERS).join(', ')}`);
  }

  if (!file || !file.buffer) {
    throw new ApiError(400, 'No file provided for upload');
  }

  // Compress image buffers prior to upload
  let bufferToUpload = file.buffer;
  if (file.mimetype && file.mimetype.startsWith('image/')) {
    try {
      bufferToUpload = await compressImage(file.buffer, file.mimetype);
    } catch (_err) {
      // Fallback to original buffer if Sharp cannot decode or non-standard image
      bufferToUpload = file.buffer;
    }
  }

  const isKyc = folder === 'kyc-documents';
  const uploadOptions = {
    folder: `murafiq/${folder}`,
    type: isKyc ? 'authenticated' : 'upload',
    access_mode: isKyc ? 'authenticated' : 'public',
    resource_type: 'auto',
  };

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(uploadOptions, (error, result) => {
      if (error) {
        return reject(new ApiError(502, `Cloudinary upload failed: ${error.message}`));
      }

      resolve({
        publicId: result.public_id,
        format: result.format,
        bytes: result.bytes,
        url: result.secure_url,
        isPrivate: isKyc,
      });
    });

    streamifier.createReadStream(bufferToUpload).pipe(uploadStream);
  });
};

export const getSignedKycUrl = (publicId) => {
  return cloudinary.url(publicId, {
    type: 'authenticated',
    sign_url: true,
    expires_at: Math.floor(Date.now() / 1000) + 3600, // 1 hour signed link
  });
};

export default {
  compressImage,
  uploadFile,
  getSignedKycUrl,
};
