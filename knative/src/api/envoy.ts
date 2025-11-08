import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';

// Minimal types for HTTPRoute and SecurityPolicy we need
export type HTTPRoute = {
  apiVersion?: string;
  kind?: string;
  metadata: { name: string; namespace?: string; labels?: Record<string, string> };
  spec?: { hostnames?: string[] };
};

type SecurityPolicy = {
  apiVersion?: string;
  kind?: string;
  metadata: { name: string; namespace?: string };
  spec?: {
    targetRefs?: Array<{ group?: string; kind?: string; name?: string }>;
    basicAuth?: { users?: { name?: string } };
    apiKeyAuth?: {
      credentialRefs?: Array<{ group?: string; kind?: string; name?: string }>;
      extractFrom?: Array<{
        headers?: string[];
        queryParameters?: string[];
        cookies?: string[];
      }>;
    };
    jwt?: any;
    authorization?: any;
  };
};

type BackendTrafficPolicy = {
  apiVersion?: string;
  kind?: string;
  metadata: { name: string; namespace?: string };
  spec?: {
    targetRefs?: Array<{ group?: string; kind?: string; name?: string }>;
    retry?: {
      numRetries?: number;
      perRetry?: {
        backOff?: {
          baseInterval?: string; // e.g., "100ms"
          maxInterval?: string; // e.g., "10s"
        };
        timeout?: string; // e.g., "250ms"
      };
      retryOn?: {
        httpStatusCodes?: number[];
        triggers?: string[];
      };
    };
  };
};

type K8sList<T> = { items?: T[] };

// ---- HTTPRoute hostnames listing for external visibility ("") ----

/**
 * List all HTTPRoute hostnames for a given Knative Service that are externally visible.
 * External is defined as: metadata.labels['networking.knative.dev/visibility'] === '' (empty string).
 */
export async function listHttpRoutesByVisibilityForService(
  namespace: string,
  serviceName: string
): Promise<{ external: HTTPRoute[]; internal: HTTPRoute[] }> {
  try {
    const labelSelector1 = encodeURIComponent(`serving.knative.dev/service=${serviceName}`);
    const labelSelector2 = encodeURIComponent(`serving.knative.dev/route=${serviceName}`);
    const [res1, res2] = (await Promise.all([
      ApiProxy.request(
        `/apis/gateway.networking.k8s.io/v1/namespaces/${namespace}/httproutes?labelSelector=${labelSelector1}`,
        { method: 'GET' }
      ),
      ApiProxy.request(
        `/apis/gateway.networking.k8s.io/v1/namespaces/${namespace}/httproutes?labelSelector=${labelSelector2}`,
        { method: 'GET' }
      ),
    ])) as [K8sList<HTTPRoute>, K8sList<HTTPRoute>];
    const mergedByName = new Map<string, HTTPRoute>();
    [...(res1.items ?? []), ...(res2.items ?? [])].forEach(r => {
      if (r?.metadata?.name) mergedByName.set(r.metadata.name, r);
    });
    const all = Array.from(mergedByName.values());
    const external = all.filter(
      r => (r.metadata?.labels ?? {})['networking.knative.dev/visibility'] === ''
    );
    const internal = all.filter(
      r => (r.metadata?.labels ?? {})['networking.knative.dev/visibility'] === 'cluster-local'
    );
    return { external, internal };
  } catch {
    return { external: [], internal: [] };
  }
}
