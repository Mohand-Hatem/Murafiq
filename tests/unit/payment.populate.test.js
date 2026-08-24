import '../../src/common/globals.js';
import { jest } from '@jest/globals';
import paymentRepository from '../../src/modules/payments/payment.repository.js';
import Payment from '../../src/modules/payments/payment.model.js';

describe('Payment Repository Populate Verification', () => {
  it('calls populate with real booking fields', async () => {
    const mockMongooseQuery = {
      populate: jest.fn().mockResolvedValue([{ _id: 'p1', bookingId: { scheduledStartMinute: 600 } }]),
    };
    jest.spyOn(Payment, 'find').mockReturnValue({
      find: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnValue(mockMongooseQuery),
    });
    jest.spyOn(Payment, 'countDocuments').mockResolvedValue(1);

    const res = await paymentRepository.findClientHistory('c1');
    expect(res.payments).toBeDefined();
    expect(mockMongooseQuery.populate).toHaveBeenCalledWith({
      path: 'bookingId',
      select: 'scheduledDate scheduledStartMinute scheduledEndMinute price status duration meetingLocation',
    });
  });
});
