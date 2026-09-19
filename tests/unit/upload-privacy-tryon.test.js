import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import '../../src/common/globals.js';
import {
  uploadFile,
  getSignedUrl,
  getSignedKycUrl,
  isPrivateAsset,
  getAssetUrl,
  PRIVATE_FOLDERS,
  FOLDER_ROLES,
} from '../../src/modules/uploads/upload.service.js';
import cloudinary from '../../src/config/cloudinary.config.js';

describe('Phase 15F Step 1 — Upload Privacy & Role Gating (upload.service.js)', () => {
  const clientUser = { _id: 'user_client_123', role: 'client' };
  const stylistUser = { _id: 'user_stylist_456', role: 'stylist' };
  const adminUser = { _id: 'user_admin_789', role: 'admin' };
  const mockFile = {
    buffer: Buffer.from('mock-image-binary-data'),
    mimetype: 'image/jpeg',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Configuration Invariants', () => {
    it('defines shape-models and try-on-results in PRIVATE_FOLDERS', () => {
      expect(PRIVATE_FOLDERS.has('shape-models')).toBe(true);
      expect(PRIVATE_FOLDERS.has('try-on-results')).toBe(true);
      expect(PRIVATE_FOLDERS.has('kyc-documents')).toBe(true);
      expect(PRIVATE_FOLDERS.has('avatars')).toBe(false);
      expect(PRIVATE_FOLDERS.has('portfolio')).toBe(false);
    });

    it('enforces correct FOLDER_ROLES authorization mappings', () => {
      expect(FOLDER_ROLES['shape-models']).toEqual(['client', 'admin']);
      expect(FOLDER_ROLES['try-on-results']).toEqual(['client', 'admin']);
      expect(FOLDER_ROLES['shape-models']).not.toContain('stylist');
    });
  });

  describe('Role-based Upload Gating', () => {
    it('allows client to upload to shape-models', async () => {
      const mockUploadStream = jest.fn((options, callback) => {
        callback(null, {
          public_id: 'murafiq/shape-models/user_client_123/uuid-1',
          format: 'jpg',
          bytes: 1024,
          secure_url: 'https://cloudinary.com/authenticated/sample.jpg',
        });
        return {
          on: jest.fn(),
          once: jest.fn(),
          emit: jest.fn(),
          write: jest.fn(),
          end: jest.fn(),
        };
      });
      jest.spyOn(cloudinary.uploader, 'upload_stream').mockImplementation(mockUploadStream);

      const result = await uploadFile(clientUser, 'shape-models', mockFile);

      expect(result.publicId).toBe('murafiq/shape-models/user_client_123/uuid-1');
      expect(result.isPrivate).toBe(true);
      expect(mockUploadStream).toHaveBeenCalledWith(
        expect.objectContaining({
          folder: 'murafiq/shape-models/user_client_123',
          type: 'authenticated',
          access_mode: 'authenticated',
        }),
        expect.any(Function)
      );
    });

    it('rejects stylist attempting to upload to shape-models with 403 Forbidden', async () => {
      await expect(uploadFile(stylistUser, 'shape-models', mockFile)).rejects.toThrow(
        /not authorized to upload to folder 'shape-models'/
      );
    });

    it('allows admin to upload to shape-models', async () => {
      const mockUploadStream = jest.fn((options, callback) => {
        callback(null, {
          public_id: 'murafiq/shape-models/user_admin_789/uuid-2',
          format: 'jpg',
          bytes: 1024,
          secure_url: 'https://cloudinary.com/authenticated/sample2.jpg',
        });
        return { on: jest.fn(), once: jest.fn(), emit: jest.fn(), write: jest.fn(), end: jest.fn() };
      });
      jest.spyOn(cloudinary.uploader, 'upload_stream').mockImplementation(mockUploadStream);

      const result = await uploadFile(adminUser, 'shape-models', mockFile);
      expect(result.isPrivate).toBe(true);
    });

    it('allows client and admin to upload to try-on-results with authenticated access mode', async () => {
      const mockUploadStream = jest.fn((options, callback) => {
        callback(null, {
          public_id: 'murafiq/try-on-results/user_client_123/uuid-result',
          format: 'png',
          bytes: 2048,
          secure_url: 'https://cloudinary.com/authenticated/result.png',
        });
        return { on: jest.fn(), once: jest.fn(), emit: jest.fn(), write: jest.fn(), end: jest.fn() };
      });
      jest.spyOn(cloudinary.uploader, 'upload_stream').mockImplementation(mockUploadStream);

      const result = await uploadFile(clientUser, 'try-on-results', mockFile);
      expect(result.isPrivate).toBe(true);
      expect(mockUploadStream).toHaveBeenCalledWith(
        expect.objectContaining({
          folder: 'murafiq/try-on-results/user_client_123',
          type: 'authenticated',
          access_mode: 'authenticated',
        }),
        expect.any(Function)
      );
    });
  });

  describe('Signed URL Generation', () => {
    it('generates authenticated signed URL with custom TTL', () => {
      const urlSpy = jest.spyOn(cloudinary, 'url').mockReturnValue('https://res.cloudinary.com/signed-url');

      const url = getSignedUrl('murafiq/shape-models/user_client_123/uuid-1', 1800);

      expect(url).toBe('https://res.cloudinary.com/signed-url');
      expect(urlSpy).toHaveBeenCalledWith(
        'murafiq/shape-models/user_client_123/uuid-1',
        expect.objectContaining({
          type: 'authenticated',
          sign_url: true,
          expires_at: expect.any(Number),
        })
      );
    });

    it('delegates getSignedKycUrl to getSignedUrl with 3600 TTL', () => {
      const urlSpy = jest.spyOn(cloudinary, 'url').mockReturnValue('https://res.cloudinary.com/signed-kyc');

      const url = getSignedKycUrl('murafiq/kyc-documents/sample-kyc');

      expect(url).toBe('https://res.cloudinary.com/signed-kyc');
      expect(urlSpy).toHaveBeenCalledWith(
        'murafiq/kyc-documents/sample-kyc',
        expect.objectContaining({
          type: 'authenticated',
          sign_url: true,
        })
      );
    });
  });

  describe('Centralized Asset Delivery URL Resolution (isPrivateAsset & getAssetUrl)', () => {
    it('isPrivateAsset correctly classifies private vs public folders', () => {
      expect(isPrivateAsset('murafiq/shape-models/user_123/model_abc')).toBe(true);
      expect(isPrivateAsset('murafiq/try-on-results/user_123/result_xyz')).toBe(true);
      expect(isPrivateAsset('murafiq/kyc-documents/user_123/doc_1')).toBe(true);

      expect(isPrivateAsset('murafiq/wardrobe/user_123/shirt_1')).toBe(false);
      expect(isPrivateAsset('murafiq/ai-chat/user_123/chat_upload_1')).toBe(false);
      expect(isPrivateAsset('murafiq/avatars/user_123/avatar')).toBe(false);
      expect(isPrivateAsset(null)).toBe(false);
      expect(isPrivateAsset('')).toBe(false);
    });

    it('returns direct HTTP/HTTPS URLs unmodified', () => {
      const httpsUrl = 'https://res.cloudinary.com/s2mm691a/image/upload/v1/murafiq/wardrobe/user_123/item.jpg';
      const httpUrl = 'http://example.com/direct-image.jpg';

      expect(getAssetUrl(httpsUrl)).toBe(httpsUrl);
      expect(getAssetUrl(httpUrl)).toBe(httpUrl);
      expect(getAssetUrl('')).toBe('');
      expect(getAssetUrl(null)).toBe('');
    });

    it('resolves private shape-model asset to authenticated signed URL', () => {
      const urlSpy = jest.spyOn(cloudinary, 'url').mockReturnValue('https://res.cloudinary.com/authenticated/signed-model.jpg');

      const url = getAssetUrl('murafiq/shape-models/user_123/model_abc', 1800);

      expect(url).toBe('https://res.cloudinary.com/authenticated/signed-model.jpg');
      expect(urlSpy).toHaveBeenCalledWith(
        'murafiq/shape-models/user_123/model_abc',
        expect.objectContaining({
          type: 'authenticated',
          sign_url: true,
          expires_at: expect.any(Number),
        })
      );
    });

    it('resolves private try-on-result asset to authenticated signed URL', () => {
      const urlSpy = jest.spyOn(cloudinary, 'url').mockReturnValue('https://res.cloudinary.com/authenticated/signed-result.jpg');

      const url = getAssetUrl('murafiq/try-on-results/user_123/result_xyz');

      expect(url).toBe('https://res.cloudinary.com/authenticated/signed-result.jpg');
      expect(urlSpy).toHaveBeenCalledWith(
        'murafiq/try-on-results/user_123/result_xyz',
        expect.objectContaining({
          type: 'authenticated',
          sign_url: true,
        })
      );
    });

    it('resolves public wardrobe asset to public upload delivery URL', () => {
      const urlSpy = jest.spyOn(cloudinary, 'url').mockReturnValue('https://res.cloudinary.com/upload/wardrobe-item.jpg');

      const url = getAssetUrl('murafiq/wardrobe/user_123/shirt_1');

      expect(url).toBe('https://res.cloudinary.com/upload/wardrobe-item.jpg');
      expect(urlSpy).toHaveBeenCalledWith(
        'murafiq/wardrobe/user_123/shirt_1',
        expect.objectContaining({
          type: 'upload',
          secure: true,
        })
      );
    });

    it('resolves public ai-chat asset to public upload delivery URL', () => {
      const urlSpy = jest.spyOn(cloudinary, 'url').mockReturnValue('https://res.cloudinary.com/upload/ai-chat-item.jpg');

      const url = getAssetUrl('murafiq/ai-chat/user_123/chat_upload_1');

      expect(url).toBe('https://res.cloudinary.com/upload/ai-chat-item.jpg');
      expect(urlSpy).toHaveBeenCalledWith(
        'murafiq/ai-chat/user_123/chat_upload_1',
        expect.objectContaining({
          type: 'upload',
          secure: true,
        })
      );
    });
  });
});
