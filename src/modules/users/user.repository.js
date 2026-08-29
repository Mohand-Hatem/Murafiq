import User from './user.model.js';
import QueryBuilder from '../../common/query-builder/QueryBuilder.js';

export const findById = async (id) => {
  return User.findById(id);
};

export const updateById = async (id, updateData) => {
  return User.findByIdAndUpdate(id, updateData, { new: true, runValidators: true });
};

export const softDelete = async (id) => {
  return User.findByIdAndUpdate(
    id,
    {
      isDeleted: true,
      accountStatus: 'deleted',
      deletedAt: new Date(),
    },
    { new: true }
  );
};

export const findVerifications = async (queryString = {}) => {
  const queryObj = { ...queryString };
  if (queryObj.status) {
    queryObj['verification.status'] = queryObj.status;
    delete queryObj.status;
  }

  const baseQuery = User.find();
  const builder = new QueryBuilder(baseQuery, queryObj)
    .filter(['role', 'verification.status', 'accountStatus', 'isEmailVerified'])
    .search(['name', 'email', 'phone'])
    .sort()
    .select();

  await builder.paginate(User);
  const users = await builder.mongooseQuery;

  return {
    users,
    meta: builder.meta,
  };
};

export const findAllUsers = async (queryString = {}) => {
  const baseQuery = User.find();
  const builder = new QueryBuilder(baseQuery, queryString)
    .filter(['role', 'verification.status', 'accountStatus', 'isEmailVerified'])
    .search(['name', 'email', 'phone'])
    .sort()
    .select();

  await builder.paginate(User);
  const users = await builder.mongooseQuery;

  return {
    users,
    meta: builder.meta,
  };
};

export const getUserStats = async () => {
  const [total, clients, stylists, operators, admins, pendingVerifications] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ role: 'client' }),
    User.countDocuments({ role: 'stylist' }),
    User.countDocuments({ role: 'operator' }),
    User.countDocuments({ role: 'admin' }),
    User.countDocuments({ 'verification.status': 'pending' }),
  ]);

  return {
    total,
    byRole: {
      clients,
      stylists,
      operators,
      admins,
    },
    pendingVerifications,
  };
};

export default {
  findById,
  updateById,
  softDelete,
  findVerifications,
  findAllUsers,
  getUserStats,
};

