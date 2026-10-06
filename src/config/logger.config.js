import winston from 'winston';
import path from 'path';
import { fileURLToPath } from 'url';
import env from './env.config.js';
import { getRequestId } from '../common/utils/request-context.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const correlationFormat = winston.format((info) => {
  const requestId = getRequestId();
  if (requestId) {
    info.requestId = requestId;
  }
  return info;
});

export const safeSerializeMeta = (meta) => {
  if (!meta || typeof meta !== 'object') return '';
  try {
    const clean = {};
    const seen = new WeakSet();

    const sanitize = (val) => {
      if (val === undefined) return undefined;
      if (typeof val === 'bigint') return val.toString();
      if (Buffer.isBuffer(val)) return `[Buffer ${val.length} bytes]`;
      if (val instanceof Error) {
        return { name: val.name, message: val.message };
      }
      if (typeof val === 'object' && val !== null) {
        if (seen.has(val)) return '[Circular]';
        seen.add(val);
        const res = Array.isArray(val) ? [] : {};
        for (const k of Reflect.ownKeys(val)) {
          if (typeof k === 'string') {
            try {
              res[k] = sanitize(val[k]);
            } catch {
              res[k] = '[Unreadable]';
            }
          }
        }
        return res;
      }
      return val;
    };

    for (const k of Reflect.ownKeys(meta)) {
      if (
        typeof k !== 'string' ||
        k === 'splat' ||
        k === 'requestId' ||
        k === 'message' ||
        k === 'level' ||
        k === 'timestamp' ||
        k === 'stack'
      ) {
        continue;
      }
      try {
        const sanitized = sanitize(meta[k]);
        if (sanitized !== undefined) {
          clean[k] = sanitized;
        }
      } catch {
        clean[k] = '[Unreadable]';
      }
    }

    if (Object.keys(clean).length === 0) return '';
    return ' ' + JSON.stringify(clean);
  } catch {
    return ' [SerializationError]';
  }
};

const logFormat = winston.format.combine(
  correlationFormat(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack, requestId, ...meta }) => {
    const prefix = requestId ? ` [${requestId}]` : '';
    const metaStr = safeSerializeMeta(meta);
    return `[${timestamp}]${prefix} ${level.toUpperCase()}: ${stack || message}${metaStr}`;
  })
);

export const logger = winston.createLogger({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: logFormat,
  transports: [
    new winston.transports.File({
      filename: path.join(__dirname, '../../logs/error.log'),
      level: 'error',
    }),
    new winston.transports.File({
      filename: path.join(__dirname, '../../logs/combined.log'),
    }),
  ],
});

if (env.NODE_ENV === 'production') {
  logger.add(
    new winston.transports.Console({
      format: winston.format.combine(
        correlationFormat(),
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
    })
  );
} else if (env.NODE_ENV !== 'test') {
  logger.add(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    })
  );
}

// Morgan stream for HTTP logging
export const stream = {
  write: (message) => {
    logger.info(message.trim());
  },
};

export default logger;
