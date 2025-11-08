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

function base64Encode(bytes: Uint8Array): string {
  // Convert to binary string then btoa
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  // btoa expects binary string
  return typeof btoa === 'function' ? btoa(bin) : Buffer.from(bytes).toString('base64');
}

async function sha1Base64(input: string): Promise<string> {
  const enc = new TextEncoder();
  const data = enc.encode(input);
  if (typeof crypto !== 'undefined' && crypto.subtle && crypto.subtle.digest) {
    const digest = await crypto.subtle.digest('SHA-1', data);
    return base64Encode(new Uint8Array(digest));
  }
  // Fallback for environments without SubtleCrypto
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const nodeCrypto = require('crypto') as typeof import('crypto');
  const hash = nodeCrypto.createHash('sha1').update(Buffer.from(data)).digest();
  return hash.toString('base64');
}

async function buildHtpasswdLine(username: string, password: string): Promise<string> {
  const b64 = await sha1Base64(password);
  // htpasswd -s format: {SHA}base64(sha1(password))
  return `${username}:{SHA}${b64}`;
}

export async function getHttpRoute(namespace: string, name: string): Promise<HTTPRoute | null> {
  try {
    return (await ApiProxy.request(
      `/apis/gateway.networking.k8s.io/v1/namespaces/${namespace}/httproutes/${name}`,
      { method: 'GET' }
    )) as HTTPRoute;
  } catch {
    return null;
  }
}

async function getHttpRouteForHost(namespace: string, host: string): Promise<HTTPRoute | null> {
  // Try direct by name first
  try {
    const route = (await ApiProxy.request(
      `/apis/gateway.networking.k8s.io/v1/namespaces/${namespace}/httproutes/${host}`,
      { method: 'GET' }
    )) as HTTPRoute;
    if (route?.metadata?.name) return route;
  } catch {
    // ignore and fallback to list
  }
  try {
    const res = (await ApiProxy.request(
      `/apis/gateway.networking.k8s.io/v1/namespaces/${namespace}/httproutes`,
      { method: 'GET' }
    )) as K8sList<HTTPRoute>;
    const items = res.items ?? [];
    return (
      items.find(r => r?.spec?.hostnames?.includes(host)) ||
      items.find(r => r.metadata?.name === host) ||
      null
    );
  } catch {
    return null;
  }
}

async function findSecurityPolicyForHTTPRoute(
  namespace: string,
  httpRouteName: string
): Promise<SecurityPolicy | null> {
  try {
    const res = (await ApiProxy.request(
      `/apis/gateway.envoyproxy.io/v1alpha1/namespaces/${namespace}/securitypolicies`,
      { method: 'GET' }
    )) as K8sList<SecurityPolicy>;
    const items = res.items ?? [];
    return (
      items.find(sp =>
        (sp.spec?.targetRefs ?? []).some(
          t =>
            (t.group ?? '') === 'gateway.networking.k8s.io' &&
            (t.kind ?? '') === 'HTTPRoute' &&
            (t.name ?? '') === httpRouteName
        )
      ) || null
    );
  } catch {
    return null;
  }
}

export async function getSecret(namespace: string, name: string): Promise<any | null> {
  try {
    return (await ApiProxy.request(`/api/v1/namespaces/${namespace}/secrets/${name}`, {
      method: 'GET',
    })) as any;
  } catch {
    return null;
  }
}

export async function upsertBasicAuthSecret(
  namespace: string,
  name: string,
  username: string,
  password: string
): Promise<void> {
  const line = await buildHtpasswdLine(username, password);
  const fileContent = `${line}\n`;
  const dataB64 =
    typeof btoa === 'function'
      ? btoa(fileContent)
      : Buffer.from(fileContent, 'utf8').toString('base64');
  const existing = await getSecret(namespace, name);
  if (!existing) {
    const body = {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: { name, namespace },
      type: 'Opaque',
      data: { '.htpasswd': dataB64 },
    };
    await ApiProxy.request(`/api/v1/namespaces/${namespace}/secrets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } else {
    const patch = {
      data: { '.htpasswd': dataB64 },
      type: 'Opaque',
    };
    await ApiProxy.request(`/api/v1/namespaces/${namespace}/secrets/${name}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/merge-patch+json' },
      body: JSON.stringify(patch),
    });
  }
}

async function readHtpasswdUsernamesFromSecret(namespace: string, name: string): Promise<string[]> {
  const sec = await getSecret(namespace, name);
  if (!sec?.data?.['.htpasswd']) return [];
  try {
    const decoded =
      typeof atob === 'function'
        ? atob(sec.data['.htpasswd'])
        : Buffer.from(sec.data['.htpasswd'], 'base64').toString('utf8');
    const lines = decoded.split(/\r?\n/).filter(Boolean);
    const users: string[] = [];
    for (const l of lines) {
      const idx = l.indexOf(':');
      if (idx > 0) users.push(l.slice(0, idx));
    }
    return users;
  } catch {
    return [];
  }
}

