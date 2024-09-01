import { HealthCheckServer } from '@/http-server/http-server';
import { Operator } from '@/operator/operator';
import { logger } from '@/utils/logger';
import { argocdResource } from './argocd-resource';

const argocdOperator = new Operator(argocdResource, logger);
void argocdOperator.start();

HealthCheckServer.start();

const exit = async (signal: string) => {
  logger.info(`Exiting: received ${signal}`);
  argocdOperator.stop();
  await HealthCheckServer.stop();
  process.exit(0);
};

process.on('SIGTERM', exit).on('SIGINT', exit);
