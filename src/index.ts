import { app_config } from './config/app.config';
import { HealthCheckServer } from './http-server';
import { logger } from './logger';
import { operatorResources } from './operator-resources';
import { VopsOperator } from './vops-operator';

const operator = new VopsOperator(operatorResources, logger);
void operator.start();

if (app_config.healthCheckPort) {
  HealthCheckServer.start();
}

const exit = async (signal: string) => {
  logger.info(`Exiting: received ${signal}`);
  operator.stop();
  await HealthCheckServer.stop(); // Ensure HealthCheckServer stops completely
  process.exit(0);
};

process.on('SIGTERM', exit).on('SIGINT', exit);
