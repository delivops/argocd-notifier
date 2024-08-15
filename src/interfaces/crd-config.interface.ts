import type { ArgoCdNames } from '@/dtos/argocd-application.dto';
import type { Scope } from '@/enums/scope.enum';
import { ZodObject, ZodRawShape } from 'zod';

export type CrdConfig = {
  names: typeof ArgoCdNames;
  scope: Scope;
  dto: ZodObject<ZodRawShape>;
};
