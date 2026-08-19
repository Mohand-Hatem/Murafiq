import ScheduleBlock from './schedule.model.js';

export const findOverlap = async (stylistId, date, startMinute, endMinute, session = null) => {
  const targetDate = new Date(date);
  const startOfDay = new Date(targetDate.setUTCHours(0, 0, 0, 0));
  const endOfDay = new Date(targetDate.setUTCHours(23, 59, 59, 999));

  const query = ScheduleBlock.findOne({
    stylistId,
    date: { $gte: startOfDay, $lte: endOfDay },
    startMinute: { $lt: endMinute }, // existing block starts before our proposed end
    endMinute: { $gt: startMinute },  // existing block ends after our proposed start
  });

  if (session) query.session(session);
  return query;
};

export const create = async (data, session = null) => {
  const options = session ? { session } : {};
  const [blockDoc] = await ScheduleBlock.create([data], options);
  return blockDoc;
};

export const deleteByBookingId = async (bookingId, session = null) => {
  const options = session ? { session } : {};
  return ScheduleBlock.deleteMany({ bookingId }, options);
};

export const findStylistBlocksForDate = async (stylistId, date) => {
  const targetDate = new Date(date);
  const startOfDay = new Date(targetDate.setUTCHours(0, 0, 0, 0));
  const endOfDay = new Date(targetDate.setUTCHours(23, 59, 59, 999));

  return ScheduleBlock.find({
    stylistId,
    date: { $gte: startOfDay, $lte: endOfDay },
  }).sort({ startMinute: 1 });
};

export default {
  findOverlap,
  create,
  deleteByBookingId,
  findStylistBlocksForDate,
};
