import { ResourceEventType } from './resource-event-type.enum';

export const RefinedEventType = {
  ...ResourceEventType,
  Deleting: 'DELETING',
  UpToDate: 'UP_TO_DATE',
} as const;

export type RefinedEventType = (typeof RefinedEventType)[keyof typeof RefinedEventType];
