import { logger } from '../../config/logger.config.js';

// eslint-disable-next-line no-unused-vars
const errorHandlerMiddleware = (err, req, res, next) => {
  let { statusCode, message } = err;
  if (!statusCode) statusCode = 500;

  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = err.message;
  } else if (err.name === 'CastError') {
    statusCode = 400;
    message = `Invalid ${err.path}: ${err.value}`;
  } else if (err.code === 11000) {
    statusCode = 409;
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    message = `Duplicate value for ${field}`;
  } else if (!(err instanceof ApiError) && process.env.NODE_ENV === 'production') {
    message = 'Internal Server Error';
  }

  const response = {
    success: false,
    message: message || 'Internal Server Error',
    data: null,
    meta: null,
  };

  if (process.env.NODE_ENV !== 'test' || statusCode >= 500) {
    logger.error(`[${statusCode}] ${message} - Path: ${req.originalUrl}`, { stack: err.stack });
  }

  if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
    response.meta = { error: err.toString(), stack: err.stack };
  }

  res.status(statusCode).json(response);
};

export default errorHandlerMiddleware;
