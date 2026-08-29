import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const mockBlockedDomainFindAllActive = jest.fn();
const mockModerationEventCreate = jest.fn();
const mockPolicyViolationCountActive = jest.fn();
const mockPolicyViolationCreate = jest.fn();
const mockPolicyViolationFindById = jest.fn();
const mockPolicyViolationUpdateById = jest.fn();
const mockUserUpdateById = jest.fn();

jest.unstable_mockModule('../../src/modules/moderation/blocked-domain.repository.js', () => ({
  default: {
    findAllActiveDomains: mockBlockedDomainFindAllActive,
  },
  findAllActiveDomains: mockBlockedDomainFindAllActive,
}));

jest.unstable_mockModule('../../src/modules/moderation/moderation-event.repository.js', () => ({
  default: {
    create: mockModerationEventCreate,
  },
  create: mockModerationEventCreate,
}));

jest.unstable_mockModule('../../src/modules/moderation/policy-violation.repository.js', () => ({
  default: {
    countActiveByUserId: mockPolicyViolationCountActive,
    create: mockPolicyViolationCreate,
    findById: mockPolicyViolationFindById,
    updateById: mockPolicyViolationUpdateById,
  },
  countActiveByUserId: mockPolicyViolationCountActive,
  create: mockPolicyViolationCreate,
  findById: mockPolicyViolationFindById,
  updateById: mockPolicyViolationUpdateById,
}));

jest.unstable_mockModule('../../src/modules/users/user.repository.js', () => ({
  default: {
    updateById: mockUserUpdateById,
  },
  updateById: mockUserUpdateById,
}));

const { scanAndEnforce, forgiveStrike } = await import(
  '../../src/modules/moderation/moderation.service.js'
);
const { default: env } = await import('../../src/config/env.config.js');

describe('Moderation Service & 3-Strike Escalation (Unit)', () => {
  const userId = '60f719b8f1a2c81234567890';
  const adminId = '60f719b8f1a2c81234567899';
  const violationId = '60f719b8f1a2c81234567877';

  beforeEach(() => {
    jest.clearAllMocks();
    mockBlockedDomainFindAllActive.mockResolvedValue(['badseller.com']);
    mockModerationEventCreate.mockResolvedValue({ _id: 'event-1' });
  });

  describe('scanAndEnforce — DRY_RUN mode', () => {
    it('logs event and does not throw under DRY_RUN mode', async () => {
      env.MODERATION_MODE = 'DRY_RUN';

      const result = await scanAndEnforce(
        userId,
        'MESSAGE',
        'Call me at 01012345678 to book offline'
      );

      expect(result.isAllowed).toBe(true);
      expect(result.flagged).toBe(true);
      expect(mockModerationEventCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          senderId: userId,
          actionTaken: 'OBSERVED',
        })
      );
      expect(mockPolicyViolationCreate).not.toHaveBeenCalled();
    });
  });

  describe('scanAndEnforce — ENFORCE mode', () => {
    beforeEach(() => {
      env.MODERATION_MODE = 'ENFORCE';
    });

    it('issues strike 1 WARN and throws 422 for first-time offense', async () => {
      mockPolicyViolationCountActive.mockResolvedValueOnce(0); // 0 active strikes

      await expect(
        scanAndEnforce(userId, 'OFFER', 'Send money via instapay please')
      ).rejects.toThrow(/Content violation/);

      expect(mockPolicyViolationCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          enforcementAction: 'WARN',
        })
      );
      // Strike 1 is a warning only: the violation is recorded but the account is not
      // touched, so a first slip does not cost the user their session.
      expect(mockUserUpdateById).not.toHaveBeenCalled();
    });

    it('issues strike 2 RESTRICT and throws 422 for second offense', async () => {
      mockPolicyViolationCountActive.mockResolvedValueOnce(1); // 1 active strike

      await expect(
        scanAndEnforce(userId, 'REQUEST', 'Contact me on whatsapp 01123456789')
      ).rejects.toThrow(/Content violation/);

      expect(mockPolicyViolationCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          enforcementAction: 'RESTRICT',
        })
      );
      // Strike 2 must actually restrict the account AND kill live sessions. Previously
      // this branch recorded the violation and did nothing else, so a second-strike user
      // carried on chatting with a valid token.
      expect(mockUserUpdateById).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({
          accountStatus: 'restricted',
          $inc: { tokenVersion: 1 },
        })
      );
    });

    it('issues strike 3 SUSPEND and suspends user account on third offense', async () => {
      mockPolicyViolationCountActive.mockResolvedValueOnce(2); // 2 active strikes

      await expect(
        scanAndEnforce(userId, 'MESSAGE', 'Check out badseller.com now')
      ).rejects.toThrow(/Content violation/);

      expect(mockPolicyViolationCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          enforcementAction: 'SUSPEND',
        })
      );
      // Suspension must also revoke the session: clearing the refresh token and bumping
      // tokenVersion is what makes the ban take effect now rather than in 15 minutes.
      expect(mockUserUpdateById).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({
          accountStatus: 'suspended',
          sessions: [],
          $inc: { tokenVersion: 1 },
        })
      );
    });
  });

  describe('forgiveStrike', () => {
    it('marks a policy violation strike as RESOLVED by admin', async () => {
      mockPolicyViolationFindById.mockResolvedValueOnce({ _id: violationId, status: 'ACTIVE' });
      mockPolicyViolationUpdateById.mockResolvedValueOnce({
        _id: violationId,
        status: 'RESOLVED',
        resolvedBy: adminId,
      });

      const result = await forgiveStrike(violationId, adminId);

      expect(result.status).toBe('RESOLVED');
      expect(mockPolicyViolationUpdateById).toHaveBeenCalledWith(
        violationId,
        expect.objectContaining({ status: 'RESOLVED', resolvedBy: adminId })
      );
    });
  });
});
