import { RefinedEventType } from '@/enums/refined-event-type.enum';
import { ResourceEventType } from '@/enums/resource-event-type.enum';
import type { ResourceEvent } from '@/interfaces/resource-event.interface';

export const getRefinedEventType = (event: ResourceEvent): RefinedEventType => {
  if (event.type === ResourceEventType.Deleted) {
    return RefinedEventType.Deleted;
  }

  const isMarkedForDeletion = event.object.metadata?.deletionTimestamp !== undefined;
  const isUpToDate =
    event.object.status?.observedGeneration !== undefined &&
    event.object.status.observedGeneration === event.object.metadata?.generation;

  if (isMarkedForDeletion) {
    return RefinedEventType.Deleting;
  }

  if (isUpToDate) {
    // return RefinedEventType.Sync;
    return RefinedEventType.UpToDate;
  }

  return event.type;
};
