import env from 'env-var';

export const argo_config = {
  group: env.get('K8S_CRD_GROUP').required().asString(),
  version: env.get('K8S_CRD_VERSION').required().asString(),
  namespace: env.get('K8S_NAMESPACE').required().asString(),
} as const;
