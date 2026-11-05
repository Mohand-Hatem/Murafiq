import getBusinessDayRange from './businessDay.util.js';
import { timeToMinutes } from './timeUtils.js';

// A booking's scheduled start and end as real instants: the Cairo calendar day of scheduledDate
// plus its minutes-since-midnight. Here (not in booking.service.js) so booking.dto.js can use it
// without a circular import.
export const getAppointmentDateTime = (booking) => {
  const { startOfDay } = getBusinessDayRange(booking.scheduledDate || booking.date, 'Africa/Cairo');
  const startMinute =
    booking.scheduledStartMinute !== undefined && booking.scheduledStartMinute !== null
      ? booking.scheduledStartMinute
      : timeToMinutes(booking.time || '10:00');
  return new Date(startOfDay.getTime() + startMinute * 60 * 1000);
};

export const getAppointmentEndDateTime = (booking) => {
  const { startOfDay } = getBusinessDayRange(booking.scheduledDate || booking.date, 'Africa/Cairo');
  const startMinute =
    booking.scheduledStartMinute !== undefined && booking.scheduledStartMinute !== null
      ? booking.scheduledStartMinute
      : timeToMinutes(booking.time || '10:00');
  const endMinute =
    booking.scheduledEndMinute !== undefined && booking.scheduledEndMinute !== null
      ? booking.scheduledEndMinute
      : startMinute + (booking.duration || 60);
  return new Date(startOfDay.getTime() + endMinute * 60 * 1000);
};
