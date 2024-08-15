import type { ResourceEventType } from '@/enums/resource-event-type.enum';
import { MyCustomResource } from './my-custom-resource.interface';

export type MyResourceEvent = { type: ResourceEventType; object: MyCustomResource };
