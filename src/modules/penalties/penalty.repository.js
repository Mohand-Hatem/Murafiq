import Penalty from './penalty.model.js';

export const create = async (data, session = null) => {
  const options = session ? { session } : {};
  const [penaltyDoc] = await Penalty.create([data], options);
  return penaltyDoc;
};

export const findById = async (id, session = null) => {
  const query = Penalty.findById(id);
  if (session) query.session(session);
  return query;
};

export const findByBookingId = async (bookingId, session = null) => {
  const query = Penalty.find({ bookingId });
  if (session) query.session(session);
  return query;
};

export const findOutstandingByStylistId = async (stylistId, session = null) => {
  const query = Penalty.find({
    stylistId,
    status: { $in: ['OUTSTANDING', 'PARTIALLY_SETTLED'] },
  }).sort({ createdAt: 1 }); // Oldest debt first
  if (session) query.session(session);
  return query;
};

export const updateById = async (id, data, session = null) => {
  const options = { returnDocument: 'after', runValidators: true };
  if (session) options.session = session;
  return Penalty.findByIdAndUpdate(id, data, options);
};

// settledMinorIncrement may be negative -- markFailed() reverses a settlement applied at
// batch-creation time when the disbursement never actually went through, so the debt must
// go back to (partially) OUTSTANDING rather than staying incorrectly marked as collected.
// Clamped to [0, assessedMinor] both to fix the reversal case and to close a pre-existing
// over-settlement bug (a read-modify-write race could previously push settledMinor above
// assessedMinor, making outstanding debt negative and reducing other penalties' collectable
// debt in the netting loop).
export const settlePenalty = async (id, settledMinorIncrement, session = null) => {
  const penalty = await Penalty.findById(id).session(session || null);
  if (!penalty) return null;

  const newSettled = Math.max(
    0,
    Math.min(penalty.assessedMinor, (penalty.settledMinor || 0) + settledMinorIncrement)
  );
  const newStatus =
    newSettled >= penalty.assessedMinor
      ? 'SETTLED'
      : newSettled > 0
        ? 'PARTIALLY_SETTLED'
        : 'OUTSTANDING';

  const options = { returnDocument: 'after', runValidators: true };
  if (session) options.session = session;

  return Penalty.findByIdAndUpdate(
    id,
    {
      settledMinor: newSettled,
      status: newStatus,
    },
    options
  );
};

export default {
  create,
  findById,
  findByBookingId,
  findOutstandingByStylistId,
  updateById,
  settlePenalty,
};
