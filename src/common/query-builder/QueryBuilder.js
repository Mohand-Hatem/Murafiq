const MONGO_OPERATORS = new Set(['gte', 'gt', 'lte', 'lt', 'ne', 'in']);

// Every field marked `select: false` anywhere in the project's schemas (hashed
// credentials and OTP secrets). QueryBuilder is a generic, shared utility with no
// per-caller allowlist for `?fields=`/`?sort=`, so `.select()` and `.sort()` strip these
// names project-wide rather than trusting each of the ~15 call sites to remember to.
// Mongoose's `select: false` is a DEFAULT projection only -- naming a field explicitly
// (`.select('passwordHash')`) or sorting by it OVERRIDES that default, so a caller-
// controlled `?fields=passwordHash` or `?sort=passwordHash` previously bypassed it
// outright. Currently latent everywhere it matters (every reader maps through an
// allowlist DTO before the client sees it), but it is one `return doc` away from a live
// leak. See docs/archive/audits/AUDIT_2026_09_FULL_SYSTEM.md finding X23.
const SENSITIVE_FIELD_DENYLIST = new Set([
  'passwordHash',
  'otpCode',
  'otpExpiresAt',
  'otpAttempts',
  'sessions',
]);

const stripSensitiveFieldTokens = (fieldString) =>
  fieldString
    .split(/[\s,]+/)
    .filter(Boolean)
    .filter((token) => !SENSITIVE_FIELD_DENYLIST.has(token.replace(/^[+-]/, '')))
    .join(' ');

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
    const sortBy = stripSensitiveFieldTokens(this.queryString.sort.split(',').join(' '));
    this.mongooseQuery = sortBy
      ? this.mongooseQuery.sort(sortBy)
      : this.mongooseQuery.sort('-createdAt');
  } else {
    this.mongooseQuery = this.mongooseQuery.sort('-createdAt');
  }
  return this;
};

QueryBuilder.prototype.select = function () {
  if (this.queryString.fields) {
    // The `+` prefix (Mongoose's own "include this select:false field" syntax) is
    // stripped BEFORE the denylist check, not after -- `?fields=+passwordHash` must be
    // caught exactly like `?fields=passwordHash`.
    const fields = stripSensitiveFieldTokens(this.queryString.fields.replace(/\+/g, '').split(',').join(' '));
    this.mongooseQuery = fields
      ? this.mongooseQuery.select(fields)
      : this.mongooseQuery.select('-__v');
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
