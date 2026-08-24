import auditLogService from './audit-log.service.js';

export const getAuditLogs = asyncHandler(async (req, res) => {
  const { items, meta } = await auditLogService.getAuditLogs(req.query);
  return ApiResponse.success(res, {
    data: items,
    meta,
  });
});

export default {
  getAuditLogs,
};
