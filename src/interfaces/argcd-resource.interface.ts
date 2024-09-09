import type { ArgoCdApplicationDto } from '@/dtos/argocd-application.dto';
import type { CustomResource } from './custom-resource.interface';

export type ArgoCdResource = CustomResource<ArgoCdApplicationDto>;
