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
  'ai-chat',
  'shape-models',
  'try-on-results',
]);

export const FOLDER_ROLES = Object.freeze({
  avatars: ['client', 'stylist', 'admin'],
  'kyc-documents': ['client', 'stylist', 'admin'],
  portfolio: ['stylist', 'admin'],
  'request-images': ['client', 'admin'],
  wardrobe: ['client', 'admin'],
  'ai-chat': ['client', 'admin'],
  'shape-models': ['client', 'admin'],
  'try-on-results': ['client', 'admin'],
});

export const PRIVATE_FOLDERS = Object.freeze(
  new Set(['kyc-documents', 'shape-models', 'try-on-results'])
);

// Folder-specific max image dimension:
// ai-chat uses 768px to minimise vision-API token cost (Phase 15C Step 9).
const FOLDER_MAX_DIM = Object.freeze({
  'ai-chat': 768,
});
const DEFAULT_MAX_DIM = 1920;

/**
 * Compresses an image buffer in-memory using Sharp.
 * Dimension cap is folder-aware: ai-chat → 768px, all others → 1920px.
 */
export const compressImage = async (buffer, mimeType, folder = null) => {
  const maxDim = (folder && FOLDER_MAX_DIM[folder]) || DEFAULT_MAX_DIM;
  let pipeline = sharp(buffer).resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true });

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

  const allowedRoles = FOLDER_ROLES[folder];
  if (!user || (!allowedRoles?.includes(user.role) && user.role !== 'admin')) {
    throw new ApiError(403, `Role '${user?.role}' is not authorized to upload to folder '${folder}'`);
  }

  if (!file || !file.buffer) {
    throw new ApiError(400, 'No file provided for upload');
  }

  // Compress image buffers prior to upload (folder-aware dimension cap)
  let bufferToUpload = file.buffer;
  if (file.mimetype && file.mimetype.startsWith('image/')) {
    try {
      bufferToUpload = await compressImage(file.buffer, file.mimetype, folder);
    } catch (_err) {
      // Fallback to original buffer if Sharp cannot decode or non-standard image
      bufferToUpload = file.buffer;
    }
  }

  const isPrivate = PRIVATE_FOLDERS.has(folder);
  // User-scoped folders get per-user subfolders for ownership validation
  const userScopedFolders = new Set(['wardrobe', 'ai-chat', 'shape-models', 'try-on-results']);
  const folderPath = userScopedFolders.has(folder)
    ? `murafiq/${folder}/${user._id || user.id}`
    : `murafiq/${folder}`;

  const uploadOptions = {
    folder: folderPath,
    type: isPrivate ? 'authenticated' : 'upload',
    access_mode: isPrivate ? 'authenticated' : 'public',
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
        isPrivate,
      });
    });

    streamifier.createReadStream(bufferToUpload).pipe(uploadStream);
  });
};

export const getSignedUrl = (publicId, ttlSeconds = 3600) => {
  return cloudinary.url(publicId, {
    type: 'authenticated',
    sign_url: true,
    expires_at: Math.floor(Date.now() / 1000) + ttlSeconds,
  });
};

export const getSignedKycUrl = (publicId) => {
  return getSignedUrl(publicId, 3600);
};

/**
 * Checks whether a given Cloudinary publicId belongs to a private folder.
 * Matches patterns like 'murafiq/<folder>/...' where folder is in PRIVATE_FOLDERS.
 *
 * @param {string} publicId
 * @returns {boolean}
 */
export const isPrivateAsset = (publicId) => {
  if (!publicId || typeof publicId !== 'string') return false;
  return Array.from(PRIVATE_FOLDERS).some(
    (folder) =>
      publicId.startsWith(`murafiq/${folder}/`) ||
      publicId.startsWith(`${folder}/`) ||
      publicId === folder
  );
};

/**
 * Resolves the appropriate download/delivery URL for an asset based on its folder privacy.
 * - If already an HTTP/HTTPS URL, returns it as-is.
 * - If in PRIVATE_FOLDERS ('kyc-documents', 'shape-models', 'try-on-results'), generates a signed authenticated URL.
 * - If in public folders ('wardrobe', 'ai-chat', 'avatars', 'portfolio', 'request-images'), generates a public upload URL.
 *
 * @param {string} publicId
 * @param {number} [ttlSeconds=3600]
 * @returns {string}
 */
export const getAssetUrl = (publicId, ttlSeconds = 3600) => {
  if (!publicId || typeof publicId !== 'string') return '';
  if (publicId.startsWith('http://') || publicId.startsWith('https://')) {
    return publicId;
  }

  if (isPrivateAsset(publicId)) {
    return getSignedUrl(publicId, ttlSeconds);
  }

  return cloudinary.url(publicId, {
    type: 'upload',
    secure: true,
  });
};

export const deleteFile = async (publicId, options = {}) => {
  return cloudinary.uploader.destroy(publicId, options);
};

export default {
  compressImage,
  uploadFile,
  getSignedUrl,
  getSignedKycUrl,
  isPrivateAsset,
  getAssetUrl,
  deleteFile,
  PRIVATE_FOLDERS,
  FOLDER_ROLES,
};