export async function createSecurityPolicyForHTTPRoute(params: {
  namespace: string;
  policyName: string;
  httpRouteName: string;
  secretName: string;
}): Promise<SecurityPolicy> {
  const body: SecurityPolicy = {
    apiVersion: 'gateway.envoyproxy.io/v1alpha1',
    kind: 'SecurityPolicy',
    metadata: { name: params.policyName, namespace: params.namespace },
    spec: {
      targetRefs: [
        {
          group: 'gateway.networking.k8s.io',
          kind: 'HTTPRoute',
          name: params.httpRouteName,
        },
      ],
      basicAuth: {
        users: {
          name: params.secretName,
        },
      },
    },
  };
  return (await ApiProxy.request(
    `/apis/gateway.envoyproxy.io/v1alpha1/namespaces/${params.namespace}/securitypolicies`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  )) as SecurityPolicy;
}

export async function detectBasicAuthConfig(
  namespace: string,
  host: string
): Promise<{
  httpRoute: HTTPRoute | null;
  securityPolicy: SecurityPolicy | null;
  secretName: string | null;
  usernames: string[];
}> {
  const httpRoute = await getHttpRouteForHost(namespace, host);
  if (!httpRoute) {
    return { httpRoute: null, securityPolicy: null, secretName: null, usernames: [] };
  }
  const sp = await findSecurityPolicyForHTTPRoute(namespace, httpRoute.metadata.name);
  const secretName = sp?.spec?.basicAuth?.users?.name ?? null;
  const usernames = secretName ? await readHtpasswdUsernamesFromSecret(namespace, secretName) : [];
  return { httpRoute, securityPolicy: sp, secretName, usernames };
}

// ---- API Key Authentication helpers ----

export async function upsertOpaqueKeyValueSecret(
  namespace: string,
  name: string,
  kv: Record<string, string>
): Promise<void> {
  const existing = await getSecret(namespace, name);
  const data: Record<string, string> = {};
  for (const [k, v] of Object.entries(kv)) {
    const b64 = typeof btoa === 'function' ? btoa(v) : Buffer.from(v, 'utf8').toString('base64');
    data[k] = b64;
  }
  if (!existing) {
    const body = {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: { name, namespace },
      type: 'Opaque',
      data,
    };
    await ApiProxy.request(`/api/v1/namespaces/${namespace}/secrets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } else {
    const patch = {
      data,
      type: 'Opaque',
    };
    await ApiProxy.request(`/api/v1/namespaces/${namespace}/secrets/${name}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/merge-patch+json' },
      body: JSON.stringify(patch),
    });
  }
}

export async function createApiKeySecurityPolicy(params: {
  namespace: string;
  policyName: string;
  httpRouteName: string;
  secretName: string;
  headerName: string;
}): Promise<SecurityPolicy> {
  const body: SecurityPolicy = {
    apiVersion: 'gateway.envoyproxy.io/v1alpha1',
    kind: 'SecurityPolicy',
    metadata: { name: params.policyName, namespace: params.namespace },
    spec: {
      targetRefs: [
        {
          group: 'gateway.networking.k8s.io',
          kind: 'HTTPRoute',
          name: params.httpRouteName,
        },
      ],
      apiKeyAuth: {
        credentialRefs: [
          {
            group: '',
            kind: 'Secret',
            name: params.secretName,
          },
        ],
        extractFrom: [
          {
            headers: [params.headerName],
          },
        ],
      },
    },
  };
  return (await ApiProxy.request(
    `/apis/gateway.envoyproxy.io/v1alpha1/namespaces/${params.namespace}/securitypolicies`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  )) as SecurityPolicy;
}

