import mongoose from 'mongoose';
import payoutRepository from './payout.repository.js';
import stylistRepository from '../stylists/stylist.repository.js';
import bookingRepository from '../bookings/booking.repository.js';
import eventBus from '../../common/events/event-bus.js';
import { EVENTS } from '../../common/constants/events.constant.js';

const DISPUTE_WINDOW_HOURS = 48;

class PayoutService {
  async getPayoutAccount(stylistUserId) {
    const profile = await stylistRepository.findByUserId(stylistUserId);
    if (!profile) {
      throw new ApiError(404, 'Stylist profile not found');
    }
    return profile.payoutAccount || null;
  }

  async updatePayoutAccount(stylistUserId, accountData) {
    const profile = await stylistRepository.findByUserId(stylistUserId);
    if (!profile) {
      throw new ApiError(404, 'Stylist profile not found');
    }

    const updated = await stylistRepository.updateByUserId(stylistUserId, {
      payoutAccount: accountData,
    });

    return updated.payoutAccount;
  }

  async getStylistPayouts(stylistUserId, queryString) {
    return payoutRepository.findStylistPayouts(stylistUserId, queryString);
  }

  async getPendingBalancesSummary(holdWindowHours = DISPUTE_WINDOW_HOURS) {
    const cutoffDate = new Date(Date.now() - holdWindowHours * 3600 * 1000);
    const summaries = await payoutRepository.getPendingBalancesSummary(cutoffDate);

    // Populate stylist profile details
    const populated = await Promise.all(
      summaries.map(async (item) => {
        const profile = await stylistRepository.findByUserId(item.stylistId);
        return {
          stylistId: item.stylistId,
          eligibleBookingsCount: item.count,
          totalEligibleAmount: item.totalAmount,
          payoutAccount: profile?.payoutAccount || null,
        };
      })
    );

    return populated;
  }

  async getAllPayouts(queryString) {
    return payoutRepository.findAllPayouts(queryString);
  }

  async createBatchPayouts(adminUserId, { stylistIds, holdWindowHours = DISPUTE_WINDOW_HOURS }) {
    const cutoffDate = new Date(Date.now() - holdWindowHours * 3600 * 1000);
    const createdPayouts = [];

    const session = await mongoose.startSession();
    await session.withTransaction(async () => {
      for (const stylistId of stylistIds) {
        const profile = await stylistRepository.findByUserId(stylistId);
        if (!profile || !profile.payoutAccount || !profile.payoutAccount.method) {
          throw new ApiError(400, `Stylist ${stylistId} has no configured payout account`);
        }

        const { bookings, totalPayoutAmount } = await payoutRepository.getEligibleBookingsForStylist(
          stylistId,
          cutoffDate
        );

        if (bookings.length === 0 || totalPayoutAmount <= 0) {
          continue;
        }

        const bookingIds = bookings.map((b) => b._id);

        const payout = await payoutRepository.create(
          {
            stylistId,
            bookingIds,
            amount: totalPayoutAmount,
            currency: 'EGP',
            status: 'pending',
            method: profile.payoutAccount.method,
            payoutAccountDetails: profile.payoutAccount,
            processedBy: adminUserId,
            processedAt: new Date(),
          },
          session
        );

        // Mark associated bookings as processing
        await bookingRepository.updateManyPayoutStatus(
          bookingIds,
          { payoutStatus: 'processing', payoutId: payout._id },
          session
        );

        createdPayouts.push(payout);
      }
    });
    session.endSession();

    for (const payout of createdPayouts) {
      eventBus.emit(EVENTS.PAYOUT_CREATED, {
        payoutId: payout._id.toString(),
        stylistId: payout.stylistId.toString(),
        amount: payout.amount,
        processedBy: adminUserId,
      });
    }

    return createdPayouts;
  }

  async markProcessing(payoutId, adminUserId) {
    const payout = await payoutRepository.findById(payoutId);
    if (!payout) {
      throw new ApiError(404, 'Payout record not found');
    }

    if (payout.status !== 'pending') {
      throw new ApiError(
        409,
        `Cannot mark processing: current status is '${payout.status}' (only 'pending' can move to 'processing')`
      );
    }

    const updated = await payoutRepository.updateById(payoutId, {
      status: 'processing',
      processedBy: adminUserId,
      processedAt: new Date(),
    });

    eventBus.emit(EVENTS.PAYOUT_PROCESSING, {
      payoutId: payout._id.toString(),
      stylistId: payout.stylistId._id ? payout.stylistId._id.toString() : payout.stylistId.toString(),
      processedBy: adminUserId,
    });

    return updated;
  }

  async markPaid(payoutId, adminUserId, { reference }) {
    const payout = await payoutRepository.findById(payoutId);
    if (!payout) {
      throw new ApiError(404, 'Payout record not found');
    }

    if (payout.status === 'paid') {
      throw new ApiError(409, 'Payout is already marked as paid');
    }

    if (payout.status !== 'processing' && payout.status !== 'pending') {
      throw new ApiError(409, `Cannot mark paid: current status is '${payout.status}'`);
    }

    const session = await mongoose.startSession();
    let updated;
    await session.withTransaction(async () => {
      updated = await payoutRepository.updateById(
        payoutId,
        {
          status: 'paid',
          reference: reference || null,
          paidAt: new Date(),
          processedBy: adminUserId,
        },
        session
      );

      await bookingRepository.updateManyPayoutStatus(
        payout.bookingIds,
        { payoutStatus: 'paid' },
        session
      );
    });
    session.endSession();

    eventBus.emit(EVENTS.PAYOUT_PAID, {
      payoutId: payout._id.toString(),
      stylistId: payout.stylistId._id ? payout.stylistId._id.toString() : payout.stylistId.toString(),
      amount: payout.amount,
      reference,
      processedBy: adminUserId,
    });

    return updated;
  }

  async markFailed(payoutId, adminUserId, { failureReason }) {
    const payout = await payoutRepository.findById(payoutId);
    if (!payout) {
      throw new ApiError(404, 'Payout record not found');
    }

    if (payout.status === 'paid') {
      throw new ApiError(409, 'Cannot mark as failed: payout is already marked as paid');
    }

    const session = await mongoose.startSession();
    let updated;
    await session.withTransaction(async () => {
      updated = await payoutRepository.updateById(
        payoutId,
        {
          status: 'failed',
          failureReason: failureReason || 'Disbursement rejected',
          processedBy: adminUserId,
        },
        session
      );

      // Revert bookings to unpaid so they can be re-batched
      await bookingRepository.updateManyPayoutStatus(
        payout.bookingIds,
        { payoutStatus: 'unpaid', payoutId: null },
        session
      );
    });
    session.endSession();

    eventBus.emit(EVENTS.PAYOUT_FAILED, {
      payoutId: payout._id.toString(),
      stylistId: payout.stylistId._id ? payout.stylistId._id.toString() : payout.stylistId.toString(),
      failureReason,
      processedBy: adminUserId,
    });

    return updated;
  }
}

export const payoutService = new PayoutService();
export default payoutService;
