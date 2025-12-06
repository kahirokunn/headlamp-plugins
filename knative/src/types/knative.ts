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

const ConditionSchema = z.object({
  type: z.string(),
  // Knative uses "True" | "False" | "Unknown", but allow any string for forward compatibility.
  status: z.string(),
  reason: z.optional(z.string()),
  message: z.optional(z.string()),
  lastTransitionTime: z.optional(z.string()),
});

export type Condition = z.infer<typeof ConditionSchema>;

const TrafficTargetSchema = z.object({
  // Spec fields (spec.traffic) – URL is disallowed in spec but allowed in status.
  configurationName: z.optional(z.string()),
  latestRevision: z.optional(z.boolean()),
  percent: z.optional(z.number()),
  revisionName: z.optional(z.string()),
  tag: z.optional(z.string()),
  // Status-only fields (status.traffic)
  url: z.optional(z.string()),
});

export type TrafficTarget = z.infer<typeof TrafficTargetSchema>;

/*
 * Template / Revision spec
 * Based on the Knative Service CRD (openAPIV3Schema.spec.template.spec).
 * We model the fields this plugin needs precisely and keep the rest as loose objects.
 */

const EnvVarSourceSecretKeyRefSchema = z.object({
  name: z.optional(z.string()),
  key: z.string(),
  optional: z.optional(z.boolean()),
});

const EnvVarSourceConfigMapKeyRefSchema = z.object({
  name: z.optional(z.string()),
  key: z.string(),
  optional: z.optional(z.boolean()),
});

const EnvVarSourceFieldRefSchema = z.object({
  apiVersion: z.optional(z.string()),
  fieldPath: z.string(),
});

const EnvVarSourceResourceFieldRefSchema = z.object({
  containerName: z.optional(z.string()),
  divisor: z.optional(z.union([z.string(), z.number()])),
  resource: z.string(),
});

const EnvVarSourceSchema = z.object({
  configMapKeyRef: z.optional(EnvVarSourceConfigMapKeyRefSchema),
  fieldRef: z.optional(EnvVarSourceFieldRefSchema),
  resourceFieldRef: z.optional(EnvVarSourceResourceFieldRefSchema),
  secretKeyRef: z.optional(EnvVarSourceSecretKeyRefSchema),
});

const EnvVarSchema = z.object({
  name: z.string(),
  value: z.optional(z.string()),
  valueFrom: z.optional(EnvVarSourceSchema),
});

const EnvFromConfigMapRefSchema = z.object({
  name: z.optional(z.string()),
  optional: z.optional(z.boolean()),
});

const EnvFromSecretRefSchema = z.object({
  name: z.optional(z.string()),
  optional: z.optional(z.boolean()),
});

const EnvFromSourceSchema = z.object({
  configMapRef: z.optional(EnvFromConfigMapRefSchema),
  secretRef: z.optional(EnvFromSecretRefSchema),
  prefix: z.optional(z.string()),
});

const ContainerPortSchema = z.object({
  containerPort: z.number(),
  name: z.optional(z.string()),
  protocol: z.optional(z.string()),
});

const ResourceRequirementsSchema = z.object({
  limits: z.optional(z.record(z.string(), z.union([z.string(), z.number()]))),
  requests: z.optional(z.record(z.string(), z.union([z.string(), z.number()]))),
});

const ImagePullSecretSchema = z.object({
  name: z.optional(z.string()),
});

const VolumeMountSchema = z.object({
  mountPath: z.string(),
  name: z.string(),
  readOnly: z.optional(z.boolean()),
  subPath: z.optional(z.string()),
});

const RevisionContainerSchema = z.object({
  name: z.optional(z.string()),
  image: z.optional(z.string()),
  args: z.optional(z.array(z.string())),
  command: z.optional(z.array(z.string())),
  env: z.optional(z.array(EnvVarSchema)),
  envFrom: z.optional(z.array(EnvFromSourceSchema)),
  imagePullPolicy: z.optional(z.string()),
  livenessProbe: z.optional(z.record(z.string(), z.unknown())),
  readinessProbe: z.optional(z.record(z.string(), z.unknown())),
  startupProbe: z.optional(z.record(z.string(), z.unknown())),
  ports: z.optional(z.array(ContainerPortSchema)),
  resources: z.optional(ResourceRequirementsSchema),
  securityContext: z.optional(z.record(z.string(), z.unknown())),
  volumeMounts: z.optional(z.array(VolumeMountSchema)),
  workingDir: z.optional(z.string()),
  terminationMessagePath: z.optional(z.string()),
  terminationMessagePolicy: z.optional(z.string()),
});

