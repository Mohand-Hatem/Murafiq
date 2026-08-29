import '../../src/common/globals.js';
import { jest } from '@jest/globals';
import auditLogService from '../../src/modules/audit-log/audit-log.service.js';
import auditLogRepository from '../../src/modules/audit-log/audit-log.repository.js';

describe('Audit Log Service', () => {
  it('records an audit action document', async () => {
    const mockCreated = { _id: 'log1', action: 'verification.approved' };
    jest.spyOn(auditLogRepository, 'create').mockResolvedValue(mockCreated);

    const log = await auditLogService.recordAction({
      actorId: 'admin1',
      actorRole: 'admin',
      action: 'verification.approved',
      targetType: 'User',
      targetId: 'user1',
    });

    expect(log).toEqual(mockCreated);
  });
});
