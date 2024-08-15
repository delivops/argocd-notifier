import { logger } from '@/logger';
import { operatorResources } from './operator-resources';
import { VopsOperator } from './vops-operator';

const operator = new VopsOperator(operatorResources, logger);
void operator.start();

const exit = (reason: string) => {
  logger.info(`Exiting: ${reason}`);
  operator.stop();
  process.exit(0);
};

process.on('SIGTERM', () => exit('SIGTERM')).on('SIGINT', () => exit('SIGINT'));
