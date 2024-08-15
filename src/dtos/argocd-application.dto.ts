import { ArgoCdHealthStatus, ArgoCdSyncStatus } from '@/enums/argocd.enum';
import { z } from 'zod';

export const ArgoCdApiVersion = 'argoproj.io/v1alpha1' as const;
export const ArgoCdKind = 'Application' as const;

export const ArgoCdNames = {
  kind: ArgoCdKind,
  kindPlural: 'applications',
} as const;

export const ArgoCdApplicationMetadataSchema = z
  .object({
    labels: z
      .object({
        'argocd.argoproj.io/instance': z.string().min(1).optional(),
      })
      // .passthrough(), // modifies type to Record<string, unknown>
      .optional(),
    name: z.string().min(1),
    namespace: z.string().min(1),
    annotations: z.record(z.string().min(1)).optional(),
    managedFields: z.array(z.object({}).passthrough()).optional(),
  })
  .passthrough();

export const ArgoCdApplicationSpecSourceSchema = z
  .object({
    chart: z.string().min(1).optional(),
    repoURL: z.string().min(1),
    path: z.string().min(1).optional(),
    targetRevision: z.string().min(1),
    helm: z.object({ valuesObject: z.record(z.unknown()).optional() }).optional(),
    directory: z.object({ recurse: z.boolean().optional() }).passthrough().optional(),
  })
  .passthrough();

export const ArgoCdApplicationSpecSchema = z
  .object({
    source: ArgoCdApplicationSpecSourceSchema,
    destination: z.object({ namespace: z.string().min(1) }).passthrough(),
  })
  .passthrough();

export const ArgoCdApplicationStatusSchema = z
  .object({
    health: z.object({ status: z.nativeEnum(ArgoCdHealthStatus) }),
    sync: z.object({
      status: z.nativeEnum(ArgoCdSyncStatus),
      revision: z.string().min(1),
    }),
    reconciledAt: z.string().datetime().optional(),
    resources: z.array(
      z
        .object({
          group: z.string().min(0).optional(),
          kind: z.string().min(1),
          name: z.string().min(1),
          namespace: z.string().min(1).optional(),
        })
        .passthrough(),
    ),
    summary: z
      .object({
        externalURLs: z.array(z.string()),
      })
      .partial()
      .passthrough()
      .optional(),
  })
  .passthrough();

export const ArgoCdApplicationSchema = z.object({
  apiVersion: z.literal(ArgoCdApiVersion),
  kind: z.literal(ArgoCdKind),
  metadata: ArgoCdApplicationMetadataSchema,
  spec: ArgoCdApplicationSpecSchema,
  status: ArgoCdApplicationStatusSchema,
});

export type ArgoCdApplicationDto = z.infer<typeof ArgoCdApplicationSchema>;
