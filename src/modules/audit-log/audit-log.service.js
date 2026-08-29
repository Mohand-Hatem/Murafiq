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
