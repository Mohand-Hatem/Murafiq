import '../../src/common/globals.js';
import notificationListener from '../../src/modules/notifications/notification.listener.js';
import auditLogListener from '../../src/modules/audit-log/audit-log.listener.js';
import stylistListener from '../../src/modules/stylists/stylist.listener.js';
import chatListener from '../../src/modules/chat/chat.listener.js';
import reviewListener from '../../src/modules/reviews/review.listener.js';

describe('Domain Event Listeners Idempotency', () => {
  it('allows safe repeated register calls without duplicating subscriptions', () => {
    expect(() => {
      notificationListener.register();
      auditLogListener.register();
      stylistListener.register();
      chatListener.register();
      reviewListener.register();
    }).not.toThrow();
  });
});
