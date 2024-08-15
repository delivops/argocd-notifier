import { OperatorMode } from '@/enums/operator-scope.enum';
import env from 'env-var';

export const config = {
  group: env.get('K8S_CRD_GROUP').required().asString(),
  version: env.get('K8S_CRD_VERSION').required().asString(),
  finalizer: env.get('K8S_FINALIZER_NAME').required().asString(),
  namespace: env.get('K8S_NAMESPACE').required().asString(),
  operatorMode: env.get('OPERATOR_MODE').required().asString() as OperatorMode,
} as const;

const validateConfig = () => {
  if (!(config.operatorMode in OperatorMode)) {
    throw new Error(`OPERATOR_MODE must be one of [${Object.keys(OperatorMode).join(', ')}]`);
  }
};

validateConfig();
