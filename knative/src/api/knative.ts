import * as ApiProxy from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import * as yaml from 'js-yaml';
import * as z from 'zod/mini';
import {
  ClusterDomainClaimSchema,
  DomainMappingSchema,
  K8sListSchema,
  KnativeRevisionSchema,
  KnativeServiceSchema,
} from '../types/knative';
import type {
  ClusterDomainClaim,
  DomainMapping,
  KnativeRevision,
  KnativeService,
  TrafficTarget,
} from '../types/knative';

const KN_SERVICE_BASE = '/apis/serving.knative.dev/v1';
const KN_DOMAIN_MAPPING_BASE = '/apis/serving.knative.dev/v1beta1';
const KN_CLUSTER_DOMAIN_CLAIM_BASE = '/apis/networking.internal.knative.dev/v1alpha1';

const KnativeServiceListSchema = z.object({
  apiVersion: z.string(),
  kind: z.string(),
  items: z.array(KnativeServiceSchema),
});

const KnativeRevisionListSchema = z.object({
  apiVersion: z.string(),
  kind: z.string(),
  items: z.array(KnativeRevisionSchema),
});

const DomainMappingListSchema = z.object({
  apiVersion: z.string(),
  kind: z.string(),
  items: z.array(DomainMappingSchema),
});

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

export async function listServices(): Promise<KnativeService[]> {
  const res = KnativeServiceListSchema.parse(
    await ApiProxy.request(`${KN_SERVICE_BASE}/services`, {
      method: 'GET',
    })
  );
  return res.items ?? [];
}

export async function getService(namespace: string, name: string): Promise<KnativeService> {
  return KnativeServiceSchema.parse(
    await ApiProxy.request(`${KN_SERVICE_BASE}/namespaces/${namespace}/services/${name}`, {
      method: 'GET',
    })
  );
}

/**
 * Create a K8s Secret with provided string data (not base64-encoded).
 */
export async function createSecret(params: {
  namespace: string;
  name: string;
  data: Record<string, string>;
  type?: string;
}): Promise<unknown> {
  const { namespace, name, data, type } = params;
  const body = {
    apiVersion: 'v1',
    kind: 'Secret',
    metadata: { name, namespace },
    type: type || 'Opaque',
    stringData: data,
  };
  const res = await ApiProxy.request(`/api/v1/namespaces/${namespace}/secrets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  // We currently do not rely on the Secret body; validate as unknown.
  return z.unknown().parse(res);
}

/**
 * Create a Knative Service with minimal fields.
 * Optionally set internal visibility and attach envFrom secret and imagePullSecret.
 */
export async function createService(params: {
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
}): Promise<KnativeService> {
  const {
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
  } = params;
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

  const templateSpec: Record<string, unknown> = {};
  if (imagePullSecretName) {
    (templateSpec as any).imagePullSecrets = [{ name: imagePullSecretName }];
  }

  const container: Record<string, unknown> = { image };
  if (envSecretName) {
    (container as any).envFrom = [{ secretRef: { name: envSecretName } }];
  }
  (container as any).ports = [{ containerPort: port }];
  // resources
  const resources: { requests?: Record<string, string>; limits?: Record<string, string> } = {};
  if (cpuRequest || memoryRequest) {
    resources.requests = {};
    if (cpuRequest) resources.requests.cpu = cpuRequest;
    if (memoryRequest) resources.requests.memory = memoryRequest;
  }
  if (cpuLimit || memoryLimit) {
    resources.limits = {};
    if (cpuLimit) resources.limits.cpu = cpuLimit;
    if (memoryLimit) resources.limits.memory = memoryLimit;
  }
  if (resources.requests || resources.limits) {
    (container as any).resources = resources;
  }
  (templateSpec as any).containers = [container];

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

  const res = await ApiProxy.request(`${KN_SERVICE_BASE}/namespaces/${namespace}/services`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return KnativeServiceSchema.parse(res);
}

export async function listRevisions(
  namespace: string,
  serviceName: string
): Promise<KnativeRevision[]> {
  const label = encodeURIComponent(`serving.knative.dev/service=${serviceName}`);
  const res = KnativeRevisionListSchema.parse(
    await ApiProxy.request(
      `${KN_SERVICE_BASE}/namespaces/${namespace}/revisions?labelSelector=${label}`,
      { method: 'GET' }
    )
  );
  return res.items ?? [];
}

export async function listDomainMappings(): Promise<DomainMapping[]> {
  const res = DomainMappingListSchema.parse(
    await ApiProxy.request(`${KN_DOMAIN_MAPPING_BASE}/domainmappings`, {
      method: 'GET',
    })
  );
  return res.items ?? [];
}

export async function createDomainMapping(params: {
  namespace: string;
  domain: string;
  serviceName: string;
  serviceNamespace?: string;
}): Promise<DomainMapping> {
  const { namespace, domain, serviceName, serviceNamespace } = params;
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
  const res = await ApiProxy.request(
    `${KN_DOMAIN_MAPPING_BASE}/namespaces/${namespace}/domainmappings`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
  return DomainMappingSchema.parse(res);
}

export async function createClusterDomainClaim(
  domain: string,
  namespace: string
): Promise<ClusterDomainClaim> {
  const body: ClusterDomainClaim = {
    apiVersion: 'networking.internal.knative.dev/v1alpha1',
    kind: 'ClusterDomainClaim',
    metadata: { name: domain },
    spec: { namespace },
  };
  const res = await ApiProxy.request(`${KN_CLUSTER_DOMAIN_CLAIM_BASE}/clusterdomainclaims`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return ClusterDomainClaimSchema.parse(res);
}

export async function getClusterDomainClaim(domain: string): Promise<ClusterDomainClaim | null> {
  try {
    const res = ClusterDomainClaimSchema.parse(
      await ApiProxy.request(`${KN_CLUSTER_DOMAIN_CLAIM_BASE}/clusterdomainclaims/${domain}`, {
        method: 'GET',
      })
    );
    return res ?? null;
  } catch (e) {
    // 404 or permission errors -> treat as not found for UI hinting
    return null;
  }
}

export async function deleteDomainMapping(namespace: string, domain: string): Promise<void> {
  const res = await ApiProxy.request(
    `${KN_DOMAIN_MAPPING_BASE}/namespaces/${namespace}/domainmappings/${domain}`,
    { method: 'DELETE' }
  );
  // Validate but ignore body.
  z.unknown().parse(res);
}

export async function annotateDomainMapping(
  namespace: string,
  domain: string,
  annotations: Record<string, string | null>
): Promise<DomainMapping> {
  const body = {
    metadata: {
      annotations,
    },
  };
  const res = await ApiProxy.request(
    `${KN_DOMAIN_MAPPING_BASE}/namespaces/${namespace}/domainmappings/${domain}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/merge-patch+json' },
      body: JSON.stringify(body),
    }
  );
  return DomainMappingSchema.parse(res);
}

