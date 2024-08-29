export enum ArgoCdHealthStatus {
  Healthy = 'Healthy',
  Progressing = 'Progressing',
  Degraded = 'Degraded',
  Suspended = 'Suspended',
  Missing = 'Missing',
  // N/A is a custom status to handle the case when the status is not one of the above
  N_A = 'N/A',
}

export enum ArgoCdSyncStatus {
  Synced = 'Synced',
  OutOfSync = 'OutOfSync',
  Unknown = 'Unknown',
  // N/A is a custom status to handle the case when the status is not one of the above
  N_A = 'N/A',
}
