import * as z from 'zod/mini';

/*
 * Zod schemas and TypeScript types for Knative resources.
 * All exported types are derived from the corresponding Zod schemas.
 */

const ObjectMetaSchema = z.object({
  name: z.string(),
  namespace: z.optional(z.string()),
  uid: z.optional(z.string()),
  labels: z.optional(z.record(z.string(), z.string())),
  annotations: z.optional(z.record(z.string(), z.string())),
  creationTimestamp: z.optional(z.string()),
});

export type ObjectMeta = z.infer<typeof ObjectMetaSchema>;

const ConditionSchema = z.object({
  type: z.string(),
  // Knative uses "True" | "False" | "Unknown", but allow any string for forward compatibility.
  status: z.string(),
  reason: z.optional(z.string()),
  message: z.optional(z.string()),
  lastTransitionTime: z.optional(z.string()),
});

export type Condition = z.infer<typeof ConditionSchema>;

export const TrafficTargetSchema = z.object({
  percent: z.optional(z.number()),
  tag: z.optional(z.string()),
  latestRevision: z.optional(z.boolean()),
  revisionName: z.optional(z.string()),
});

export type TrafficTarget = z.infer<typeof TrafficTargetSchema>;

const KnativeServiceTemplateMetadataSchema = z.object({
  annotations: z.optional(z.record(z.string(), z.string())),
  labels: z.optional(z.record(z.string(), z.string())),
});

const KnativeServiceTemplateSchema = z.object({
  metadata: z.optional(KnativeServiceTemplateMetadataSchema),
  spec: z.optional(z.record(z.string(), z.unknown())),
});

const KnativeServiceSpecSchema = z.object({
  traffic: z.optional(z.array(TrafficTargetSchema)),
  template: z.optional(KnativeServiceTemplateSchema),
});

export type KnativeServiceSpec = z.infer<typeof KnativeServiceSpecSchema>;

const KnativeServiceTrafficStatusEntrySchema = z.object({
  percent: z.optional(z.number()),
  tag: z.optional(z.string()),
  latestRevision: z.optional(z.boolean()),
  revisionName: z.optional(z.string()),
  url: z.optional(z.string()),
});

const KnativeServiceStatusSchema = z.object({
  url: z.optional(z.string()),
  address: z.optional(
    z.object({
      url: z.optional(z.string()),
    })
  ),
  latestCreatedRevisionName: z.optional(z.string()),
  latestReadyRevisionName: z.optional(z.string()),
  conditions: z.optional(z.array(ConditionSchema)),
  traffic: z.optional(z.array(KnativeServiceTrafficStatusEntrySchema)),
});

export type KnativeServiceStatus = z.infer<typeof KnativeServiceStatusSchema>;

export const KnativeServiceSchema = z.object({
  apiVersion: z.literal('serving.knative.dev/v1'),
  kind: z.literal('Service'),
  metadata: ObjectMetaSchema,
  spec: KnativeServiceSpecSchema,
  status: z.optional(KnativeServiceStatusSchema),
});

export type KnativeService = z.infer<typeof KnativeServiceSchema>;

export const KnativeRevisionSchema = z.object({
  apiVersion: z.literal('serving.knative.dev/v1'),
  kind: z.literal('Revision'),
  metadata: ObjectMetaSchema,
  spec: z.optional(z.record(z.string(), z.unknown())),
  status: z.optional(
    z.object({
      conditions: z.optional(z.array(ConditionSchema)),
    })
  ),
});

export type KnativeRevision = z.infer<typeof KnativeRevisionSchema>;

/*
 * Generic K8s list type.
 * The base schema validates the envelope; item typing is added via a generic TypeScript helper.
 */
export const K8sListSchema = z.object({
  apiVersion: z.string(),
  kind: z.string(),
  items: z.array(z.unknown()),
});

type K8sListBase = z.infer<typeof K8sListSchema>;

export type K8sList<T> = Omit<K8sListBase, 'items'> & {
  items: T[];
};

/*
 * DomainMapping (serving.knative.dev/v1beta1).
 */
export const DomainMappingSchema = z.object({
  apiVersion: z.literal('serving.knative.dev/v1beta1'),
  kind: z.literal('DomainMapping'),
  metadata: ObjectMetaSchema,
  spec: z.object({
    ref: z.object({
      apiVersion: z.optional(z.string()),
      kind: z.literal('Service'),
      name: z.string(),
      namespace: z.optional(z.string()),
    }),
  }),
  status: z.optional(
    z.object({
      url: z.optional(z.string()),
      address: z.optional(
        z.object({
          url: z.optional(z.string()),
        })
      ),
      conditions: z.optional(z.array(ConditionSchema)),
    })
  ),
});

export type DomainMapping = z.infer<typeof DomainMappingSchema>;

/*
 * ClusterDomainClaim (networking.internal.knative.dev/v1alpha1).
 * Cluster-scoped resource that reserves a domain for a specific namespace.
 */
export const ClusterDomainClaimSchema = z.object({
  apiVersion: z.literal('networking.internal.knative.dev/v1alpha1'),
  kind: z.literal('ClusterDomainClaim'),
  metadata: ObjectMetaSchema,
  spec: z.object({
    namespace: z.string(),
  }),
  status: z.optional(z.record(z.string(), z.unknown())),
});

export type ClusterDomainClaim = z.infer<typeof ClusterDomainClaimSchema>;
