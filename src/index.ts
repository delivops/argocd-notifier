import { HealthCheckServer } from './http-server';
import { logger } from './logger';
import { operatorResources } from './operator-resources';
import { VopsOperator } from './vops-operator';

const operator = new VopsOperator(operatorResources, logger);
void operator.start();

HealthCheckServer.start();

const exit = async (signal: string) => {
  logger.info(`Exiting: received ${signal}`);
  operator.stop();
  await HealthCheckServer.stop();
  process.exit(0);
};

process.on('SIGTERM', exit).on('SIGINT', exit);
