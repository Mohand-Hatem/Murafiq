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

export const settlePenalty = async (id, settledMinorIncrement, session = null) => {
  const penalty = await Penalty.findById(id).session(session || null);
  if (!penalty) return null;

  const newSettled = (penalty.settledMinor || 0) + settledMinorIncrement;
  const newStatus = newSettled >= penalty.assessedMinor ? 'SETTLED' : 'PARTIALLY_SETTLED';

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
