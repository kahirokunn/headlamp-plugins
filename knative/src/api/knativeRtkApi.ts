import { createApi } from '@reduxjs/toolkit/query/react';
import { createEntityAdapter, type EntityState } from '@reduxjs/toolkit';
import type { BaseQueryFn } from '@reduxjs/toolkit/query';
import * as ApiProxy from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import * as yaml from 'js-yaml';
import * as z from 'zod/mini';
import {
  ClusterDomainClaimSchema,
  DomainMappingSchema,
  KnativeRevisionSchema,
  KnativeServiceSchema,
  type ClusterDomainClaim,
  type DomainMapping,
  type KnativeRevision,
  type KnativeService,
  type TrafficTarget,
} from '../types/knative';
import type { QueryParameters } from '@kinvolk/headlamp-plugin/lib/lib/k8s/api/v1/queryParameters';
import { ApiError } from '@kinvolk/headlamp-plugin/lib/ApiProxy';

const KnativeApiErrorSchema = z.object({
  kind: z.union([
    z.literal('ApiError'),
    z.literal('ValidationError'),
    z.literal('NotFound'),
    z.literal('UnknownError'),
  ]),
  message: z.string(),
});

type KnativeApiError = z.infer<typeof KnativeApiErrorSchema>;

const UnknownErrorSchema = z.object({
  message: z.optional(z.string()),
});

type ClusterScopedResource = {
  cluster: string;
};

export type KnativeServiceWithCluster = KnativeService & ClusterScopedResource;
type KnativeRevisionWithCluster = KnativeRevision & ClusterScopedResource;
type DomainMappingWithCluster = DomainMapping & ClusterScopedResource;
type ClusterDomainClaimWithCluster = ClusterDomainClaim & ClusterScopedResource;

const KubernetesResourceMetadataSchema = z.catchall(
  z.object({
    name: z.string(),
    namespace: z.optional(z.string()),
    resourceVersion: z.optional(z.string()),
  }),
  z.unknown()
);

type KubernetesResourceMetadata = z.infer<typeof KubernetesResourceMetadataSchema>;

const KubernetesResourceSchema = z.catchall(
  z.object({
    metadata: KubernetesResourceMetadataSchema,
  }),
  z.unknown()
);

type KubernetesResource = z.infer<typeof KubernetesResourceSchema>;

type KubernetesResourceWithCluster = KubernetesResource & ClusterScopedResource;

type KubernetesResourceEntityState = EntityState<KubernetesResourceWithCluster, string>;

const kubernetesResourceAdapter = createEntityAdapter<KubernetesResourceWithCluster, string>({
  selectId: resource =>
    `${resource.cluster}/${resource.metadata.namespace ?? ''}/${resource.metadata.name}`,
});

const kubernetesResourceSelectors = kubernetesResourceAdapter.getSelectors();

type WatchResourcesArgs = {
  clusters: string[];
  group: string;
  version: string;
  plural: string;
  namespace?: string;
  labelSelector?: string;
};

function buildResourceListPath(args: WatchResourcesArgs): string {
  const base = args.group ? `/apis/${args.group}/${args.version}` : `/api/${args.version}`;
  if (args.namespace) {
    return `${base}/namespaces/${args.namespace}/${args.plural}`;
  }
  return `${base}/${args.plural}`;
}

function isKubernetesResource(value: unknown): value is KubernetesResource {
  const parsed = KubernetesResourceSchema.safeParse(value);
  return parsed.success;
}

const KN_SERVICE_BASE = '/apis/serving.knative.dev/v1' as const;
const KN_DOMAIN_MAPPING_BASE = '/apis/serving.knative.dev/v1beta1' as const;
const KN_CLUSTER_DOMAIN_CLAIM_BASE = '/apis/networking.internal.knative.dev/v1alpha1' as const;

const DeploymentListSchema = z.object({
  apiVersion: z.string(),
  kind: z.string(),
  items: z.array(
    z.object({
      metadata: z.object({
        name: z.string(),
      }),
    })
  ),
});

type DeploymentList = z.infer<typeof DeploymentListSchema>;

type SafeParseResult<T> = { success: true; data: T } | { success: false };

type SafeParseSchema<T> = {
  safeParse: (input: unknown) => SafeParseResult<T>;
};

type ListSchema<TItem> = SafeParseSchema<{ items?: TItem[] }>;

type ParseAndMapResult<TResult> =
  | { ok: true; value: TResult[] }
  | { ok: false; error: KnativeApiError };

export function toApiError(error: unknown, fallbackMessage: string): KnativeApiError {
  const parsedError = KnativeApiErrorSchema.safeParse(error);
  if (parsedError.success) {
    return parsedError.data;
  }
  if (error instanceof ApiError) {
    return { kind: 'ApiError', message: error.message || fallbackMessage };
  }
  if (error instanceof Error) {
    return { kind: 'ApiError', message: error.message || fallbackMessage };
  }
  const parsedUnknown = UnknownErrorSchema.safeParse(error);
  if (parsedUnknown.success && parsedUnknown.data.message) {
    return { kind: 'UnknownError', message: parsedUnknown.data.message };
  }
  return { kind: 'UnknownError', message: fallbackMessage };
}

