import winston from 'winston';
import { config } from '../config';
import { getRequestContext } from './requestContext';

const { combine, timestamp, printf, colorize, errors } = winston.format;

// Custom log format
const logFormat = printf(({ level, message, timestamp, ...metadata }) => {
  const ctx = getRequestContext();
  const ctxMeta = ctx ? { requestId: ctx.requestId } : {};
  const mergedMeta = { ...ctxMeta, ...metadata };

  let msg = `${timestamp} [${level}]: ${message}`;

  const metaKeys = Object.keys(mergedMeta);
  if (metaKeys.length > 0) {
    msg += ` ${JSON.stringify(mergedMeta)}`;
  }

  return msg;
});

// Create logger instance
const logger = winston.createLogger({
  level: config.logLevel,
  format: combine(
    errors({ stack: true }),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    logFormat
  ),
  transports: [
    new winston.transports.Console({
      format: combine(
        colorize(),
        logFormat
      ),
    }),
  ],
});

// Add file transport in production
if (config.env === 'production') {
  logger.add(
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
    })
  );
  logger.add(
    new winston.transports.File({
      filename: 'logs/combined.log',
    })
  );
}

export default logger;
