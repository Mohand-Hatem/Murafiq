function QueryBuilder(mongooseQuery, queryString) {
  if (!(this instanceof QueryBuilder)) {
    return new QueryBuilder(mongooseQuery, queryString);
  }
  this.mongooseQuery = mongooseQuery;
  this.queryString = queryString || {};
  this.meta = {};
}

QueryBuilder.prototype.filter = function () {
  const queryObj = { ...this.queryString };
  const excludedFields = ['page', 'sort', 'limit', 'fields'];
  excludedFields.forEach((el) => delete queryObj[el]);

  let queryStr = JSON.stringify(queryObj);
  queryStr = queryStr.replace(/\b(gte|gt|lte|lt|ne|in)\b/g, (match) => `$${match}`);

  this.mongooseQuery = this.mongooseQuery.find(JSON.parse(queryStr));
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
    const fields = this.queryString.fields.split(',').join(' ');
    this.mongooseQuery = this.mongooseQuery.select(fields);
  } else {
    this.mongooseQuery = this.mongooseQuery.select('-__v');
  }
  return this;
};

QueryBuilder.prototype.paginate = async function (model, customFilter = {}) {
  const page = Math.max(1, parseInt(this.queryString.page, 10) || 1);
  const limit = Math.max(1, parseInt(this.queryString.limit, 10) || 10);
  const skip = (page - 1) * limit;

  this.mongooseQuery = this.mongooseQuery.skip(skip).limit(limit);

  const queryObj = { ...this.queryString };
  const excludedFields = ['page', 'sort', 'limit', 'fields'];
  excludedFields.forEach((el) => delete queryObj[el]);
  let queryStr = JSON.stringify(queryObj);
  queryStr = queryStr.replace(/\b(gte|gt|lte|lt|ne|in)\b/g, (match) => `$${match}`);
  const finalFilter = { ...JSON.parse(queryStr), ...customFilter };

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