async function findDeploymentNameForRevision(
  cluster: string,
  namespace: string,
  revisionName: string
): Promise<string | KnativeApiError> {
  const queryParams: QueryParameters = {
    labelSelector: `serving.knative.dev/revision=${revisionName}`,
  };

  try {
    const response = await ApiProxy.clusterRequest(
      `/apis/apps/v1/namespaces/${namespace}/deployments`,
      { method: 'GET', cluster },
      queryParams
    );
    const parsed = DeploymentListSchema.safeParse(response);
    if (!parsed.success) {
      return { kind: 'ValidationError', message: 'Invalid Deployment list response' };
    }
    const data: DeploymentList = parsed.data;
    const dep = data.items?.[0];
    if (!dep?.metadata?.name) {
      return { kind: 'ValidationError', message: 'Deployment for revision not found' };
    }
    return dep.metadata.name;
  } catch (error) {
    return toApiError(error, 'Failed to list Deployments for revision');
  }
}

function mapWatchedResources<TParsed, TResult>(
  rawState: KubernetesResourceEntityState,
  options: {
    schema: SafeParseSchema<TParsed>;
    buildItem: (parsed: TParsed, resource: KubernetesResourceWithCluster) => TResult;
    validationErrorMessage: string;
  }
): ParseAndMapResult<TResult> {
  const { schema, buildItem, validationErrorMessage } = options;
  const resources = kubernetesResourceSelectors.selectAll(rawState);
  const mapped: TResult[] = [];

  for (const resource of resources) {
    const parsed = schema.safeParse(resource);
    if (!parsed.success) {
      return {
        ok: false,
        error: { kind: 'ValidationError', message: validationErrorMessage },
      };
    }
    mapped.push(buildItem(parsed.data, resource));
  }

  return { ok: true, value: mapped };
}

type CreateSecretArgs = {
  cluster: string;
  namespace: string;
  name: string;
  data: Record<string, string>;
  type?: string;
};

type CreateServiceArgs = {
  cluster: string;
  namespace: string;
  name: string;
  image: string;
  visibility?: 'external' | 'internal';
  envSecretName?: string | null;
  imagePullSecretName?: string | null;
  port: number;
  protocol?: 'http1' | 'h2c';
  minScale: number;
  cpuRequest?: string | null;
  cpuLimit?: string | null;
  memoryRequest?: string | null;
  memoryLimit?: string | null;
};

type CreateDomainMappingArgs = {
  cluster: string;
  namespace: string;
  domain: string;
  serviceName: string;
  serviceNamespace?: string;
};

type CreateClusterDomainClaimArgs = {
  cluster: string;
  domain: string;
  namespace: string;
};

type DeleteDomainMappingArgs = {
  cluster: string;
  namespace: string;
  domain: string;
};

type AnnotateDomainMappingArgs = {
  cluster: string;
  namespace: string;
  domain: string;
  annotations: Record<string, string | null>;
};

type RedeployServiceArgs = {
  cluster: string;
  namespace: string;
  name: string;
};

type RestartServiceArgs = {
  cluster: string;
  namespace: string;
  service: KnativeService;
};

type UpdateTrafficArgs = {
  cluster: string;
  namespace: string;
  name: string;
  traffic: TrafficTarget[];
};

type UpdateAutoscalingSettingsArgs = {
  cluster: string;
  namespace: string;
  name: string;
  params: {
    metric?: 'concurrency' | 'rps';
    target?: number | null;
    targetUtilization?: number | null;
    containerConcurrency?: number | null;
    minScale?: number | null;
    maxScale?: number | null;
    initialScale?: number | null;
    activationScale?: number | null;
    scaleDownDelay?: string | null;
    stableWindow?: string | null;
  };
};

type AutoscalingAnnotationsPatch = Record<string, string | null>;

type AutoscalingTemplateSpecPatch = {
  containerConcurrency?: number | null;
};

type UpdateAutoscalingSettingsBody = {
  spec: {
    template: {
      metadata?: {
        annotations: AutoscalingAnnotationsPatch;
      };
      spec?: AutoscalingTemplateSpecPatch;
    };
  };
};

type FetchAutoscalingGlobalDefaultsArgs = {
  clusters: string[];
};

type FetchNetworkTemplatesArgs = {
  clusters: string[];
};

type FetchIngressClassArgs = {
  clusters: string[];
};

type FetchGatewayConfigArgs = {
  clusters: string[];
};

const K8sConfigMapSchema = z.object({
  metadata: z.optional(
    z.object({
      name: z.optional(z.string()),
      namespace: z.optional(z.string()),
    })
  ),
  data: z.optional(z.record(z.string(), z.string())),
});

type K8sConfigMap = z.infer<typeof K8sConfigMapSchema>;

type AutoscalingGlobalDefaults = {
  concurrencyTarget: number;
  targetUtilizationPercentage: number;
  rpsTarget: number;
  containerConcurrency: number;
  minScale: number;
  maxScale: number;
  maxScaleLimit?: number;
  initialScale: number;
  allowZeroInitialScale: boolean;
  scaleDownDelay: string;
  stableWindow: string;
  activationScaleDefault: number;
};

type AutoscalingGlobalDefaultsWithCluster = AutoscalingGlobalDefaults & ClusterScopedResource;

type NetworkTemplates = {
  domainTemplate: string;
  tagTemplate: string;
};

type NetworkTemplatesWithCluster = NetworkTemplates & ClusterScopedResource;

type IngressClassWithCluster = {
  cluster: string;
  ingressClass: string | null;
};

const NamespacedNameSchema = z.object({
  namespace: z.string(),
  name: z.string(),
});

