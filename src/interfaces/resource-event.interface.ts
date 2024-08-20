import type { ResourceEventType } from '@/enums/resource-event-type.enum';
import { CustomResource } from './custom-resource.interface';

export type ResourceEvent = { type: ResourceEventType; object: CustomResource };
