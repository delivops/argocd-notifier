import env from 'env-var';

export const argo_config = {
  group: env.get('K8S_CRD_GROUP').required().asString(),
  version: env.get('K8S_CRD_VERSION').required().asString(),
  namespace: env.get('K8S_NAMESPACE').required().asString(),
} as const;

export const slack_config = {
  TOKEN: env.get('SLACK_TOKEN').required().asString(),
  CHANNEL_ID: env.get('SLACK_CHANNEL_ID').required().asString(),
};

export const app_config = {
  witHealthCheck: env.get('WITH_HEALTH_CHECK').required().asBool(),
  healthCheckPort: env.get('HEALTH_CHECK_PORT').required().asInt(),
};
