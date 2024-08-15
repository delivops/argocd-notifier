// import { CoreV1Api, KubeConfig, Watch } from '@kubernetes/client-node';
// import { WebClient } from '@slack/web-api';

// const kubeConfig = new KubeConfig();
// kubeConfig.loadFromDefault();

// const k8sApi = kubeConfig.makeApiClient(CoreV1Api);
// const watch = new Watch(kubeConfig);

// const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);
// let previousStatuses: Record<string, string> = {};

// watch.watch(
//   '/apis/argoproj.io/v1alpha1/namespaces/<namespace>/applications',
//   {},
//   (type, obj) => {
//     if (type === 'MODIFIED') {
//       handleAppStatusChange(obj);
//     }
//   },
//   (err) => {
//     console.error(err);
//   },
// );

// function handleAppStatusChange(app: any) {
//   const appName = app.metadata.name;
//   const newStatus = app.status.health.status;

//   if (previousStatuses[appName] !== newStatus) {
//     sendSlackNotification(appName, newStatus);
//     previousStatuses[appName] = newStatus;
//   }
// }

// async function sendSlackNotification(appName: string, status: string) {
//   const channel = process.env.SLACK_CHANNEL_ID;

//   if (!channel) {
//     console.error('SLACK_CHANNEL_ID not set');
//     return;
//   }

//   const message = `ArgoCD Application *${appName}* changed status to *${status}*`;

//   try {
//     await slackClient.chat.postMessage({
//       channel: channel,
//       text: message,
//     });
//   } catch (error) {
//     console.error('Error sending Slack notification:', error);
//   }
// }
