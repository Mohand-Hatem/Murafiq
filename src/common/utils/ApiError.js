function ApiError(statusCode, message, isOperational = true, stack = '') {
  const error = new Error(message);
  Object.setPrototypeOf(error, ApiError.prototype);
  error.statusCode = statusCode;
  error.isOperational = isOperational;
  if (stack) {
    error.stack = stack;
  } else {
    Error.captureStackTrace(error, ApiError);
  }
  return error;
}

Object.setPrototypeOf(ApiError.prototype, Error.prototype);

export default ApiError;
