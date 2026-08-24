const MONGO_OPERATORS = new Set(['gte', 'gt', 'lte', 'lt', 'ne', 'in']);

export function escapeRegex(string) {
  if (typeof string !== 'string') return '';
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function convertOperators(value) {
  if (Array.isArray(value)) return value.map(convertOperators);
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).reduce((acc, [key, val]) => {
      const newKey = MONGO_OPERATORS.has(key) ? `$${key}` : key;
      acc[newKey] = convertOperators(val);
      return acc;
    }, {});
  }
  return value;
}

function buildFilter(queryString, allowedFields = null) {
  const queryObj = { ...queryString };
  const excludedFields = ['page', 'sort', 'limit', 'fields', 'search'];
  excludedFields.forEach((el) => delete queryObj[el]);

  // Strip unpermitted filter fields (e.g. passwordHash, otpCode)
  if (allowedFields && Array.isArray(allowedFields)) {
    const allowedSet = new Set(allowedFields);
    Object.keys(queryObj).forEach((key) => {
      if (!allowedSet.has(key)) {
        delete queryObj[key];
      }
    });
  }

  return convertOperators(queryObj);
}

function QueryBuilder(mongooseQuery, queryString) {
  if (!(this instanceof QueryBuilder)) {
    return new QueryBuilder(mongooseQuery, queryString);
  }
  this.mongooseQuery = mongooseQuery;
  this.queryString = queryString || {};
  this.allowedFilterFields = null;
  this.searchFilter = {};
  this.meta = {};
}

QueryBuilder.prototype.filter = function (allowedFields = null) {
  this.allowedFilterFields = allowedFields;
  this.mongooseQuery = this.mongooseQuery.find(buildFilter(this.queryString, allowedFields));
  return this;
};

// Case-insensitive substring match across the given fields with regex escaping
QueryBuilder.prototype.search = function (fields = []) {
  if (this.queryString.search && fields.length) {
    const escaped = escapeRegex(this.queryString.search);
    const regex = new RegExp(escaped, 'i');
    this.searchFilter = { $or: fields.map((field) => ({ [field]: regex })) };
    this.mongooseQuery = this.mongooseQuery.find(this.searchFilter);
  }
  return this;
};

QueryBuilder.prototype.sort = function () {
  if (this.queryString.sort) {
    const sortBy = this.queryString.sort.split(',').join(' ');
    this.mongooseQuery = this.mongooseQuery.sort(sortBy);
  } else {
    this.mongooseQuery = this.mongooseQuery.sort('-createdAt');
  }
  return this;
};

QueryBuilder.prototype.select = function () {
  if (this.queryString.fields) {
    const fields = this.queryString.fields.replace(/\+/g, '').split(',').join(' ');
    this.mongooseQuery = this.mongooseQuery.select(fields);
  } else {
    this.mongooseQuery = this.mongooseQuery.select('-__v');
  }
  return this;
};

QueryBuilder.prototype.paginate = async function (model, customFilter = {}) {
  const page = Math.max(1, parseInt(this.queryString.page, 10) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(this.queryString.limit, 10) || 10));
  const skip = (page - 1) * limit;

  this.mongooseQuery = this.mongooseQuery.skip(skip).limit(limit);

  const finalFilter = {
    ...buildFilter(this.queryString, this.allowedFilterFields),
    ...this.searchFilter,
    ...customFilter,
  };
  const total = model ? await model.countDocuments(finalFilter) : 0;
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 1;

  this.meta = {
    page,
    limit,
    total,
    totalPages,
  };

  return this;
};

export default QueryBuilder;
