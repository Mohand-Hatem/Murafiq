import mongoose from 'mongoose';
import payoutRepository from './payout.repository.js';
import stylistRepository from '../stylists/stylist.repository.js';
import bookingRepository from '../bookings/booking.repository.js';
import penaltyRepository from '../penalties/penalty.repository.js';
import eventBus from '../../common/events/event-bus.js';
import { EVENTS } from '../../common/constants/events.constant.js';
import ledgerService, { egpToPiastres, piastresToEgp } from '../ledger/ledger.service.js';
import ApiError from '../../common/utils/ApiError.js';
import logger from '../../config/logger.config.js';

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

    // Populate stylist profile details & outstanding penalties for netting preview
    const populated = await Promise.all(
      summaries.map(async (item) => {
        const profile = await stylistRepository.findByUserId(item.stylistId);
        const outstandingPenalties = await penaltyRepository.findOutstandingByStylistId(
          item.stylistId
        );

        let totalDebtMinor = 0;
        for (const p of outstandingPenalties) {
          totalDebtMinor += (p.assessedMinor || 0) - (p.settledMinor || 0);
        }
        const outstandingPenaltyAmount = piastresToEgp(totalDebtMinor);
        const grossAmount = item.totalAmount || 0;
        const netAmount = Math.max(0, Math.round((grossAmount - outstandingPenaltyAmount) * 100) / 100);

        return {
          stylistId: item.stylistId,
          eligibleBookingsCount: item.count,
          grossAmount,
          totalEligibleAmount: grossAmount,
          outstandingPenaltyAmount,
          netAmount,
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

    const work = async (session) => {
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
        const grossAmount = totalPayoutAmount;
        const grossAmountMinor = egpToPiastres(grossAmount);

        // Fetch outstanding penalties for netting
        const outstandingPenalties = await penaltyRepository.findOutstandingByStylistId(
          stylistId,
          session
        );

        let remainingToDeductMinor = 0;
        let totalDebtMinor = 0;
        for (const p of outstandingPenalties) {
          totalDebtMinor += (p.assessedMinor || 0) - (p.settledMinor || 0);
        }

        remainingToDeductMinor = Math.min(grossAmountMinor, totalDebtMinor);
        const deductions = [];

        for (const penalty of outstandingPenalties) {
          if (remainingToDeductMinor <= 0) break;
          const uncollectedMinor = (penalty.assessedMinor || 0) - (penalty.settledMinor || 0);
          const deductMinor = Math.min(uncollectedMinor, remainingToDeductMinor);

          await penaltyRepository.settlePenalty(penalty._id, deductMinor, session);
          remainingToDeductMinor -= deductMinor;

          deductions.push({
            penaltyId: penalty._id,
            amountMinor: deductMinor,
            reasonType: penalty.reasonType,
          });
        }

        const totalDeductedMinor = deductions.reduce((sum, d) => sum + d.amountMinor, 0);
        const netPayoutMinor = grossAmountMinor - totalDeductedMinor;
        const netPayoutAmount = piastresToEgp(netPayoutMinor);

        const payout = await payoutRepository.create(
          {
            stylistId,
            bookingIds,
            amount: netPayoutAmount,
            grossAmount,
            deductions,
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
    };

    if (mongoose.connection?.readyState === 1) {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          await work(session);
        });
      } finally {
        session.endSession();
      }
    } else {
      await work(null);
    }

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

    let updated;
    const work = async (session) => {
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

      // Dual-write to ledger: Escrow DEBIT, Stylist CREDIT per payout booking
      const payoutIdStr = payout._id.toString();
      const stylistIdStr = (payout.stylistId._id || payout.stylistId).toString();

      for (const bookingId of payout.bookingIds) {
        const bookingIdStr = (bookingId._id || bookingId).toString();
        const bookingDoc = await bookingRepository.findById(bookingIdStr);
        const payoutAmountEgp =
          bookingDoc && bookingDoc.price
            ? Math.round(bookingDoc.price * 0.85 * 100) / 100
            : payout.amount / (payout.bookingIds.length || 1);
        const payoutMinor = egpToPiastres(payoutAmountEgp);

        try {
          await ledgerService.postEntry(
            {
              idempotencyKey: `payout:escrow:${payoutIdStr}:${bookingIdStr}`,
              entryType: 'ESCROW_RELEASE',
              accountType: 'ESCROW',
              direction: 'DEBIT',
              amountMinor: payoutMinor,
              bookingId: bookingIdStr,
              payoutId: payoutIdStr,
              correlationId: `payout_${payoutIdStr}`,
              notes: 'Escrow release for stylist payout disbursement',
            },
            session
          );

          await ledgerService.postEntry(
            {
              idempotencyKey: `payout:stylist:${payoutIdStr}:${bookingIdStr}`,
              entryType: 'PAYOUT_DISBURSEMENT',
              accountType: 'STYLIST',
              direction: 'CREDIT',
              amountMinor: payoutMinor,
              bookingId: bookingIdStr,
              payoutId: payoutIdStr,
              accountId: stylistIdStr,
              correlationId: `payout_${payoutIdStr}`,
              notes: 'Disbursed payout to stylist',
            },
            session
          );
        } catch (ledgerErr) {
          logger.error(`[Ledger Dual-Write Warning] ${ledgerErr.message}`);
        }
      }

      // If penalties were deducted, post ledger settlement entry
      if (payout.deductions && payout.deductions.length > 0) {
        for (const deduction of payout.deductions) {
          try {
            await ledgerService.postEntry(
              {
                idempotencyKey: `payout:penalty_settled:${payoutIdStr}:${deduction.penaltyId}`,
                entryType: 'PENALTY_SETTLEMENT',
                accountType: 'STYLIST',
                accountId: stylistIdStr,
                direction: 'CREDIT', // Settling debt
                amountMinor: deduction.amountMinor,
                payoutId: payoutIdStr,
                correlationId: `payout_${payoutIdStr}`,
                notes: `Penalty debt settlement against payout #${payoutIdStr}`,
              },
              session
            );
          } catch (lErr) {
            logger.error(`[Ledger Dual-Write Warning] ${lErr.message}`);
          }
        }
      }
    };

    if (mongoose.connection?.readyState === 1) {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          await work(session);
        });
      } finally {
        session.endSession();
      }
    } else {
      await work(null);
    }

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

    let updated;
    const work = async (session) => {
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
    };

    if (mongoose.connection?.readyState === 1) {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          await work(session);
        });
      } finally {
        session.endSession();
      }
    } else {
      await work(null);
    }

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