type NamespacedName = z.infer<typeof NamespacedNameSchema>;

const NamespacedNameFromStringSchema = z.pipe(
  z.string(),
  z.transform((value: string): NamespacedName => {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new Error('Invalid namespaced name: empty');
    }
    const slashIndex = trimmed.indexOf('/');
    if (slashIndex <= 0 || slashIndex === trimmed.length - 1) {
      throw new Error('Invalid namespaced name format');
    }
    const namespace = trimmed.slice(0, slashIndex).trim();
    const name = trimmed.slice(slashIndex + 1).trim();
    const result = NamespacedNameSchema.safeParse({ namespace, name });
    if (!result.success) {
      throw new Error('Invalid namespaced name structure');
    }
    return result.data;
  })
);

const GatewayConfigSchema = z.object({
  class: z.string(),
  gateway: NamespacedNameSchema,
  service: z.optional(NamespacedNameSchema),
  supportedFeatures: z.optional(z.array(z.string())),
  controllerName: z.optional(z.string()),
});

type GatewayConfig = z.infer<typeof GatewayConfigSchema>;

const RawGatewayConfigSchema = z.object({
  class: z.string(),
  gateway: NamespacedNameFromStringSchema, // format: "namespace/name"
  service: z.optional(NamespacedNameFromStringSchema),
  'supported-features': z.optional(z.array(z.string())),
});

const GatewayYamlEntrySchema = z.pipe(
  z.string(),
  z.transform((yamlStr: string): GatewayConfig | null => {
    if (!yamlStr || !yamlStr.trim()) {
      return null;
    }
    try {
      const parsed = yaml.load(yamlStr);
      if (!parsed) return null;

      const firstEntry = Array.isArray(parsed) ? parsed[0] : parsed;
      if (!firstEntry || typeof firstEntry !== 'object') {
        return null;
      }

      const rawResult = RawGatewayConfigSchema.safeParse(firstEntry);
      if (!rawResult.success) {
        return null;
      }

      const result = GatewayConfigSchema.safeParse({
        class: rawResult.data.class,
        gateway: rawResult.data.gateway,
        service: rawResult.data.service,
        supportedFeatures: rawResult.data['supported-features'],
      });
      if (!result.success) {
        return null;
      }

      return result.data;
    } catch {
      return null;
    }
  })
);

const ConfigGatewaySchema = z.object({
  data: z.optional(
    z.object({
      'external-gateways': z.optional(GatewayYamlEntrySchema),
      'local-gateways': z.optional(GatewayYamlEntrySchema),
    })
  ),
});

export type GatewayConfigResult = {
  external: GatewayConfig | null;
  local: GatewayConfig | null;
};

type GatewayConfigResultWithCluster = GatewayConfigResult & ClusterScopedResource;

const GatewayClassSchema = z.object({
  spec: z.object({
    controllerName: z.string(),
  }),
});

type GatewayClass = z.infer<typeof GatewayClassSchema>;

