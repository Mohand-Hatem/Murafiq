const setReqProp = (req, key, value) => {
  try {
    req[key] = value;
  } catch {
    Object.defineProperty(req, key, {
      value,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  }
};

const validate = (schema) => async (req, res, next) => {
  try {
    if (schema.body) setReqProp(req, 'body', await schema.body.parseAsync(req.body));
    if (schema.query) setReqProp(req, 'query', await schema.query.parseAsync(req.query));
    if (schema.params) setReqProp(req, 'params', await schema.params.parseAsync(req.params));
    return next();
  } catch (err) {
    if (err.errors) {
      const message = err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
      return next(new ApiError(400, `Validation Error: ${message}`));
    }
    return next(new ApiError(400, 'Invalid request parameters'));
  }
};

export default validate;
