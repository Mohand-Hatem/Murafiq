import { jest } from '@jest/globals';
import '../../src/common/globals.js';
import { DEFAULT_PROFILE_IMAGE_URL } from '../../src/common/constants/defaults.constant.js';

const mockFindById = jest.fn();
const mockUpdateById = jest.fn();
const mockSoftDelete = jest.fn();
const mockFindVerifications = jest.fn();

jest.unstable_mockModule('../../src/modules/users/user.repository.js', () => ({
  default: {
    findById: mockFindById,
    updateById: mockUpdateById,
    softDelete: mockSoftDelete,
    findVerifications: mockFindVerifications,
  },
}));

const mockEmit = jest.fn();
jest.unstable_mockModule('../../src/common/events/event-bus.js', () => ({
  default: { emit: mockEmit },
}));

const { default: userService } = await import('../../src/modules/users/user.service.js');

describe('userService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const sampleUser = {
    _id: { toString: () => 'user-123' },
    name: 'Jane Doe',
    email: 'jane@example.com',
    role: 'client',
    profileImage: DEFAULT_PROFILE_IMAGE_URL,
    isEmailVerified: true,
    accountStatus: 'active',
    verification: { status: 'unverified', documents: [] },
    location: { type: 'Point', coordinates: [0, 0] },
    toObject: function () {
      return this;
    },
  };

  describe('updateProfile', () => {
    it('converts lat and lng into GeoJSON coordinates [lng, lat] and emits location updated event', async () => {
      mockFindById.mockResolvedValue(sampleUser);
      const updatedUser = {
        ...sampleUser,
        country: 'Egypt',
        location: { type: 'Point', coordinates: [31.2357, 30.0444] },
      };
      mockUpdateById.mockResolvedValue(updatedUser);

      const result = await userService.updateProfile('user-123', {
        lat: 30.0444,
        lng: 31.2357,
        country: 'Egypt',
      });

      expect(mockUpdateById).toHaveBeenCalledWith('user-123', {
        country: 'Egypt',
        location: { type: 'Point', coordinates: [31.2357, 30.0444] },
      });
      expect(mockEmit).toHaveBeenCalledWith('user.location_updated', expect.objectContaining({
        userId: 'user-123',
      }));
      expect(result.location.coordinates).toEqual([31.2357, 30.0444]);
    });
  });

  describe('uploadVerificationDocs', () => {
    it('accepts 3 valid documents for a client and flips verification status to pending', async () => {
      mockFindById.mockResolvedValue(sampleUser);
      const updatedUser = {
        ...sampleUser,
        verification: {
          status: 'pending',
          documents: [
            { type: 'national_id_front', url: 'http://example.com/front.jpg' },
            { type: 'national_id_back', url: 'http://example.com/back.jpg' },
            { type: 'selfie_with_id', url: 'http://example.com/selfie.jpg' },
          ],
        },
      };
      mockUpdateById.mockResolvedValue(updatedUser);

      const clientDocs = [
        { type: 'national_id_front', url: 'http://example.com/front.jpg' },
        { type: 'national_id_back', url: 'http://example.com/back.jpg' },
        { type: 'selfie_with_id', url: 'http://example.com/selfie.jpg' },
      ];

      const result = await userService.uploadVerificationDocs('user-123', 'client', clientDocs);

      expect(result.verification.status).toBe('pending');
      expect(mockUpdateById).toHaveBeenCalledWith('user-123', expect.objectContaining({
        'verification.status': 'pending',
      }));
    });

    it('rejects an incomplete document set for a stylist with a 400 error', async () => {
      mockFindById.mockResolvedValue({ ...sampleUser, role: 'stylist' });

      const incompleteDocs = [
        { type: 'national_id_front', url: 'http://example.com/front.jpg' },
        { type: 'national_id_back', url: 'http://example.com/back.jpg' },
        { type: 'selfie_with_id', url: 'http://example.com/selfie.jpg' },
      ];

      await expect(
        userService.uploadVerificationDocs('user-123', 'stylist', incompleteDocs)
      ).rejects.toMatchObject({
        statusCode: 400,
        message: expect.stringContaining('police_clearance_certificate'),
      });
    });
  });

  describe('updateProfileImage', () => {
    it('resets profile image to DEFAULT_PROFILE_IMAGE_URL when empty string is provided', async () => {
      const updatedUser = { ...sampleUser, profileImage: DEFAULT_PROFILE_IMAGE_URL };
      mockUpdateById.mockResolvedValue(updatedUser);

      const result = await userService.updateProfileImage('user-123', '');

      expect(mockUpdateById).toHaveBeenCalledWith('user-123', {
        profileImage: DEFAULT_PROFILE_IMAGE_URL,
      });
      expect(result.profileImage).toBe(DEFAULT_PROFILE_IMAGE_URL);
    });
  });

  describe('approveVerification and rejectVerification', () => {
    const pendingUser = {
      ...sampleUser,
      verification: {
        status: 'pending',
        documents: [{ type: 'national_id_front', documentRef: 'doc_1' }],
      },
    };

    it('approves verification and emits USER_VERIFIED', async () => {
      mockFindById.mockResolvedValue(pendingUser);
      const verifiedUser = {
        ...pendingUser,
        verification: { status: 'verified', reviewedBy: 'admin-1', reviewedAt: new Date() },
      };
      mockUpdateById.mockResolvedValue(verifiedUser);

      const result = await userService.approveVerification('user-123', 'admin-1');

      expect(result.verification.status).toBe('verified');
      expect(mockEmit).toHaveBeenCalledWith('user.verified', expect.objectContaining({
        userId: 'user-123',
        reviewedBy: 'admin-1',
      }));
    });

    it('rejects verification with reason and emits USER_VERIFICATION_REJECTED', async () => {
      mockFindById.mockResolvedValue(pendingUser);
      const rejectedUser = {
        ...pendingUser,
        verification: { status: 'rejected', rejectionReason: 'Blurry document', reviewedBy: 'admin-1', reviewedAt: new Date() },
      };
      mockUpdateById.mockResolvedValue(rejectedUser);

      const result = await userService.rejectVerification('user-123', 'admin-1', 'Blurry document');

      expect(result.verification.status).toBe('rejected');
      expect(mockEmit).toHaveBeenCalledWith('user.verification_rejected', expect.objectContaining({
        userId: 'user-123',
        rejectionReason: 'Blurry document',
      }));
    });
  });
});
