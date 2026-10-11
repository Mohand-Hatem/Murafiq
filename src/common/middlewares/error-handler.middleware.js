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
  } else if (process.env.NODE_ENV === 'production') {
    if (statusCode >= 500) {
      if (statusCode === 504) {
        message = 'AI service request timed out. Please try again.';
      } else if (statusCode === 502 || statusCode === 503) {
        message = 'AI service is temporarily unavailable. Please try again shortly.';
      } else {
        message = 'Internal Server Error';
      }
    } else if (typeof message === 'string') {
      message = message
        .replace(/[a-zA-Z]:\\[^\s:;,]+/g, '[path]')
        .replace(/(\/(?:home|app|usr|var|node_modules|src)\/[^\s:;,]+)/g, '[path]');
    }
  }

  const response = {
    success: false,
    message: message || 'Internal Server Error',
    data: null,
    meta: null,
  };

  if (process.env.NODE_ENV !== 'test' || statusCode >= 500) {
    logger.error(`[${statusCode}] ${err.message || message} - Path: ${req.originalUrl}`, {
      stack: err.stack,
      requestId: req.id,
    });
  }

  if (process.env.NODE_ENV === 'development') {
    response.meta = { error: err.toString(), stack: err.stack, requestId: req.id };
  } else if (req.id) {
    response.meta = { requestId: req.id };
  }

  res.status(statusCode).json(response);
};

export default errorHandlerMiddleware;
