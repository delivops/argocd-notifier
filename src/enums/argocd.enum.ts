export enum ArgoCdHealthStatus {
  Healthy = 'Healthy',
  Progressing = 'Progressing',
  Degraded = 'Degraded',
  Suspended = 'Suspended',
  Missing = 'Missing',
}

export enum ArgoCdSyncStatus {
  Synced = 'Synced',
  OutOfSync = 'OutOfSync',
}
