import cloudinary from '../../config/cloudinary.config.js';
import ApiError from '../../common/utils/ApiError.js';

const ALLOWED_FOLDERS = new Set([
  'avatars',
  'kyc-documents',
  'portfolio',
  'request-images',
  'wardrobe',
]);

export const uploadFile = async (user, folder, file) => {
  if (!ALLOWED_FOLDERS.has(folder)) {
    throw new ApiError(400, `Invalid upload folder '${folder}'. Allowed: ${Array.from(ALLOWED_FOLDERS).join(', ')}`);
  }

  if (!file || !file.buffer) {
    throw new ApiError(400, 'No file provided for upload');
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

    uploadStream.end(file.buffer);
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
  uploadFile,
  getSignedKycUrl,
};
