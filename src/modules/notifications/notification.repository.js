import Notification from './notification.model.js';
import QueryBuilder from '../../common/query-builder/QueryBuilder.js';

export const create = async (data) => {
  const [notification] = await Notification.create([data]);
  return notification;
};

export const findById = async (id) => {
  return Notification.findById(id);
};

export const findUserNotifications = async (userId, queryString = {}) => {
  const queryObj = { ...queryString, userId };
  const baseQuery = Notification.find();

  const builder = new QueryBuilder(baseQuery, queryObj)
    .filter(['isRead', 'type', 'userId'])
    .sort()
    .select();

  await builder.paginate(Notification);
  const items = await builder.mongooseQuery;

  return {
    items,
    meta: builder.meta,
  };
};

export const markAsRead = async (userId, notificationId) => {
  return Notification.findOneAndUpdate(
    { _id: notificationId, userId },
    { isRead: true },
    { new: true }
  );
};

export const markAllAsRead = async (userId) => {
  return Notification.updateMany(
    { userId, isRead: false },
    { isRead: true }
  );
};

export const countUnread = async (userId) => {
  return Notification.countDocuments({ userId, isRead: false });
};

export const deleteById = async (userId, notificationId) => {
  return Notification.findOneAndDelete({ _id: notificationId, userId });
};

export default {
  create,
  findById,
  findUserNotifications,
  markAsRead,
  markAllAsRead,
  countUnread,
  deleteById,
};