export async function updateApiKeySecurityPolicyExtractFrom(params: {
  namespace: string;
  policyName: string;
  headerName: string;
}): Promise<void> {
  const patch = {
    spec: {
      apiKeyAuth: {
        extractFrom: [
          {
            headers: [params.headerName],
          },
        ],
      },
    },
  };
  await ApiProxy.request(
    `/apis/gateway.envoyproxy.io/v1alpha1/namespaces/${params.namespace}/securitypolicies/${params.policyName}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/merge-patch+json' },
      body: JSON.stringify(patch),
    }
  );
}

export async function detectApiKeyAuthConfig(
  namespace: string,
  host: string
): Promise<{
  httpRoute: HTTPRoute | null;
  securityPolicy: SecurityPolicy | null;
  secretNames: string[];
  headerName: string | null;
}> {
  const httpRoute = await getHttpRouteForHost(namespace, host);
  if (!httpRoute) {
    return { httpRoute: null, securityPolicy: null, secretNames: [], headerName: null };
  }
  const sp = await findSecurityPolicyForHTTPRoute(namespace, httpRoute.metadata.name);
  const secretNames = sp?.spec?.apiKeyAuth?.credentialRefs?.map(r => r?.name).filter(Boolean) ?? [];
  const headerName = sp?.spec?.apiKeyAuth?.extractFrom?.[0]?.headers?.[0] ?? null;
  return { httpRoute, securityPolicy: sp ?? null, secretNames, headerName };
}

// ---- Retry (BackendTrafficPolicy) helpers ----

async function findBackendTrafficPolicyForHTTPRoute(
  namespace: string,
  httpRouteName: string
): Promise<BackendTrafficPolicy | null> {
  try {
    const res = (await ApiProxy.request(
      `/apis/gateway.envoyproxy.io/v1alpha1/namespaces/${namespace}/backendtrafficpolicies`,
      { method: 'GET' }
    )) as K8sList<BackendTrafficPolicy>;
    const items = res.items ?? [];
    return (
      items.find(btp =>
        (btp.spec?.targetRefs ?? []).some(
          t =>
            (t.group ?? '') === 'gateway.networking.k8s.io' &&
            (t.kind ?? '') === 'HTTPRoute' &&
            (t.name ?? '') === httpRouteName
        )
      ) || null
    );
  } catch {
    return null;
  }
}

export async function createRetryBackendTrafficPolicy(params: {
  namespace: string;
  policyName: string;
  httpRouteName: string;
  numRetries: number;
  baseInterval?: string;
  maxInterval?: string;
  timeout?: string;
  httpStatusCodes?: number[];
  triggers?: string[];
}): Promise<BackendTrafficPolicy> {
  const body: BackendTrafficPolicy = {
    apiVersion: 'gateway.envoyproxy.io/v1alpha1',
    kind: 'BackendTrafficPolicy',
    metadata: { name: params.policyName, namespace: params.namespace },
    spec: {
      targetRefs: [
        { group: 'gateway.networking.k8s.io', kind: 'HTTPRoute', name: params.httpRouteName },
      ],
      retry: {
        numRetries: params.numRetries,
        perRetry: {
          backOff: {
            baseInterval: params.baseInterval || '100ms',
            maxInterval: params.maxInterval || '10s',
          },
          timeout: params.timeout || '250ms',
        },
        retryOn: {
          httpStatusCodes:
            params.httpStatusCodes && params.httpStatusCodes.length
              ? params.httpStatusCodes
              : [500],
          triggers:
            params.triggers && params.triggers.length
              ? params.triggers
              : ['connect-failure', 'retriable-status-codes'],
        },
      },
    },
  };
  return (await ApiProxy.request(
    `/apis/gateway.envoyproxy.io/v1alpha1/namespaces/${params.namespace}/backendtrafficpolicies`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  )) as BackendTrafficPolicy;
}

export async function updateRetryBackendTrafficPolicy(params: {
  namespace: string;
  policyName: string;
  numRetries: number;
  baseInterval?: string;
  maxInterval?: string;
  timeout?: string;
  httpStatusCodes?: number[];
  triggers?: string[];
}): Promise<void> {
  const patch = {
    spec: {
      retry: {
        numRetries: params.numRetries,
        perRetry: {
          backOff: {
            baseInterval: params.baseInterval || '100ms',
            maxInterval: params.maxInterval || '10s',
          },
          timeout: params.timeout || '250ms',
        },
        retryOn: {
          httpStatusCodes:
            params.httpStatusCodes && params.httpStatusCodes.length
              ? params.httpStatusCodes
              : [500],
          triggers:
            params.triggers && params.triggers.length
              ? params.triggers
              : ['connect-failure', 'retriable-status-codes'],
        },
      },
    },
  };
  await ApiProxy.request(
    `/apis/gateway.envoyproxy.io/v1alpha1/namespaces/${params.namespace}/backendtrafficpolicies/${params.policyName}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/merge-patch+json' },
      body: JSON.stringify(patch),
    }
  );
}

