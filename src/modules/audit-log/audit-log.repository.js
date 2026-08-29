import AuditLog from './audit-log.model.js';
import QueryBuilder from '../../common/query-builder/QueryBuilder.js';

export const create = async (data) => {
  const [log] = await AuditLog.create([data]);
  return log;
};

export const findLogs = async (queryString = {}) => {
  const baseQuery = AuditLog.find();
  const builder = new QueryBuilder(baseQuery, queryString)
    .filter(['actorId', 'actorRole', 'action', 'targetType', 'targetId'])
    .sort()
    .select();

  await builder.paginate(AuditLog);
  const items = await builder.mongooseQuery.populate('actorId', 'name email role');

  return {
    items,
    meta: builder.meta,
  };
};

export default {
  create,
  findLogs,
};
