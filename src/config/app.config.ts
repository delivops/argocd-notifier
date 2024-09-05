import env from 'env-var';

export const argo_config = {
  group: env.get('K8S_CRD_GROUP').required().asString(),
  version: env.get('K8S_CRD_VERSION').required().asString(),
  namespace: env.get('K8S_NAMESPACE').required().asString(),
  url: env.get('ARGO_CD_URL').asString(),
} as const;

export const slack_config = {
  TOKEN: env
    .get('SLACK_TOKEN')
    .required(process.env.NODE_ENV === 'production')
    .asString(),
  CHANNEL_ID: env.get('SLACK_CHANNEL_ID').required(!!env.get('SLACK_TOKEN')).asString(),
} as const;

export const app_config = {
  contextDiffLinesCount: env.get('CONTEXT_DIFF_LINES_COUNT').default('2').asIntPositive(),
} as const;
