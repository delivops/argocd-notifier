import env from 'env-var';

export const argo_config = {
  group: env.get('K8S_CRD_GROUP').required().asString(),
  version: env.get('K8S_CRD_VERSION').required().asString(),
  namespace: env.get('K8S_NAMESPACE').required().asString(),
  url: env.get('ARGO_CD_URL').asString(),
} as const;

export const slack_config = {
  TOKEN: env
    .get('SLACK_BOT_TOKEN')
    .required(process.env.NODE_ENV === 'production')
    .asString(),
  CHANNEL_ID: env.get('SLACK_CHANNEL_ID').required(!!env.get('SLACK_BOT_TOKEN')).asString(),
  // VERSION_CHANGE_CHANNEL_ID: env.get('VERSION_CHANGE_CHANNEL_ID').asString(),
} as const;

export const app_config = {
  contextDiffLinesCount: env.get('CONTEXT_DIFF_LINES_COUNT').default('2').asIntPositive(),
  IGNORE_VERSION_CHANGE: env.get('IGNORE_VERSION_CHANGE').default('false').asBool(),
} as const;

// // === additional validation ===

// if (
//   slack_config.CHANNEL_ID &&
//   slack_config.VERSION_CHANGE_CHANNEL_ID &&
//   slack_config.CHANNEL_ID === slack_config.VERSION_CHANGE_CHANNEL_ID
// ) {
//   throw new Error('SLACK_CHANNEL_ID and VERSION_CHANGE_CHANNEL_ID must be different');
// }
