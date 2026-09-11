import auditLogRepository from './audit-log.repository.js';
import logger from '../../config/logger.config.js';

export const recordAction = async ({
  actorId = null,
  actorRole = 'system',
  action,
  targetType,
  targetId,
  metadata = {},
  ip = null,
  // Defaults to the model's own 'info'. Passed through rather than ignored so a caller that
  // marks an action 'warn'/'critical' (e.g. an admin granting paid entitlements for free)
  // actually lands at that severity instead of being silently downgraded.
  severity = undefined,
}) => {
  try {
    return await auditLogRepository.create({
      actorId,
      actorRole,
      action,
      targetType,
      targetId: String(targetId),
      metadata,
      ip,
      ...(severity ? { severity } : {}),
    });
  } catch (err) {
    logger.error(`Failed to write audit log for action ${action}: ${err.message}`);
    return null;
  }
};

export const getAuditLogs = async (queryString) => {
  return auditLogRepository.findLogs(queryString);
};

export default {
  recordAction,
  getAuditLogs,
};
