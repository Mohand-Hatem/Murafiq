import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { getBusinessDayRange } from '../../src/common/utils/businessDay.util.js';

const mockFindCompletedAndCancelledByStylistId = jest.fn();
const mockAggregateRating = jest.fn();
const mockFindOutstandingByStylistId = jest.fn();
const mockStylistUpdateByUserId = jest.fn();

jest.unstable_mockModule('../../src/modules/bookings/booking.repository.js', () => ({
  default: {
    findCompletedAndCancelledByStylistId: mockFindCompletedAndCancelledByStylistId,
  },
  findCompletedAndCancelledByStylistId: mockFindCompletedAndCancelledByStylistId,
}));

jest.unstable_mockModule('../../src/modules/reviews/review.repository.js', () => ({
  default: {
    aggregateRating: mockAggregateRating,
  },
  aggregateRating: mockAggregateRating,
}));

jest.unstable_mockModule('../../src/modules/penalties/penalty.repository.js', () => ({
  default: {
    findOutstandingByStylistId: mockFindOutstandingByStylistId,
  },
  findOutstandingByStylistId: mockFindOutstandingByStylistId,
}));

jest.unstable_mockModule('../../src/modules/stylists/stylist.repository.js', () => ({
  default: {
    updateByUserId: mockStylistUpdateByUserId,
  },
  updateByUserId: mockStylistUpdateByUserId,
}));

const { reliabilityService } = await import(
  '../../src/modules/stylists/reliability.service.js'
);

describe('Stylist Reliability Scoring Engine (Unit)', () => {
  const stylistId = '60f719b8f1a2c81234567890';

  beforeEach(() => {
    jest.clearAllMocks();
    mockFindOutstandingByStylistId.mockResolvedValue([]);
    mockAggregateRating.mockResolvedValue({ avgRating: 5.0, totalReviews: 10 });
  });

  it('marks stylist with < 5 completed bookings as NEW with baseline 100.0 score', async () => {
    // 3 completed bookings
    mockFindCompletedAndCancelledByStylistId.mockResolvedValueOnce([
      { status: 'completed', checkInAt: new Date(), scheduledDate: new Date(), scheduledStartMinute: 600 },
      { status: 'completed', checkInAt: new Date(), scheduledDate: new Date(), scheduledStartMinute: 600 },
      { status: 'completed', checkInAt: new Date(), scheduledDate: new Date(), scheduledStartMinute: 600 },
    ]);

    const result = await reliabilityService.calculateReliability(stylistId);

    expect(result.isNew).toBe(true);
    expect(result.score).toBe(100.0);
    expect(result.tier).toBe('new');
    expect(result.metrics.completedCount).toBe(3);
  });

  it('computes weighted formula correctly for mature stylist with partial completion and 4.0 rating', async () => {
    // Regression coverage for the checkedInAt/checkInAt field-name mismatch and the
    // scheduledDate-without-scheduledStartMinute bug: scheduledDate alone is midnight of
    // the appointment's calendar day, not the actual scheduled instant -- the on-time
    // comparison must add scheduledStartMinute on top of it, the same way
    // getAppointmentDateTime does in booking.service.js.
    const scheduledDate = new Date('2026-08-27T00:00:00.000Z');
    const scheduledStartMinute = 600; // 10:00 local business time
    const { startOfDay } = getBusinessDayRange(scheduledDate);
    const scheduledInstant = new Date(startOfDay.getTime() + scheduledStartMinute * 60 * 1000);
    const onTimeCheckIn = new Date(scheduledInstant.getTime() + 5 * 60 * 1000); // 5 min late

    // 8 completed, 2 stylist cancelled, 5 client cancelled (client cancels ignored)
    const bookings = [
      ...Array(8).fill({
        status: 'completed',
        checkInAt: onTimeCheckIn,
        scheduledDate,
        scheduledStartMinute,
      }),
      { status: 'cancelled', cancelledBy: 'stylist' },
      { status: 'cancelled', cancelledBy: 'stylist' },
      { status: 'cancelled', cancelledBy: 'client' },
      { status: 'cancelled', cancelledBy: 'client' },
      { status: 'cancelled', cancelledBy: 'client' },
    ];

    mockFindCompletedAndCancelledByStylistId.mockResolvedValueOnce(bookings);

    // 4.0 avg rating
    mockAggregateRating.mockResolvedValueOnce({ avgRating: 4.0, totalReviews: 8 });

    // Formula calculation:
    // Completion rate: 8 / (8 + 2) = 80% (Weight 40% -> 32.0)
    // Punctuality rate: 8 / 8 = 100% (Weight 20% -> 20.0)
    // Rating score: (4.0 / 5.0) * 100 = 80% (Weight 30% -> 24.0)
    // Penalty score: 0 debt -> 100% (Weight 10% -> 10.0)
    // Composite: 32 + 20 + 24 + 10 = 86.0
    const result = await reliabilityService.calculateReliability(stylistId);

    expect(result.isNew).toBe(false);
    expect(result.score).toBe(86.0);
    expect(result.tier).toBe('trusted');
    expect(result.metrics.completedCount).toBe(8);
    expect(result.metrics.stylistCancelledCount).toBe(2);
    expect(result.metrics.clientCancelledCount).toBe(3);
    expect(result.metrics.completionRate).toBe(80.0);
  });

  it('correctly classifies a check-in as late when it is more than 15 minutes after the actual scheduled instant (not midnight)', async () => {
    // If this regressed back to comparing against scheduledDate alone (midnight), a
    // check-in at a normal time of day would always appear "late" -- this instead
    // constructs a genuinely-late check-in relative to the CORRECT scheduled instant, so
    // the assertion only passes if the on-time math is right in both directions.
    const scheduledDate = new Date('2026-08-27T00:00:00.000Z');
    const scheduledStartMinute = 600;
    const { startOfDay } = getBusinessDayRange(scheduledDate);
    const scheduledInstant = new Date(startOfDay.getTime() + scheduledStartMinute * 60 * 1000);
    const lateCheckIn = new Date(scheduledInstant.getTime() + 30 * 60 * 1000); // 30 min late

    mockFindCompletedAndCancelledByStylistId.mockResolvedValueOnce([
      ...Array(5).fill({
        status: 'completed',
        checkInAt: lateCheckIn,
        scheduledDate,
        scheduledStartMinute,
      }),
    ]);

    const result = await reliabilityService.calculateReliability(stylistId);

    expect(result.metrics.completedCount).toBe(5);
    expect(result.metrics.punctualityRate).toBe(0);
  });

  it('updates stylist profile document with computed score', async () => {
    mockFindCompletedAndCancelledByStylistId.mockResolvedValueOnce([
      { status: 'completed', checkInAt: new Date(), scheduledDate: new Date(), scheduledStartMinute: 600 },
    ]);

    await reliabilityService.updateStylistReliability(stylistId);

    expect(mockStylistUpdateByUserId).toHaveBeenCalledWith(
      stylistId,
      expect.objectContaining({
        reliabilityScore: 100,
        reliabilityTier: 'new',
      })
    );
  });
});
