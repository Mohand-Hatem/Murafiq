import '../../src/common/globals.js';
import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const mockEventFindById = jest.fn();
const mockEventUpdateById = jest.fn();
const mockEventCreate = jest.fn();
const mockFindOpenUserReport = jest.fn();
const mockPolicyViolationCountActive = jest.fn();
const mockPolicyViolationCreate = jest.fn();
const mockUserUpdateById = jest.fn();
const mockBookingFindById = jest.fn();

jest.unstable_mockModule('../../src/modules/moderation/moderation-event.repository.js', () => ({
  default: {
    findById: mockEventFindById,
    updateById: mockEventUpdateById,
    create: mockEventCreate,
    findOpenUserReport: mockFindOpenUserReport,
  },
  findById: mockEventFindById,
  updateById: mockEventUpdateById,
  create: mockEventCreate,
  findOpenUserReport: mockFindOpenUserReport,
}));

jest.unstable_mockModule('../../src/modules/moderation/policy-violation.repository.js', () => ({
  default: {
    countActiveByUserId: mockPolicyViolationCountActive,
    create: mockPolicyViolationCreate,
  },
  countActiveByUserId: mockPolicyViolationCountActive,
  create: mockPolicyViolationCreate,
}));

jest.unstable_mockModule('../../src/modules/users/user.repository.js', () => ({
  default: { updateById: mockUserUpdateById },
  updateById: mockUserUpdateById,
}));

jest.unstable_mockModule('../../src/modules/bookings/booking.repository.js', () => ({
  default: { findById: mockBookingFindById },
  findById: mockBookingFindById,
}));

jest.unstable_mockModule('../../src/modules/moderation/blocked-domain.repository.js', () => ({
  default: { findAllActiveDomains: jest.fn().mockResolvedValue([]) },
  findAllActiveDomains: jest.fn().mockResolvedValue([]),
}));

jest.unstable_mockModule('../../src/modules/moderation/blocked-word.repository.js', () => ({
  default: { findAllActiveWords: jest.fn().mockResolvedValue([]) },
  findAllActiveWords: jest.fn().mockResolvedValue([]),
}));

const { confirmEvent, overturnEvent, reportContent } = await import(
  '../../src/modules/moderation/moderation.service.js'
);

const bookingId = '60f719b8f1a2c81234567888';
const clientId = '60f719b8f1a2c81234567891';
const stylistId = '60f719b8f1a2c81234567890';
const outsiderId = '60f719b8f1a2c81234567899';
const adminId = '60f719b8f1a2c81234567877';
const eventId = '60f719b8f1a2c81234567866';

/**
 * Regression suite for docs/archive/audits/AUDIT_2026_09_FULL_SYSTEM.md findings X11 and X13.
 */
describe('confirmEvent / overturnEvent — reviewStatus and enforcement (X11)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('writes reviewStatus:APPROVED on confirm, not the nonexistent reviewOutcome field', async () => {
    mockEventFindById.mockResolvedValue({
      _id: eventId,
      senderId: stylistId,
      matchedLayer: 'REGEX_CONTACT',
      reviewStatus: 'PENDING',
    });
    mockEventUpdateById.mockResolvedValue({ _id: eventId, reviewStatus: 'APPROVED' });
    mockPolicyViolationCountActive.mockResolvedValue(0);

    await confirmEvent(eventId, adminId, 'Confirmed violation');

    expect(mockEventUpdateById).toHaveBeenCalledWith(
      eventId,
      expect.objectContaining({ reviewStatus: 'APPROVED', reviewedBy: adminId })
    );
    expect(mockEventUpdateById).not.toHaveBeenCalledWith(
      eventId,
      expect.objectContaining({ reviewOutcome: expect.anything() })
    );
  });

  it('applies real enforcement (a PolicyViolation strike) when a report is confirmed', async () => {
    mockEventFindById.mockResolvedValue({
      _id: eventId,
      senderId: stylistId,
      matchedLayer: 'USER_REPORT',
      reviewStatus: 'PENDING',
    });
    mockEventUpdateById.mockResolvedValue({ _id: eventId, reviewStatus: 'APPROVED' });
    mockPolicyViolationCountActive.mockResolvedValue(0);

    await confirmEvent(eventId, adminId, 'Confirmed violation');

    expect(mockPolicyViolationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: stylistId,
        violationType: 'HARASSMENT',
        enforcementAction: 'WARN',
      })
    );
  });

  it('writes reviewStatus:DISMISSED on overturn and applies no enforcement', async () => {
    mockEventFindById.mockResolvedValue({
      _id: eventId,
      senderId: stylistId,
      reviewStatus: 'PENDING',
    });
    mockEventUpdateById.mockResolvedValue({ _id: eventId, reviewStatus: 'DISMISSED' });

    await overturnEvent(eventId, adminId, 'Not a real violation');

    expect(mockEventUpdateById).toHaveBeenCalledWith(
      eventId,
      expect.objectContaining({ reviewStatus: 'DISMISSED' })
    );
    expect(mockPolicyViolationCreate).not.toHaveBeenCalled();
  });

  it('refuses to review an event twice', async () => {
    mockEventFindById.mockResolvedValue({
      _id: eventId,
      senderId: stylistId,
      reviewStatus: 'APPROVED',
    });

    await expect(confirmEvent(eventId, adminId, 'again')).rejects.toThrow(/already been reviewed/);
  });
});

describe('reportContent — participant check (X13)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindOpenUserReport.mockResolvedValue(null);
    mockEventCreate.mockResolvedValue({ _id: eventId });
  });

  const booking = {
    _id: bookingId,
    clientId: { _id: clientId, toString: () => clientId },
    stylistId: { _id: stylistId, toString: () => stylistId },
  };

  it('allows a participant to report the other participant', async () => {
    mockBookingFindById.mockResolvedValue(booking);

    const result = await reportContent(clientId, {
      conversationId: bookingId,
      reportedUserId: stylistId,
      reason: 'Inappropriate messages',
    });

    expect(result.reported).toBe(true);
  });

  it('refuses a report where the reporter is not a participant of the conversation', async () => {
    mockBookingFindById.mockResolvedValue(booking);

    await expect(
      reportContent(outsiderId, {
        conversationId: bookingId,
        reportedUserId: stylistId,
        reason: 'Fabricated report',
      })
    ).rejects.toThrow(/participant/);

    expect(mockEventCreate).not.toHaveBeenCalled();
  });

  it('refuses a report where the reported user is not a participant of the conversation', async () => {
    mockBookingFindById.mockResolvedValue(booking);

    await expect(
      reportContent(clientId, {
        conversationId: bookingId,
        reportedUserId: outsiderId,
        reason: 'Reporting an unrelated stranger',
      })
    ).rejects.toThrow(/participant/);

    expect(mockEventCreate).not.toHaveBeenCalled();
  });
});
