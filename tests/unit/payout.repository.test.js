import { jest } from '@jest/globals';
import '../../src/common/globals.js';
import payoutRepository from '../../src/modules/payouts/payout.repository.js';
import Booking from '../../src/modules/bookings/booking.model.js';
import Payment from '../../src/modules/payments/payment.model.js';
import mongoose from 'mongoose';

describe('Payout Repository Ledger Aggregation Tests', () => {
  const stylistId = new mongoose.Types.ObjectId();
  const b1 = new mongoose.Types.ObjectId();
  const b2 = new mongoose.Types.ObjectId();
  const b3 = new mongoose.Types.ObjectId();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('aggregates pending balances: includes paid, excludes refunded, and includes partial payouts', async () => {
    const cutoffDate = new Date();

    // Mock eligible completed bookings
    jest.spyOn(Booking, 'find').mockReturnValue({
      select: jest.fn().mockResolvedValue([
        { _id: b1, price: 300, scheduledDate: new Date() },
        { _id: b2, price: 200, scheduledDate: new Date() },
        { _id: b3, price: 100, scheduledDate: new Date() },
      ]),
    });

    // Mock payment records:
    // b1: Paid, payout 255
    // b2: Partially refunded, payout 85
    // b3: Fully refunded, payout 0 (excluded from payout)
    jest.spyOn(Payment, 'find').mockResolvedValue([
      { bookingId: b1, status: 'paid', stylistPayoutAmount: 255 },
      { bookingId: b2, status: 'partially_refunded', stylistPayoutAmount: 85 },
      { bookingId: b3, status: 'refunded', stylistPayoutAmount: 0 },
    ]);

    const result = await payoutRepository.getEligibleBookingsForStylist(stylistId, cutoffDate);

    expect(result.bookings).toHaveLength(2);
    expect(result.totalPayoutAmount).toBe(340); // 255 + 85
  });
});
