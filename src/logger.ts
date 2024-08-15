import { inspect, InspectOptions } from 'node:util';
import { createLogger, format, transports } from 'winston';

const LOG_LEVEL = process.env.LOG_LEVEL || 'debug';

const LOG_FORMAT = process.env.LOG_FORMAT || 'simple'; // Options: 'simple', 'json'

const customLogFormat = format.combine(
  format.errors({ stack: true }),
  format((info) => {
    info.level = info.level.slice(0, 1).toUpperCase();
    return info;
  })(),
  format.colorize(),
  format.timestamp({ format: 'HH:mm:ss.SSS' }),
  format.printf(({ level, message, timestamp }) => `${timestamp} [${level}]: ${message}`),
);

const baseLogger = createLogger({
  level: LOG_LEVEL,
  format: LOG_FORMAT === 'json' ? format.json() : customLogFormat,
  transports: [new transports.Console()],
});

const logger = Object.assign(baseLogger, {
  dir(obj: unknown, options: Partial<InspectOptions> = { colors: true, depth: 2 }) {
    baseLogger.debug(inspect(obj, { ...{ colors: LOG_FORMAT === 'json' ? false : true, depth: 2 }, ...options }));
  },
});

export { logger };
