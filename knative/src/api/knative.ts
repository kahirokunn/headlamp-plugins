import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import type {
  KnativeService,
  KnativeRevision,
  K8sList,
  TrafficTarget,
  DomainMapping,
  ClusterDomainClaim,
} from '../types/knative';

const KN_SERVICE_BASE = '/apis/serving.knative.dev/v1';
const KN_DOMAINMAPPING_BASE = '/apis/serving.knative.dev/v1beta1';
const KN_CLUSTERDOMAINCLAIM_BASE = '/apis/networking.internal.knative.dev/v1alpha1';

export async function listServices(): Promise<KnativeService[]> {
  const res = (await ApiProxy.request(`${KN_SERVICE_BASE}/services`, {
    method: 'GET',
  })) as K8sList<KnativeService>;
  return res.items ?? [];
}

export async function getService(namespace: string, name: string): Promise<KnativeService> {
  return (await ApiProxy.request(`${KN_SERVICE_BASE}/namespaces/${namespace}/services/${name}`, {
    method: 'GET',
  })) as KnativeService;
}

export async function listRevisions(
  namespace: string,
  serviceName: string
): Promise<KnativeRevision[]> {
  const label = encodeURIComponent(`serving.knative.dev/service=${serviceName}`);
  const res = (await ApiProxy.request(
    `${KN_SERVICE_BASE}/namespaces/${namespace}/revisions?labelSelector=${label}`,
    { method: 'GET' }
  )) as K8sList<KnativeRevision>;
  return res.items ?? [];
}

export async function listDomainMappings(): Promise<DomainMapping[]> {
  const res = (await ApiProxy.request(`${KN_DOMAINMAPPING_BASE}/domainmappings`, {
    method: 'GET',
  })) as K8sList<DomainMapping>;
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
  return (await ApiProxy.request(
    `${KN_DOMAINMAPPING_BASE}/namespaces/${namespace}/domainmappings`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  )) as DomainMapping;
}

export async function createClusterDomainClaim(domain: string, namespace: string): Promise<ClusterDomainClaim> {
  const body: ClusterDomainClaim = {
    apiVersion: 'networking.internal.knative.dev/v1alpha1',
    kind: 'ClusterDomainClaim',
    metadata: { name: domain },
    spec: { namespace },
  };
  return (await ApiProxy.request(`${KN_CLUSTERDOMAINCLAIM_BASE}/clusterdomainclaims`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })) as ClusterDomainClaim;
}

export async function getClusterDomainClaim(domain: string): Promise<ClusterDomainClaim | null> {
  try {
    const res = (await ApiProxy.request(
      `${KN_CLUSTERDOMAINCLAIM_BASE}/clusterdomainclaims/${domain}`,
      { method: 'GET' }
    )) as ClusterDomainClaim;
    return res ?? null;
  } catch (e) {
    // 404 or permission errors -> treat as not found for UI hinting
    return null;
  }
}

export async function deleteDomainMapping(namespace: string, domain: string): Promise<void> {
  await ApiProxy.request(
    `${KN_DOMAINMAPPING_BASE}/namespaces/${namespace}/domainmappings/${domain}`,
    { method: 'DELETE' }
  );
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
  return (await ApiProxy.request(
    `${KN_DOMAINMAPPING_BASE}/namespaces/${namespace}/domainmappings/${domain}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/merge-patch+json' },
      body: JSON.stringify(body),
    }
  )) as DomainMapping;
}

export async function redeployService(namespace: string, name: string): Promise<void> {
  const now = new Date().toISOString();
  await ApiProxy.request(`${KN_SERVICE_BASE}/namespaces/${namespace}/services/${name}`, {
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
  });
}

async function findDeploymentNameForRevision(
  namespace: string,
  revisionName: string
): Promise<string> {
  const label = encodeURIComponent(`serving.knative.dev/revision=${revisionName}`);
  const res = (await ApiProxy.request(
    `/apis/apps/v1/namespaces/${namespace}/deployments?labelSelector=${label}`,
    { method: 'GET' }
  )) as K8sList<{ metadata: { name: string } }>;
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
  await ApiProxy.request(`/apis/apps/v1/namespaces/${namespace}/deployments/${depName}`, {
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
  });
}

export async function updateTraffic(
  namespace: string,
  name: string,
  traffic: TrafficTarget[]
): Promise<KnativeService> {
  return (await ApiProxy.request(`${KN_SERVICE_BASE}/namespaces/${namespace}/services/${name}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/merge-patch+json' },
    body: JSON.stringify({
      spec: {
        traffic,
      },
    }),
  })) as KnativeService;
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

  return (await ApiProxy.request(`${KN_SERVICE_BASE}/namespaces/${namespace}/services/${name}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/merge-patch+json' },
    body: JSON.stringify(body),
  })) as KnativeService;
}

type K8sConfigMap = {
  metadata?: { name?: string; namespace?: string };
  data?: Record<string, string>;
};

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
    autoscaler = (await ApiProxy.request(
      `/api/v1/namespaces/knative-serving/configmaps/config-autoscaler`,
      { method: 'GET' }
    )) as K8sConfigMap;
  } catch {
    // ignore
  }
  try {
    defaults = (await ApiProxy.request(
      `/api/v1/namespaces/knative-serving/configmaps/config-defaults`,
      { method: 'GET' }
    )) as K8sConfigMap;
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
    const cm = (await ApiProxy.request(
      `/api/v1/namespaces/knative-serving/configmaps/config-network`,
      { method: 'GET' }
    )) as K8sConfigMap;
    const d = cm?.data ?? {};
    return {
      domainTemplate: d['domain-template'] || DEFAULTS.domainTemplate,
      tagTemplate: d['tag-template'] || DEFAULTS.tagTemplate,
    };
  } catch {
    return { ...DEFAULTS };
  }
}
