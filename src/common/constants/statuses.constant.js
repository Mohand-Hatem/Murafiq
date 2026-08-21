export const ACCOUNT_STATUS = {
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  DELETED: 'deleted',
};

export const BOOKING_STATUS = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  IN_PROGRESS: 'in-progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  DISPUTED: 'disputed',
};

export const PAYMENT_STATUS = {
  PENDING: 'pending',
  PAID: 'paid',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded',
};

export const CANCELLATION_POLICY = {
  FULL_REFUND_HOURS: 24,
  PARTIAL_REFUND_PERCENTAGE: 75,
  PARTIAL_PLATFORM_FEE_PERCENTAGE: 25,
};

export default { ACCOUNT_STATUS, BOOKING_STATUS, PAYMENT_STATUS, CANCELLATION_POLICY };