async function getGatewayClassControllerName(
  cluster: string,
  className: string
): Promise<string | undefined> {
  if (!className) {
    return undefined;
  }
  try {
    const response = await ApiProxy.clusterRequest(
      `/apis/gateway.networking.k8s.io/v1/gatewayclasses/${className}`,
      { method: 'GET', cluster }
    );
    const parsed = GatewayClassSchema.safeParse(response);
    if (!parsed.success) {
      return undefined;
    }
    const controllerName = parsed.data.spec?.controllerName;
    const trimmed = controllerName?.trim();
    return trimmed ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

type KnativeBaseQueryFn = BaseQueryFn<unknown, unknown, KnativeApiError>;

const emptyBaseQuery: KnativeBaseQueryFn = async () => ({
  error: {
    kind: 'UnknownError',
    message: 'Base query is not used; endpoints use queryFn.',
  },
});

export const knativeRtkApi = createApi({
  reducerPath: 'knativeRtkApi',
  baseQuery: emptyBaseQuery,
  endpoints: build => ({
    watchResources: build.query<KubernetesResourceEntityState, WatchResourcesArgs>({
      async queryFn() {
        return { data: kubernetesResourceAdapter.getInitialState() };
      },
      async onCacheEntryAdded(arg, { updateCachedData, cacheDataLoaded, cacheEntryRemoved }) {
        await cacheDataLoaded.catch(() => undefined);

        if (!arg.clusters || arg.clusters.length === 0) {
          // No clusters to watch; leave state empty
          await cacheEntryRemoved;
          return;
        }

        const path = buildResourceListPath(arg);
        const queryParams: QueryParameters | undefined = arg.labelSelector
          ? { labelSelector: arg.labelSelector }
          : undefined;

        const cancelStreams: Array<(() => void) | undefined> = [];

        // Open a stream for each cluster
        for (const cluster of arg.clusters) {
          try {
            const cancelStream = await ApiProxy.streamResultsForCluster(
              path,
              {
                cluster,
                cb: (items: unknown[]) => {
                  updateCachedData(draft => {
                    // Remove existing entities for this cluster (by ID prefix)
                    const allResources = kubernetesResourceSelectors.selectAll(draft);
                    const otherClusterResources = allResources.filter(
                      r => !r.cluster || r.cluster !== cluster
                    );
                    const newResources: KubernetesResourceWithCluster[] = [];
                    for (const raw of items) {
                      if (!isKubernetesResource(raw)) {
                        continue;
                      }
                      newResources.push({
                        ...raw,
                        cluster,
                      });
                    }
                    // Set all: other clusters' resources + this cluster's new resources
                    kubernetesResourceAdapter.setAll(draft, [
                      ...otherClusterResources,
                      ...newResources,
                    ]);
                  });
                },
                errCb: () => {
                  // ignore stream errors; consumers can refetch manually
                },
              },
              queryParams
            );
            cancelStreams.push(cancelStream);
          } catch {
            // ignore stream setup errors for individual clusters
            cancelStreams.push(undefined);
          }
        }

        await cacheEntryRemoved;
        // Cancel all streams
        for (const cancelStream of cancelStreams) {
          if (cancelStream) {
            cancelStream();
          }
        }
      },
    }),

    createSecret: build.mutation<void, CreateSecretArgs>({
      async queryFn({ cluster, namespace, name, data, type }) {
        const body = {
          apiVersion: 'v1',
          kind: 'Secret',
          metadata: { name, namespace },
          type: type || 'Opaque',
          stringData: data,
        };
        try {
          await ApiProxy.clusterRequest(`/api/v1/namespaces/${namespace}/secrets`, {
            method: 'POST',
            cluster,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          return { data: undefined };
        } catch (error) {
          return { error: toApiError(error, 'Failed to create Secret') };
        }
      },
    }),

    createService: build.mutation<KnativeServiceWithCluster, CreateServiceArgs>({
      async queryFn(args) {
        const {
          cluster,
          namespace,
          name,
          image,
          visibility,
          envSecretName,
          imagePullSecretName,
          port,
          protocol,
          minScale,
          cpuRequest,
          cpuLimit,
          memoryRequest,
          memoryLimit,
        } = args;

        const metadata: KnativeService['metadata'] = {
          name,
          namespace,
          labels: {},
        };
        if (visibility === 'internal') {
          metadata.labels = {
            ...metadata.labels,
            'networking.knative.dev/visibility': 'cluster-local',
          };
        }

        const templateMetadata: { annotations?: Record<string, string> } = {};
        if (protocol) {
          templateMetadata.annotations = {
            ...(templateMetadata.annotations || {}),
            'serving.knative.dev/protocol': protocol,
          };
        }
        templateMetadata.annotations = {
          ...(templateMetadata.annotations || {}),
          'autoscaling.knative.dev/min-scale': String(minScale),
        };

        const requests =
          cpuRequest || memoryRequest
            ? {
                ...(cpuRequest ? { cpu: cpuRequest } : {}),
                ...(memoryRequest ? { memory: memoryRequest } : {}),
              }
            : undefined;

        const limits =
          cpuLimit || memoryLimit
            ? {
                ...(cpuLimit ? { cpu: cpuLimit } : {}),
                ...(memoryLimit ? { memory: memoryLimit } : {}),
              }
            : undefined;

        const resources =
          requests || limits
            ? {
                ...(requests ? { requests } : {}),
                ...(limits ? { limits } : {}),
              }
            : undefined;

        const container = {
          image,
          ...(envSecretName ? { envFrom: [{ secretRef: { name: envSecretName } }] } : {}),
          ports: [{ containerPort: port }],
          ...(resources ? { resources } : {}),
        };

        const templateSpec: Record<string, unknown> = {
          containers: [container],
          ...(imagePullSecretName ? { imagePullSecrets: [{ name: imagePullSecretName }] } : {}),
        };

        const body: KnativeService = {
          apiVersion: 'serving.knative.dev/v1',
          kind: 'Service',
          metadata,
          spec: {
            template: {
              ...(Object.keys(templateMetadata).length > 0 ? { metadata: templateMetadata } : {}),
              spec: templateSpec,
            },
          },
        };

        try {
          const response = await ApiProxy.clusterRequest(
            `${KN_SERVICE_BASE}/namespaces/${namespace}/services`,
            {
              method: 'POST',
              cluster,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            }
          );
          const parsed = KnativeServiceSchema.safeParse(response);
          if (!parsed.success) {
            return {
              error: { kind: 'ValidationError', message: 'Invalid Knative Service response' },
            };
          }
          return { data: { ...parsed.data, cluster } };
        } catch (error) {
          return { error: toApiError(error, 'Failed to create Knative Service') };
        }
      },
    }),

    createDomainMapping: build.mutation<DomainMappingWithCluster, CreateDomainMappingArgs>({
      async queryFn({ cluster, namespace, domain, serviceName, serviceNamespace }) {
        const body: DomainMapping = {
          apiVersion: 'serving.knative.dev/v1beta1',
          kind: 'DomainMapping',
          metadata: {
            name: domain,
            namespace,
          },
          spec: {
            ref: {
              apiVersion: 'serving.knative.dev/v1',
              kind: 'Service',
              name: serviceName,
              namespace: serviceNamespace || namespace,
            },
          },
        };
        try {
          const response = await ApiProxy.clusterRequest(
            `${KN_DOMAIN_MAPPING_BASE}/namespaces/${namespace}/domainmappings`,
            {
              method: 'POST',
              cluster,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            }
          );
          const parsed = DomainMappingSchema.safeParse(response);
          if (!parsed.success) {
            return {
              error: { kind: 'ValidationError', message: 'Invalid DomainMapping response' },
            };
          }
          return { data: { ...parsed.data, cluster } };
        } catch (error) {
          return { error: toApiError(error, 'Failed to create DomainMapping') };
        }
      },
    }),

    createClusterDomainClaim: build.mutation<
      ClusterDomainClaimWithCluster,
      CreateClusterDomainClaimArgs
    >({
      async queryFn({ cluster, domain, namespace }) {
        const body: ClusterDomainClaim = {
          apiVersion: 'networking.internal.knative.dev/v1alpha1',
          kind: 'ClusterDomainClaim',
          metadata: { name: domain },
          spec: { namespace },
        };
        try {
          const response = await ApiProxy.clusterRequest(
            `${KN_CLUSTER_DOMAIN_CLAIM_BASE}/clusterdomainclaims`,
            {
              method: 'POST',
              cluster,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            }
          );
          const parsed = ClusterDomainClaimSchema.safeParse(response);
          if (!parsed.success) {
            return {
              error: { kind: 'ValidationError', message: 'Invalid ClusterDomainClaim response' },
            };
          }
          return { data: { ...parsed.data, cluster } };
        } catch (error) {
          return { error: toApiError(error, 'Failed to create ClusterDomainClaim') };
        }
      },
    }),

    deleteDomainMapping: build.mutation<void, DeleteDomainMappingArgs>({
      async queryFn({ cluster, namespace, domain }) {
        try {
          await ApiProxy.clusterRequest(
            `${KN_DOMAIN_MAPPING_BASE}/namespaces/${namespace}/domainmappings/${domain}`,
            { method: 'DELETE', cluster }
          );
          return { data: undefined };
        } catch (error) {
          return { error: toApiError(error, 'Failed to delete DomainMapping') };
        }
      },
    }),

    annotateDomainMapping: build.mutation<DomainMappingWithCluster, AnnotateDomainMappingArgs>({
      async queryFn({ cluster, namespace, domain, annotations }) {
        const body = {
          metadata: {
            annotations,
          },
        };
        try {
          const response = await ApiProxy.clusterRequest(
            `${KN_DOMAIN_MAPPING_BASE}/namespaces/${namespace}/domainmappings/${domain}`,
            {
              method: 'PATCH',
              cluster,
              headers: { 'Content-Type': 'application/merge-patch+json' },
              body: JSON.stringify(body),
            }
          );
          const parsed = DomainMappingSchema.safeParse(response);
          if (!parsed.success) {
            return {
              error: { kind: 'ValidationError', message: 'Invalid DomainMapping response' },
            };
          }
          return { data: { ...parsed.data, cluster } };
        } catch (error) {
          return { error: toApiError(error, 'Failed to annotate DomainMapping') };
        }
      },
    }),

    redeployService: build.mutation<void, RedeployServiceArgs>({
      async queryFn({ cluster, namespace, name }) {
        const now = new Date().toISOString();
        const body = {
          spec: {
            template: {
              metadata: {
                annotations: {
                  'knative.headlamp.dev/redeployAt': now,
                },
              },
            },
          },
        };
        try {
          await ApiProxy.clusterRequest(
            `${KN_SERVICE_BASE}/namespaces/${namespace}/services/${name}`,
            {
              method: 'PATCH',
              cluster,
              headers: { 'Content-Type': 'application/merge-patch+json' },
              body: JSON.stringify(body),
            }
          );
          return { data: undefined };
        } catch (error) {
          return { error: toApiError(error, 'Failed to redeploy Knative Service') };
        }
      },
    }),

    restartService: build.mutation<void, RestartServiceArgs>({
      async queryFn({ cluster, namespace, service }) {
        const revisionName = service.status?.latestReadyRevisionName;
        if (!revisionName) {
          return {
            error: { kind: 'ValidationError', message: 'latestReadyRevisionName not found' },
          };
        }
        const depNameOrError = await findDeploymentNameForRevision(
          cluster,
          namespace,
          revisionName
        );
        if (typeof depNameOrError !== 'string') {
          return { error: depNameOrError };
        }
        const now = new Date().toISOString();
        const body = {
          spec: {
            template: {
              metadata: {
                annotations: {
                  'kubectl.kubernetes.io/restartedAt': now,
                },
              },
            },
          },
        };
        try {
          await ApiProxy.clusterRequest(
            `/apis/apps/v1/namespaces/${namespace}/deployments/${depNameOrError}`,
            {
              method: 'PATCH',
              cluster,
              headers: { 'Content-Type': 'application/strategic-merge-patch+json' },
              body: JSON.stringify(body),
            }
          );
          return { data: undefined };
        } catch (error) {
          return { error: toApiError(error, 'Failed to restart Knative Service') };
        }
      },
    }),

    updateTraffic: build.mutation<KnativeServiceWithCluster, UpdateTrafficArgs>({
      async queryFn({ cluster, namespace, name, traffic }) {
        const body = {
          spec: {
            traffic,
          },
        };
        try {
          const response = await ApiProxy.clusterRequest(
            `${KN_SERVICE_BASE}/namespaces/${namespace}/services/${name}`,
            {
              method: 'PATCH',
              cluster,
              headers: { 'Content-Type': 'application/merge-patch+json' },
              body: JSON.stringify(body),
            }
          );
          const parsed = KnativeServiceSchema.safeParse(response);
          if (!parsed.success) {
            return {
              error: { kind: 'ValidationError', message: 'Invalid Knative Service response' },
            };
          }
          return { data: { ...parsed.data, cluster } };
        } catch (error) {
          return { error: toApiError(error, 'Failed to update Knative Service traffic') };
        }
      },
    }),

    updateAutoscalingSettings: build.mutation<
      KnativeServiceWithCluster,
      UpdateAutoscalingSettingsArgs
    >({
      async queryFn({ cluster, namespace, name, params }) {
        const {
          metric,
          target,
          targetUtilization,
          minScale,
          maxScale,
          initialScale,
          activationScale,
          scaleDownDelay,
          stableWindow,
          containerConcurrency,
        } = params;

        const annotationSources = {
          'autoscaling.knative.dev/metric': metric,
          'autoscaling.knative.dev/target': target,
          'autoscaling.knative.dev/target-utilization-percentage': targetUtilization,
          'autoscaling.knative.dev/min-scale': minScale,
          'autoscaling.knative.dev/max-scale': maxScale,
          'autoscaling.knative.dev/initial-scale': initialScale,
          'autoscaling.knative.dev/activation-scale': activationScale,
          'autoscaling.knative.dev/scale-down-delay': scaleDownDelay,
          'autoscaling.knative.dev/window': stableWindow,
        };

        const annotationsPatch: AutoscalingAnnotationsPatch = {};
        for (const [key, value] of Object.entries(annotationSources)) {
          if (value === undefined) {
            continue;
          }
          annotationsPatch[key] = value == null ? null : String(value);
        }

        const templateSpecPatch: AutoscalingTemplateSpecPatch = {};
        if (containerConcurrency !== undefined) {
          templateSpecPatch.containerConcurrency = containerConcurrency;
        }

        const hasAnnotationsPatch = Object.keys(annotationsPatch).length > 0;
        const hasTemplateSpecPatch = Object.keys(templateSpecPatch).length > 0;

        const body: UpdateAutoscalingSettingsBody = {
          spec: {
            template: {
              ...(hasAnnotationsPatch && {
                metadata: { annotations: annotationsPatch },
              }),
              ...(hasTemplateSpecPatch && {
                spec: templateSpecPatch,
              }),
            },
          },
        };

        try {
          const response = await ApiProxy.clusterRequest(
            `${KN_SERVICE_BASE}/namespaces/${namespace}/services/${name}`,
            {
              method: 'PATCH',
              cluster,
              headers: { 'Content-Type': 'application/merge-patch+json' },
              body: JSON.stringify(body),
            }
          );
          const parsed = KnativeServiceSchema.safeParse(response);
          if (!parsed.success) {
            return {
              error: { kind: 'ValidationError', message: 'Invalid Knative Service response' },
            };
          }
          return { data: { ...parsed.data, cluster } };
        } catch (error) {
          return { error: toApiError(error, 'Failed to update autoscaling settings') };
        }
      },
    }),

    fetchAutoscalingGlobalDefaults: build.query<
      AutoscalingGlobalDefaultsWithCluster[],
      FetchAutoscalingGlobalDefaultsArgs
    >({
      async queryFn({ clusters }) {
        const DOC_DEFAULTS = {
          concurrencyTarget: 100,
          targetUtilizationPercentage: 70,
          rpsTarget: 200,
          containerConcurrency: 0,
          minScale: 0,
          maxScale: 0,
          initialScale: 1,
          scaleDownDelay: '0s',
          stableWindow: '60s',
          activationScaleDefault: 1,
        };

        const parseNumberOrUndefined = (value?: string): number | undefined => {
          if (value === undefined || value === '') {
            return undefined;
          }
          const n = Number(value);
          return Number.isFinite(n) ? n : undefined;
        };

        const toNum = (value: string | undefined, fallback: number): number => {
          const parsed = parseNumberOrUndefined(value);
          return parsed ?? fallback;
        };

        const results: AutoscalingGlobalDefaultsWithCluster[] = [];

        for (const cluster of clusters) {
          let autoscaler: K8sConfigMap | undefined;
          let defaults: K8sConfigMap | undefined;
          try {
            const response = await ApiProxy.clusterRequest(
              `/api/v1/namespaces/knative-serving/configmaps/config-autoscaler`,
              { method: 'GET', cluster }
            );
            const parsed = K8sConfigMapSchema.safeParse(response);
            if (parsed.success) {
              autoscaler = parsed.data;
            }
          } catch {
            // ignore
          }
          try {
            const response = await ApiProxy.clusterRequest(
              `/api/v1/namespaces/knative-serving/configmaps/config-defaults`,
              { method: 'GET', cluster }
            );
            const parsed = K8sConfigMapSchema.safeParse(response);
            if (parsed.success) {
              defaults = parsed.data;
            }
          } catch {
            // ignore
          }
          const a = autoscaler?.data ?? {};
          const d = defaults?.data ?? {};

          const result: AutoscalingGlobalDefaultsWithCluster = {
            cluster,
            concurrencyTarget: toNum(
              a['container-concurrency-target-default'],
              DOC_DEFAULTS.concurrencyTarget
            ),
            targetUtilizationPercentage: toNum(
              a['container-concurrency-target-percentage'],
              DOC_DEFAULTS.targetUtilizationPercentage
            ),
            rpsTarget: toNum(a['requests-per-second-target-default'], DOC_DEFAULTS.rpsTarget),
            containerConcurrency: toNum(
              d['container-concurrency'],
              DOC_DEFAULTS.containerConcurrency
            ),
            minScale: toNum(a['min-scale'], DOC_DEFAULTS.minScale),
            maxScale: toNum(a['max-scale'], DOC_DEFAULTS.maxScale),
            maxScaleLimit: parseNumberOrUndefined(a['max-scale-limit']),
            initialScale: toNum(a['initial-scale'], DOC_DEFAULTS.initialScale),
            allowZeroInitialScale:
              String(a['allow-zero-initial-scale'] || '').toLowerCase() === 'true',
            scaleDownDelay: a['scale-down-delay'] || DOC_DEFAULTS.scaleDownDelay,
            stableWindow: a['stable-window'] || DOC_DEFAULTS.stableWindow,
            activationScaleDefault: DOC_DEFAULTS.activationScaleDefault,
          };
          results.push(result);
        }

        return { data: results };
      },
    }),

    fetchNetworkTemplates: build.query<NetworkTemplatesWithCluster[], FetchNetworkTemplatesArgs>({
      async queryFn({ clusters }) {
        const DEFAULTS: NetworkTemplates = {
          domainTemplate: '{{.Name}}.{{.Namespace}}.{{.Domain}}',
          tagTemplate: '{{.Tag}}-{{.Name}}',
        };
        const results: NetworkTemplatesWithCluster[] = [];

        for (const cluster of clusters) {
          try {
            const response = await ApiProxy.clusterRequest(
              `/api/v1/namespaces/knative-serving/configmaps/config-network`,
              { method: 'GET', cluster }
            );
            const parsed = K8sConfigMapSchema.safeParse(response);
            const d = (parsed.success ? parsed.data : undefined)?.data ?? {};
            const result: NetworkTemplatesWithCluster = {
              cluster,
              domainTemplate: d['domain-template'] || DEFAULTS.domainTemplate,
              tagTemplate: d['tag-template'] || DEFAULTS.tagTemplate,
            };
            results.push(result);
          } catch {
            results.push({
              cluster,
              ...DEFAULTS,
            });
          }
        }

        return { data: results };
      },
    }),

    fetchIngressClass: build.query<IngressClassWithCluster[], FetchIngressClassArgs>({
      async queryFn({ clusters }) {
        const results: IngressClassWithCluster[] = [];

        for (const cluster of clusters) {
          try {
            const response = await ApiProxy.clusterRequest(
              `/api/v1/namespaces/knative-serving/configmaps/config-network`,
              { method: 'GET', cluster }
            );
            const parsed = K8sConfigMapSchema.safeParse(response);
            if (!parsed.success) {
              results.push({ cluster, ingressClass: null });
              continue;
            }
            const raw = parsed.data?.data?.['ingress.class'];
            if (raw == null) {
              results.push({ cluster, ingressClass: null });
              continue;
            }
            const trimmed = raw.trim();
            results.push({ cluster, ingressClass: trimmed === '' ? null : trimmed });
          } catch {
            results.push({ cluster, ingressClass: null });
          }
        }

        return { data: results };
      },
    }),

    fetchGatewayConfig: build.query<GatewayConfigResultWithCluster[], FetchGatewayConfigArgs>({
      async queryFn({ clusters }) {
        const results: GatewayConfigResultWithCluster[] = [];

        const applyControllerName = (
          cfg: GatewayConfig | null,
          controllerName: string | undefined
        ): GatewayConfig | null => {
          if (!cfg) {
            return null;
          }
          if (!controllerName) {
            return cfg;
          }
          return {
            ...cfg,
            controllerName,
          };
        };

        for (const cluster of clusters) {
          try {
            const response = await ApiProxy.clusterRequest(
              `/api/v1/namespaces/knative-serving/configmaps/config-gateway`,
              { method: 'GET', cluster }
            );
            const parsed = ConfigGatewaySchema.safeParse(response);
            if (!parsed.success) {
              results.push({ cluster, external: null, local: null });
              continue;
            }
            const cm = parsed.data;

            const data = cm.data;
            const externalConfig = data?.['external-gateways'] ?? null;
            const localConfig = data?.['local-gateways'] ?? null;

            const [externalControllerName, localControllerName] = await Promise.all([
              externalConfig?.class
                ? getGatewayClassControllerName(cluster, externalConfig.class)
                : undefined,
              localConfig?.class
                ? getGatewayClassControllerName(cluster, localConfig.class)
                : undefined,
            ]);

            results.push({
              cluster,
              external: applyControllerName(externalConfig, externalControllerName),
              local: applyControllerName(localConfig, localControllerName),
            });
          } catch {
            results.push({ cluster, external: null, local: null });
          }
        }

        return { data: results };
      },
    }),
  }),
});

export const {
  useWatchResourcesQuery,
  useCreateSecretMutation,
  useCreateServiceMutation,
  useCreateDomainMappingMutation,
  useCreateClusterDomainClaimMutation,
  useDeleteDomainMappingMutation,
  useAnnotateDomainMappingMutation,
  useRedeployServiceMutation,
  useRestartServiceMutation,
  useUpdateTrafficMutation,
  useUpdateAutoscalingSettingsMutation,
  useFetchAutoscalingGlobalDefaultsQuery,
  useFetchNetworkTemplatesQuery,
  useFetchIngressClassQuery,
  useFetchGatewayConfigQuery,
} = knativeRtkApi;

/**
 * Arguments for watching Knative resources across multiple clusters.
 * The hooks support watching multiple clusters simultaneously, and results
 * are returned as flattened arrays where each item includes a `cluster` field
 * indicating its origin cluster.
 */
type WatchKnativeResourceArgs = {
  clusters: string[];
  namespace?: string;
  labelSelector?: string;
};

type WatchKnativeServicesInternalArgs = WatchKnativeResourceArgs;
type WatchKnativeRevisionsInternalArgs = WatchKnativeResourceArgs & {
  serviceName?: string;
};
type WatchDomainMappingsInternalArgs = WatchKnativeResourceArgs;

type WatchResourcesQueryResult = ReturnType<typeof useWatchResourcesQuery>;

type WatchKnativeResult<TResult> = Omit<WatchResourcesQueryResult, 'data' | 'error'> & {
  data?: TResult[];
  error?: KnativeApiError;
};

type WatchKnativeServiceArgs = {
  clusters: string[];
  namespace: string;
  name: string;
};

type WatchKnativeServiceResult = Omit<WatchResourcesQueryResult, 'data' | 'error'> & {
  data?: KnativeServiceWithCluster;
  error?: KnativeApiError;
};

function normalizeWatchResourcesError(
  error: WatchResourcesQueryResult['error'],
  fallbackMessage: string
): KnativeApiError | undefined {
  if (!error) {
    return undefined;
  }
  return toApiError(error, fallbackMessage);
}

export function useWatchKnativeServices(
  args: WatchKnativeServicesInternalArgs
): WatchKnativeResult<KnativeServiceWithCluster> {
  const {
    data: rawState,
    error: baseError,
    ...rest
  } = useWatchResourcesQuery({
    clusters: args.clusters,
    group: 'serving.knative.dev',
    version: 'v1',
    plural: 'services',
    namespace: args.namespace,
    labelSelector: args.labelSelector,
  });

  const normalizedError = normalizeWatchResourcesError(
    baseError,
    'Failed to watch Knative Services'
  );

  if (!rawState || normalizedError) {
    return {
      data: undefined,
      error: normalizedError,
      ...rest,
    };
  }

  const mapped = mapWatchedResources<KnativeService, KnativeServiceWithCluster>(rawState, {
    schema: KnativeServiceSchema,
    buildItem: (parsed, resource) => ({
      ...parsed,
      cluster: resource.cluster,
    }),
    validationErrorMessage: 'Invalid Knative Service resource in watch response',
  });

  if (!mapped.ok) {
    return {
      data: undefined,
      error: mapped.error,
      ...rest,
    };
  }

  return {
    data: mapped.value,
    error: undefined,
    ...rest,
  };
}

export function useWatchKnativeRevisions(
  args: WatchKnativeRevisionsInternalArgs
): WatchKnativeResult<KnativeRevisionWithCluster> {
  const labelSelector =
    args.labelSelector && args.labelSelector.trim().length > 0
      ? args.labelSelector
      : args.serviceName
      ? `serving.knative.dev/service=${args.serviceName}`
      : undefined;

  const {
    data: rawState,
    error: baseError,
    ...rest
  } = useWatchResourcesQuery({
    clusters: args.clusters,
    group: 'serving.knative.dev',
    version: 'v1',
    plural: 'revisions',
    namespace: args.namespace,
    labelSelector,
  });

  const normalizedError = normalizeWatchResourcesError(
    baseError,
    'Failed to watch Knative Revisions'
  );

  if (!rawState || normalizedError) {
    return {
      data: undefined,
      error: normalizedError,
      ...rest,
    };
  }

  const mapped = mapWatchedResources<KnativeRevision, KnativeRevisionWithCluster>(rawState, {
    schema: KnativeRevisionSchema,
    buildItem: (parsed, resource) => ({
      ...parsed,
      cluster: resource.cluster,
    }),
    validationErrorMessage: 'Invalid Knative Revision resource in watch response',
  });

  if (!mapped.ok) {
    return {
      data: undefined,
      error: mapped.error,
      ...rest,
    };
  }

  return {
    data: mapped.value,
    error: undefined,
    ...rest,
  };
}

export function useWatchDomainMappings(
  args: WatchDomainMappingsInternalArgs
): WatchKnativeResult<DomainMappingWithCluster> {
  const {
    data: rawState,
    error: baseError,
    ...rest
  } = useWatchResourcesQuery({
    clusters: args.clusters,
    group: 'serving.knative.dev',
    version: 'v1beta1',
    plural: 'domainmappings',
    namespace: args.namespace,
    labelSelector: args.labelSelector,
  });

  const normalizedError = normalizeWatchResourcesError(baseError, 'Failed to watch DomainMappings');

  if (!rawState || normalizedError) {
    return {
      data: undefined,
      error: normalizedError,
      ...rest,
    };
  }

  const mapped = mapWatchedResources<DomainMapping, DomainMappingWithCluster>(rawState, {
    schema: DomainMappingSchema,
    buildItem: (parsed, resource) => ({
      ...parsed,
      cluster: resource.cluster,
    }),
    validationErrorMessage: 'Invalid DomainMapping resource in watch response',
  });

  if (!mapped.ok) {
    return {
      data: undefined,
      error: mapped.error,
      ...rest,
    };
  }

  return {
    data: mapped.value,
    error: undefined,
    ...rest,
  };
}

/**
 * Get age string from timestamp.
 * Returns empty string if timestamp is not provided.
 */
export function getAge(timestamp?: string): string {
  if (!timestamp) return '';
  const then = new Date(timestamp).getTime();
  const diff = Date.now() - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