export async function redeployService(namespace: string, name: string): Promise<void> {
  const now = new Date().toISOString();
  const res = await ApiProxy.request(
    `${KN_SERVICE_BASE}/namespaces/${namespace}/services/${name}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/merge-patch+json' },
      body: JSON.stringify({
        spec: {
          template: {
            metadata: {
              annotations: {
                'knative.headlamp.dev/redeployAt': now,
              },
            },
          },
        },
      }),
    }
  );
  // No useful body is expected; validate as unknown.
  z.unknown().parse(res);
}

async function findDeploymentNameForRevision(
  namespace: string,
  revisionName: string
): Promise<string> {
  const label = encodeURIComponent(`serving.knative.dev/revision=${revisionName}`);
  const res = DeploymentListSchema.parse(
    await ApiProxy.request(
      `/apis/apps/v1/namespaces/${namespace}/deployments?labelSelector=${label}`,
      { method: 'GET' }
    )
  );
  const dep = res.items?.[0];
  if (!dep?.metadata?.name) {
    throw new Error('Deployment for revision not found');
  }
  return dep.metadata.name;
}

export async function restartService(namespace: string, service: KnativeService): Promise<void> {
  const revisionName = service.status?.latestReadyRevisionName;
  if (!revisionName) {
    throw new Error('latestReadyRevisionName not found');
  }
  const depName = await findDeploymentNameForRevision(namespace, revisionName);
  const now = new Date().toISOString();
  const res = await ApiProxy.request(
    `/apis/apps/v1/namespaces/${namespace}/deployments/${depName}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/strategic-merge-patch+json' },
      body: JSON.stringify({
        spec: {
          template: {
            metadata: {
              annotations: {
                'kubectl.kubernetes.io/restartedAt': now,
              },
            },
          },
        },
      }),
    }
  );
  // No useful body is expected; validate as unknown.
  z.unknown().parse(res);
}

