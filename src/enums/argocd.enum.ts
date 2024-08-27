export enum ArgoCdHealthStatus {
  Healthy = 'Healthy',
  Progressing = 'Progressing',
  Degraded = 'Degraded',
  Suspended = 'Suspended',
  Missing = 'Missing',
  // Unknown is a custom status to handle the case when the status is not one of the above
  Unknown = 'Unknown',
}

export enum ArgoCdSyncStatus {
  Synced = 'Synced',
  OutOfSync = 'OutOfSync',
  // Unknown is a custom status to handle the case when the status is not one of the above
  Unknown = 'Unknown',
}