const RevisionSpecSchema = z.object({
  // Core fields used by this plugin
  containerConcurrency: z.optional(z.number()),
  containers: z.array(RevisionContainerSchema),
  imagePullSecrets: z.optional(z.array(ImagePullSecretSchema)),
  serviceAccountName: z.optional(z.string()),
  timeoutSeconds: z.optional(z.number()),
  idleTimeoutSeconds: z.optional(z.number()),
  responseStartTimeoutSeconds: z.optional(z.number()),
  // Other PodSpec / RevisionSpec fields kept as loose objects for forward‑compatibility
  affinity: z.optional(z.record(z.string(), z.unknown())),
  automountServiceAccountToken: z.optional(z.boolean()),
  dnsConfig: z.optional(z.record(z.string(), z.unknown())),
  dnsPolicy: z.optional(z.string()),
  enableServiceLinks: z.optional(z.boolean()),
  hostAliases: z.optional(z.array(z.record(z.string(), z.unknown()))),
  hostIPC: z.optional(z.boolean()),
  hostNetwork: z.optional(z.boolean()),
  hostPID: z.optional(z.boolean()),
  image: z.optional(z.string()),
  initContainers: z.optional(z.array(z.record(z.string(), z.unknown()))),
  nodeSelector: z.optional(z.record(z.string(), z.string())),
  priorityClassName: z.optional(z.string()),
  runtimeClassName: z.optional(z.string()),
  schedulerName: z.optional(z.string()),
  securityContext: z.optional(z.record(z.string(), z.unknown())),
  shareProcessNamespace: z.optional(z.boolean()),
  tolerations: z.optional(z.array(z.record(z.string(), z.unknown()))),
  topologySpreadConstraints: z.optional(z.array(z.record(z.string(), z.unknown()))),
  volumes: z.optional(z.array(z.record(z.string(), z.unknown()))),
});

const KnativeServiceTemplateMetadataSchema = z.object({
  annotations: z.optional(z.record(z.string(), z.string())),
  labels: z.optional(z.record(z.string(), z.string())),
  finalizers: z.optional(z.array(z.string())),
  name: z.optional(z.string()),
  namespace: z.optional(z.string()),
});

const KnativeServiceTemplateSchema = z.object({
  metadata: z.optional(KnativeServiceTemplateMetadataSchema),
  // This corresponds to RevisionSpec in the CRD.
  spec: z.optional(RevisionSpecSchema),
});

const KnativeServiceSpecSchema = z.object({
  traffic: z.optional(z.array(TrafficTargetSchema)),
  template: z.optional(KnativeServiceTemplateSchema),
});

const KnativeServiceStatusSchema = z.object({
  url: z.optional(z.string()),
  address: z.optional(
    z.object({
      url: z.optional(z.string()),
      name: z.optional(z.string()),
      audience: z.optional(z.string()),
      CACerts: z.optional(z.string()),
    })
  ),
  annotations: z.optional(z.record(z.string(), z.string())),
  latestCreatedRevisionName: z.optional(z.string()),
  latestReadyRevisionName: z.optional(z.string()),
  observedGeneration: z.optional(z.number()),
  conditions: z.optional(z.array(ConditionSchema)),
  traffic: z.optional(z.array(TrafficTargetSchema)),
});

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
  // RevisionSpec – reuses the same schema as Service template.spec
  spec: z.optional(RevisionSpecSchema),
  status: z.optional(
    z.object({
      conditions: z.optional(z.array(ConditionSchema)),
    })
  ),
});

export type KnativeRevision = z.infer<typeof KnativeRevisionSchema>;

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