export async function updateTraffic(
  namespace: string,
  name: string,
  traffic: TrafficTarget[]
): Promise<KnativeService> {
  const res = await ApiProxy.request(
    `${KN_SERVICE_BASE}/namespaces/${namespace}/services/${name}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/merge-patch+json' },
      body: JSON.stringify({
        spec: {
          traffic,
        },
      }),
    }
  );
  return KnativeServiceSchema.parse(res);
}

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

export async function updateAutoscalingSettings(
  namespace: string,
  name: string,
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
  }
): Promise<KnativeService> {
  const annotationsPatch: Record<string, string | null> = {};
  if (params.metric !== undefined) {
    annotationsPatch['autoscaling.knative.dev/metric'] = params.metric ?? null;
  }
  if (params.target !== undefined) {
    annotationsPatch['autoscaling.knative.dev/target'] =
      params.target == null ? null : String(params.target);
  }
  if (params.targetUtilization !== undefined) {
    annotationsPatch['autoscaling.knative.dev/target-utilization-percentage'] =
      params.targetUtilization == null ? null : String(params.targetUtilization);
  }
  if (params.minScale !== undefined) {
    annotationsPatch['autoscaling.knative.dev/min-scale'] =
      params.minScale == null ? null : String(params.minScale);
  }
  if (params.maxScale !== undefined) {
    annotationsPatch['autoscaling.knative.dev/max-scale'] =
      params.maxScale == null ? null : String(params.maxScale);
  }
  if (params.initialScale !== undefined) {
    annotationsPatch['autoscaling.knative.dev/initial-scale'] =
      params.initialScale == null ? null : String(params.initialScale);
  }
  if (params.activationScale !== undefined) {
    annotationsPatch['autoscaling.knative.dev/activation-scale'] =
      params.activationScale == null ? null : String(params.activationScale);
  }
  if (params.scaleDownDelay !== undefined) {
    annotationsPatch['autoscaling.knative.dev/scale-down-delay'] =
      params.scaleDownDelay == null ? null : String(params.scaleDownDelay);
  }
  if (params.stableWindow !== undefined) {
    annotationsPatch['autoscaling.knative.dev/window'] =
      params.stableWindow == null ? null : String(params.stableWindow);
  }

  const templateSpecPatch: Record<string, unknown> = {};
  if (params.containerConcurrency !== undefined) {
    // null removes the field with merge patch
    templateSpecPatch['containerConcurrency'] = params.containerConcurrency as unknown as
      | number
      | null;
  }

  const body: any = { spec: { template: {} as any } };
  if (Object.keys(annotationsPatch).length > 0) {
    (body.spec.template as any).metadata = { annotations: annotationsPatch };
  }
  if (Object.keys(templateSpecPatch).length > 0) {
    (body.spec.template as any).spec = templateSpecPatch;
  }

  const res = await ApiProxy.request(
    `${KN_SERVICE_BASE}/namespaces/${namespace}/services/${name}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/merge-patch+json' },
      body: JSON.stringify(body),
    }
  );
  return KnativeServiceSchema.parse(res);
}

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

export async function fetchAutoscalingGlobalDefaults(): Promise<{
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
}> {
  const DOC_DEFAULTS = {
    concurrencyTarget: 100,
    targetUtilizationPercentage: 70,
    rpsTarget: 200,
    containerConcurrency: 0,
    minScale: 0, // depends on scale-to-zero; fall back to 0 as doc suggests when enabled
    maxScale: 0,
    initialScale: 1,
    scaleDownDelay: '0s',
    stableWindow: '60s',
    activationScaleDefault: 1,
  };
  let autoscaler: K8sConfigMap | undefined;
  let defaults: K8sConfigMap | undefined;
  try {
    autoscaler = K8sConfigMapSchema.parse(
      await ApiProxy.request(`/api/v1/namespaces/knative-serving/configmaps/config-autoscaler`, {
        method: 'GET',
      })
    );
  } catch {
    // ignore
  }
  try {
    defaults = K8sConfigMapSchema.parse(
      await ApiProxy.request(`/api/v1/namespaces/knative-serving/configmaps/config-defaults`, {
        method: 'GET',
      })
    );
  } catch {
    // ignore
  }
  const a = autoscaler?.data ?? {};
  const d = defaults?.data ?? {};
  const toNum = (v?: string, fallback?: number) => {
    if (v == null || v === '') return fallback as number;
    const n = Number(v);
    return Number.isFinite(n) ? n : (fallback as number);
  };
  return {
    concurrencyTarget: toNum(
      a['container-concurrency-target-default'],
      DOC_DEFAULTS.concurrencyTarget
    ),
    targetUtilizationPercentage: toNum(
      a['container-concurrency-target-percentage'],
      DOC_DEFAULTS.targetUtilizationPercentage
    ),
    rpsTarget: toNum(a['requests-per-second-target-default'], DOC_DEFAULTS.rpsTarget),
    containerConcurrency: toNum(d['container-concurrency'], DOC_DEFAULTS.containerConcurrency),
    minScale: toNum(a['min-scale'], DOC_DEFAULTS.minScale),
    maxScale: toNum(a['max-scale'], DOC_DEFAULTS.maxScale),
    maxScaleLimit:
      a['max-scale-limit'] != null
        ? toNum(a['max-scale-limit'], undefined as unknown as number)
        : undefined,
    initialScale: toNum(a['initial-scale'], DOC_DEFAULTS.initialScale),
    allowZeroInitialScale: String(a['allow-zero-initial-scale'] || '').toLowerCase() === 'true',
    scaleDownDelay: a['scale-down-delay'] || DOC_DEFAULTS.scaleDownDelay,
    stableWindow: a['stable-window'] || DOC_DEFAULTS.stableWindow,
    activationScaleDefault: DOC_DEFAULTS.activationScaleDefault,
  };
}