export async function detectRetryConfig(
  namespace: string,
  host: string
): Promise<{
  httpRoute: HTTPRoute | null;
  backendTrafficPolicy: BackendTrafficPolicy | null;
  numRetries: number | null;
  baseInterval: string | null;
  maxInterval: string | null;
  timeout: string | null;
  httpStatusCodes: number[];
  triggers: string[];
}> {
  const httpRoute = await getHttpRouteForHost(namespace, host);
  if (!httpRoute) {
    return {
      httpRoute: null,
      backendTrafficPolicy: null,
      numRetries: null,
      baseInterval: null,
      maxInterval: null,
      timeout: null,
      httpStatusCodes: [],
      triggers: [],
    };
  }
  const btp = await findBackendTrafficPolicyForHTTPRoute(namespace, httpRoute.metadata.name);
  const retry = btp?.spec?.retry;
  return {
    httpRoute,
    backendTrafficPolicy: btp,
    numRetries: retry?.numRetries ?? null,
    baseInterval: retry?.perRetry?.backOff?.baseInterval ?? null,
    maxInterval: retry?.perRetry?.backOff?.maxInterval ?? null,
    timeout: retry?.perRetry?.timeout ?? null,
    httpStatusCodes: retry?.retryOn?.httpStatusCodes ?? [],
    triggers: retry?.retryOn?.triggers ?? [],
  };
}

// ---- IP Access Control (SecurityPolicy.authorization) helpers ----

function buildAuthorizationRules(allowCidrs: string[], denyCidrs: string[]) {
  const rules: any[] = [];
  if (allowCidrs?.length) {
    rules.push({
      name: 'allow-source-ips',
      match: { sourceIPs: allowCidrs },
      action: 'Allow',
    });
  }
  if (denyCidrs?.length) {
    rules.push({
      name: 'deny-source-ips',
      match: { sourceIPs: denyCidrs },
      action: 'Deny',
    });
  }
  return { authorization: { rules } };
}

export async function detectIpAccessConfig(
  namespace: string,
  host: string
): Promise<{
  httpRoute: HTTPRoute | null;
  securityPolicy: SecurityPolicy | null;
  allowCidrs: string[];
  denyCidrs: string[];
}> {
  const httpRoute = await getHttpRouteForHost(namespace, host);
  if (!httpRoute) {
    return { httpRoute: null, securityPolicy: null, allowCidrs: [], denyCidrs: [] };
  }
  const sp = await findSecurityPolicyForHTTPRoute(namespace, httpRoute.metadata.name);
  const rules: any[] = (sp as any)?.spec?.authorization?.rules ?? [];
  const allowCidrs =
    rules
      ?.filter(r => String(r?.action) === 'Allow')
      ?.flatMap(r => r?.match?.sourceIPs || [])
      ?.filter(Boolean) ?? [];
  const denyCidrs =
    rules
      ?.filter(r => String(r?.action) === 'Deny')
      ?.flatMap(r => r?.match?.sourceIPs || [])
      ?.filter(Boolean) ?? [];
  return { httpRoute, securityPolicy: sp ?? null, allowCidrs, denyCidrs };
}

export async function createIpAccessSecurityPolicy(params: {
  namespace: string;
  policyName: string;
  httpRouteName: string;
  allowCidrs: string[];
  denyCidrs: string[];
}): Promise<SecurityPolicy> {
  const body: SecurityPolicy = {
    apiVersion: 'gateway.envoyproxy.io/v1alpha1',
    kind: 'SecurityPolicy',
    metadata: { name: params.policyName, namespace: params.namespace },
    spec: {
      targetRefs: [
        {
          group: 'gateway.networking.k8s.io',
          kind: 'HTTPRoute',
          name: params.httpRouteName,
        },
      ],
      ...buildAuthorizationRules(params.allowCidrs || [], params.denyCidrs || []),
    },
  };
  return (await ApiProxy.request(
    `/apis/gateway.envoyproxy.io/v1alpha1/namespaces/${params.namespace}/securitypolicies`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  )) as SecurityPolicy;
}

export async function updateIpAccessSecurityPolicy(params: {
  namespace: string;
  policyName: string;
  allowCidrs: string[];
  denyCidrs: string[];
}): Promise<void> {
  const patch = {
    spec: {
      ...buildAuthorizationRules(params.allowCidrs || [], params.denyCidrs || []),
    },
  };
  await ApiProxy.request(
    `/apis/gateway.envoyproxy.io/v1alpha1/namespaces/${params.namespace}/securitypolicies/${params.policyName}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/merge-patch+json' },
      body: JSON.stringify(patch),
    }
  );
}

// ---- HTTPRoute List (cluster-wide) ----
export async function listAllHttpRoutes(): Promise<HTTPRoute[]> {
  try {
    const res = (await ApiProxy.request(`/apis/gateway.networking.k8s.io/v1/httproutes`, {
      method: 'GET',
    })) as K8sList<HTTPRoute>;
    return res.items ?? [];
  } catch {
    return [];
  }
}
