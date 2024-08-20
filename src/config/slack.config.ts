import env from 'env-var';

const slack_config = {
  TOKEN: env.get('SLACK_TOKEN').required().asString(),
  CHANNEL_ID: env.get('SLACK_CHANNEL_ID').required().asString(),
};

export { slack_config };