export async function fetchNetworkTemplates(): Promise<{
  domainTemplate: string;
  tagTemplate: string;
}> {
  const DEFAULTS = {
    domainTemplate: '{{.Name}}.{{.Namespace}}.{{.Domain}}',
    tagTemplate: '{{.Tag}}-{{.Name}}',
  };
  try {
    const cm = K8sConfigMapSchema.parse(
      await ApiProxy.request(`/api/v1/namespaces/knative-serving/configmaps/config-network`, {
        method: 'GET',
      })
    );
    const d = cm?.data ?? {};
    return {
      domainTemplate: d['domain-template'] || DEFAULTS.domainTemplate,
      tagTemplate: d['tag-template'] || DEFAULTS.tagTemplate,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

/**
 * Fetch the Knative ingress.class from the config-network ConfigMap.
 *
 * Returns the trimmed ingress.class string when it is set; otherwise null.
 * When the ConfigMap cannot be read (for example, due to RBAC), this also
 * returns null so that callers do not rely on null vs undefined semantics.
 */
export async function fetchIngressClass(): Promise<string | null> {
  try {
    const cm = K8sConfigMapSchema.parse(
      await ApiProxy.request(`/api/v1/namespaces/knative-serving/configmaps/config-network`, {
        method: 'GET',
      })
    );
    const raw = cm?.data?.['ingress.class'];
    if (raw == null) {
      return null;
    }
    const trimmed = raw.trim();
    return trimmed === '' ? null : trimmed;
  } catch {
    // Treat unreadable config as "not configured" from the caller's perspective.
    return null;
  }
}

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

const GatewayClassSchema = z.object({
  spec: z.object({
    controllerName: z.string(),
  }),
});

type GatewayClass = z.infer<typeof GatewayClassSchema>;

async function getGatewayClassControllerName(className: string): Promise<string | undefined> {
  if (!className) {
    return undefined;
  }
  try {
    const res = GatewayClassSchema.parse(
      await ApiProxy.request(`/apis/gateway.networking.k8s.io/v1/gatewayclasses/${className}`, {
        method: 'GET',
      })
    ) as GatewayClass;
    const controllerName = res.spec?.controllerName;
    const trimmed = controllerName?.trim();
    return trimmed ? trimmed : undefined;
  } catch {
    // If the GatewayClass cannot be fetched or parsed, treat controllerName as unknown.
    return undefined;
  }
}

/**
 * Fetch Gateway API configuration from the config-gateway ConfigMap.
 *
 * Returns gateway information for external and local gateways when Gateway API is configured;
 * otherwise returns null for both.
 */
export async function fetchGatewayConfig(): Promise<GatewayConfigResult> {
  try {
    const cm = ConfigGatewaySchema.parse(
      await ApiProxy.request(`/api/v1/namespaces/knative-serving/configmaps/config-gateway`, {
        method: 'GET',
      })
    );

    const data = cm.data;
    const externalConfig = data?.['external-gateways'] ?? null;
    const localConfig = data?.['local-gateways'] ?? null;

    const [externalControllerName, localControllerName] = await Promise.all([
      externalConfig?.class ? getGatewayClassControllerName(externalConfig.class) : undefined,
      localConfig?.class ? getGatewayClassControllerName(localConfig.class) : undefined,
    ]);

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

    return {
      external: applyControllerName(externalConfig, externalControllerName),
      local: applyControllerName(localConfig, localControllerName),
    };
  } catch {
    // Treat unreadable config as "not configured"
    return { external: null, local: null };
  }
}
