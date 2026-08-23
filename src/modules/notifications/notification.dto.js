export const toNotificationDto = (doc) => {
  if (!doc) return null;
  return {
    id: doc._id || doc.id,
    type: doc.type,
    title: doc.title,
    body: doc.body,
    relatedEntityId: doc.relatedEntityId || null,
    isRead: Boolean(doc.isRead),
    createdAt: doc.createdAt,
  };
};

export default {
  toNotificationDto,
};
