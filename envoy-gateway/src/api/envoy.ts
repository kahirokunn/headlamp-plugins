import * as ApiProxy from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import * as z from 'zod/mini';

const ObjectMetaSchema = z.object({
  name: z.string(),
  namespace: z.optional(z.string()),
  uid: z.optional(z.string()),
  labels: z.optional(z.record(z.string(), z.string())),
});

const HTTPRouteBackendRefSchema = z.object({
  group: z.optional(z.string()),
  kind: z.optional(z.string()),
  name: z.optional(z.string()),
  namespace: z.optional(z.string()),
  port: z.optional(z.number()),
});

const HTTPRouteRuleSchema = z.object({
  backendRefs: z.optional(z.array(HTTPRouteBackendRefSchema)),
});

const HTTPRouteSpecSchema = z.object({
  hostnames: z.optional(z.array(z.string())),
  rules: z.optional(z.array(HTTPRouteRuleSchema)),
});

export const HTTPRouteSchema = z.object({
  apiVersion: z.optional(z.string()),
  kind: z.optional(z.string()),
  metadata: ObjectMetaSchema,
  spec: z.optional(HTTPRouteSpecSchema),
});

export type HTTPRoute = z.infer<typeof HTTPRouteSchema>;

const OwnerReferenceSchema = z.object({
  apiVersion: z.string(),
  kind: z.string(),
  name: z.string(),
  uid: z.string(),
  controller: z.optional(z.boolean()),
  blockOwnerDeletion: z.optional(z.boolean()),
});

type OwnerReference = z.infer<typeof OwnerReferenceSchema>;

const SecurityPolicySpecSchema = z.object({
  targetRefs: z.optional(
    z.array(
      z.object({
        group: z.optional(z.string()),
        kind: z.optional(z.string()),
        name: z.optional(z.string()),
      })
    )
  ),
  basicAuth: z.optional(
    z.object({
      users: z.optional(
        z.object({
          name: z.optional(z.string()),
        })
      ),
    })
  ),
  apiKeyAuth: z.optional(
    z.object({
      credentialRefs: z.optional(
        z.array(
          z.object({
            group: z.optional(z.string()),
            kind: z.optional(z.string()),
            name: z.optional(z.string()),
          })
        )
      ),
      extractFrom: z.optional(
        z.array(
          z.object({
            headers: z.optional(z.array(z.string())),
            queryParameters: z.optional(z.array(z.string())),
            cookies: z.optional(z.array(z.string())),
          })
        )
      ),
    })
  ),
  jwt: z.optional(z.unknown()),
  authorization: z.optional(z.unknown()),
});

const SecurityPolicySchema = z.object({
  apiVersion: z.optional(z.string()),
  kind: z.optional(z.string()),
  metadata: z.object({
    name: z.string(),
    namespace: z.optional(z.string()),
    ownerReferences: z.optional(z.array(OwnerReferenceSchema)),
  }),
  spec: z.optional(SecurityPolicySpecSchema),
});

type SecurityPolicy = z.infer<typeof SecurityPolicySchema>;

const SecurityPolicyListSchema = z.object({
  items: z.optional(z.array(SecurityPolicySchema)),
});

const BackendTrafficPolicySpecSchema = z.object({
  targetRefs: z.optional(
    z.array(
      z.object({
        group: z.optional(z.string()),
        kind: z.optional(z.string()),
        name: z.optional(z.string()),
      })
    )
  ),
  retry: z.optional(
    z.object({
      numRetries: z.optional(z.number()),
      perRetry: z.optional(
        z.object({
          backOff: z.optional(
            z.object({
              baseInterval: z.optional(z.string()),
              maxInterval: z.optional(z.string()),
            })
          ),
          timeout: z.optional(z.string()),
        })
      ),
      retryOn: z.optional(
        z.object({
          httpStatusCodes: z.optional(z.array(z.number())),
          triggers: z.optional(z.array(z.string())),
        })
      ),
    })
  ),
});

const BackendTrafficPolicySchema = z.object({
  apiVersion: z.optional(z.string()),
  kind: z.optional(z.string()),
  metadata: z.object({
    name: z.string(),
    namespace: z.optional(z.string()),
    ownerReferences: z.optional(z.array(OwnerReferenceSchema)),
  }),
  spec: z.optional(BackendTrafficPolicySpecSchema),
});

type BackendTrafficPolicy = z.infer<typeof BackendTrafficPolicySchema>;

const BackendTrafficPolicyListSchema = z.object({
  items: z.optional(z.array(BackendTrafficPolicySchema)),
});

const K8sSecretSchema = z.object({
  metadata: z.optional(
    z.object({
      name: z.optional(z.string()),
      namespace: z.optional(z.string()),
      uid: z.optional(z.string()),
      labels: z.optional(z.record(z.string(), z.string())),
    })
  ),
  data: z.optional(z.record(z.string(), z.string())),
  type: z.optional(z.string()),
});

type K8sSecret = z.infer<typeof K8sSecretSchema>;

const HTTPRouteListSchema = z.object({
  items: z.optional(z.array(HTTPRouteSchema)),
});

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

async function buildHttpRouteOwnerRef(
  namespace: string,
  httpRouteName: string
): Promise<OwnerReference | null> {
  const route = await getHttpRoute(namespace, httpRouteName);
  if (!route) return null;
  return {
    apiVersion: route.apiVersion || 'gateway.networking.k8s.io/v1',
    kind: route.kind || 'HTTPRoute',
    name: route.metadata.name,
    uid: route.metadata.uid || '',
    blockOwnerDeletion: true,
  };
}

export async function getHttpRoute(namespace: string, name: string): Promise<HTTPRoute | null> {
  try {
    return HTTPRouteSchema.parse(
      await ApiProxy.request(
        `/apis/gateway.networking.k8s.io/v1/namespaces/${namespace}/httproutes/${name}`,
        { method: 'GET' }
      )
    );
  } catch {
    return null;
  }
}

async function getHttpRouteForHost(namespace: string, host: string): Promise<HTTPRoute | null> {
  // Try direct by name first
  try {
    const route = HTTPRouteSchema.parse(
      await ApiProxy.request(
        `/apis/gateway.networking.k8s.io/v1/namespaces/${namespace}/httproutes/${host}`,
        { method: 'GET' }
      )
    );
    if (route?.metadata?.name) return route;
  } catch {
    // ignore and fallback to list
  }
  try {
    const res = HTTPRouteListSchema.parse(
      await ApiProxy.request(
        `/apis/gateway.networking.k8s.io/v1/namespaces/${namespace}/httproutes`,
        { method: 'GET' }
      )
    );
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
    const res = SecurityPolicyListSchema.parse(
      await ApiProxy.request(
        `/apis/gateway.envoyproxy.io/v1alpha1/namespaces/${namespace}/securitypolicies`,
        { method: 'GET' }
      )
    );
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

async function getSecret(namespace: string, name: string): Promise<K8sSecret | null> {
  try {
    return K8sSecretSchema.parse(
      await ApiProxy.request(`/api/v1/namespaces/${namespace}/secrets/${name}`, {
        method: 'GET',
      })
    );
  } catch {
    return null;
  }
}

type ApiResult = {
  isSuccess: boolean;
  errorMessage?: string;
};

export async function upsertBasicAuthSecret(
  namespace: string,
  name: string,
  username: string,
  password: string,
  ownerHttpRouteName?: string
): Promise<ApiResult> {
  try {
    const line = await buildHtpasswdLine(username, password);
    const fileContent = `${line}\n`;
    const dataB64 =
      typeof btoa === 'function'
        ? btoa(fileContent)
        : Buffer.from(fileContent, 'utf8').toString('base64');
    const existing = await getSecret(namespace, name);
    if (!existing) {
      const ownerRef = ownerHttpRouteName
        ? await buildHttpRouteOwnerRef(namespace, ownerHttpRouteName)
        : null;
      const body = {
        apiVersion: 'v1',
        kind: 'Secret',
        metadata: {
          name,
          namespace,
          ...(ownerRef ? { ownerReferences: [ownerRef] } : {}),
        },
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
    return { isSuccess: true };
  } catch (e) {
    const message = (e as Error)?.message?.trim();
    return { isSuccess: false, errorMessage: message };
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
  // If an existing SecurityPolicy exists, overwrite basicAuth; otherwise create a new one
  const existing = await findSecurityPolicyForHTTPRoute(params.namespace, params.httpRouteName);
  if (existing?.metadata?.name) {
    const patch = {
      spec: {
        basicAuth: {
          users: {
            name: params.secretName,
          },
        },
      },
    };
    await ApiProxy.request(
      `/apis/gateway.envoyproxy.io/v1alpha1/namespaces/${params.namespace}/securitypolicies/${existing.metadata.name}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/merge-patch+json' },
        body: JSON.stringify(patch),
      }
    );
    return SecurityPolicySchema.parse(
      await ApiProxy.request(
        `/apis/gateway.envoyproxy.io/v1alpha1/namespaces/${params.namespace}/securitypolicies/${existing.metadata.name}`,
        { method: 'GET' }
      )
    );
  }
  const ownerRef = await buildHttpRouteOwnerRef(params.namespace, params.httpRouteName);
  const body: SecurityPolicy = {
    apiVersion: 'gateway.envoyproxy.io/v1alpha1',
    kind: 'SecurityPolicy',
    metadata: {
      name: params.policyName,
      namespace: params.namespace,
      ...(ownerRef ? { ownerReferences: [ownerRef] } : {}),
    },
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
  return SecurityPolicySchema.parse(
    await ApiProxy.request(
      `/apis/gateway.envoyproxy.io/v1alpha1/namespaces/${params.namespace}/securitypolicies`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    )
  );
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

// ---- Retry (BackendTrafficPolicy) helpers ----

async function findBackendTrafficPolicyForHTTPRoute(
  namespace: string,
  httpRouteName: string
): Promise<BackendTrafficPolicy | null> {
  try {
    const res = BackendTrafficPolicyListSchema.parse(
      await ApiProxy.request(
        `/apis/gateway.envoyproxy.io/v1alpha1/namespaces/${namespace}/backendtrafficpolicies`,
        { method: 'GET' }
      )
    );
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
  const ownerRef = await buildHttpRouteOwnerRef(params.namespace, params.httpRouteName);
  const body: BackendTrafficPolicy = {
    apiVersion: 'gateway.envoyproxy.io/v1alpha1',
    kind: 'BackendTrafficPolicy',
    metadata: {
      name: params.policyName,
      namespace: params.namespace,
      ...(ownerRef ? { ownerReferences: [ownerRef] } : {}),
    },
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
  return BackendTrafficPolicySchema.parse(
    await ApiProxy.request(
      `/apis/gateway.envoyproxy.io/v1alpha1/namespaces/${params.namespace}/backendtrafficpolicies`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    )
  );
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
}): Promise<ApiResult> {
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
  try {
    await ApiProxy.request(
      `/apis/gateway.envoyproxy.io/v1alpha1/namespaces/${params.namespace}/backendtrafficpolicies/${params.policyName}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/merge-patch+json' },
        body: JSON.stringify(patch),
      }
    );
    return { isSuccess: true };
  } catch (e) {
    const message = (e as Error)?.message?.trim();
    return { isSuccess: false, errorMessage: message };
  }
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

function buildAuthorizationRules(allowCidrs: string[], denyCidrs: string[], forPatch = false) {
  const rules: any[] = [];
  if (allowCidrs?.length) {
    rules.push({
      name: 'allow-source-ips',
      principal: { clientCIDRs: allowCidrs },
      action: 'Allow',
    });
  }
  if (denyCidrs?.length) {
    rules.push({
      name: 'deny-source-ips',
      principal: { clientCIDRs: denyCidrs },
      action: 'Deny',
    });
  }
  if (rules.length === 0) {
    // For PATCH requests, explicitly set to null to remove the key (RFC7396).
    // For create (POST) bodies, omit the key entirely.
    return forPatch ? { authorization: null } : {};
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
  // Prefer a SecurityPolicy that actually has authorization rules for this HTTPRoute
  let sp: SecurityPolicy | null = null;
  try {
    const res = SecurityPolicyListSchema.parse(
      await ApiProxy.request(
        `/apis/gateway.envoyproxy.io/v1alpha1/namespaces/${namespace}/securitypolicies`,
        { method: 'GET' }
      )
    );
    const items = res.items ?? [];
    sp =
      items.find(
        p =>
          (p.spec?.targetRefs ?? []).some(
            t =>
              (t.group ?? '') === 'gateway.networking.k8s.io' &&
              (t.kind ?? '') === 'HTTPRoute' &&
              (t.name ?? '') === httpRoute.metadata.name
          ) && ((p as any)?.spec?.authorization?.rules ?? []).length > 0
      ) || null;
  } catch {
    sp = null;
  }
  const rules: any[] = (sp as any)?.spec?.authorization?.rules ?? [];
  const allowCidrs =
    rules
      ?.filter(r => String(r?.action) === 'Allow')
      ?.flatMap(r => r?.principal?.clientCIDRs || [])
      ?.filter(Boolean) ?? [];
  const denyCidrs =
    rules
      ?.filter(r => String(r?.action) === 'Deny')
      ?.flatMap(r => r?.principal?.clientCIDRs || [])
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
  // If an existing SecurityPolicy exists, overwrite authorization; otherwise create a new one
  const existing = await findSecurityPolicyForHTTPRoute(params.namespace, params.httpRouteName);
  if (existing?.metadata?.name) {
    const patch = {
      spec: {
        ...buildAuthorizationRules(params.allowCidrs || [], params.denyCidrs || [], true),
      },
    };
    await ApiProxy.request(
      `/apis/gateway.envoyproxy.io/v1alpha1/namespaces/${params.namespace}/securitypolicies/${existing.metadata.name}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/merge-patch+json' },
        body: JSON.stringify(patch),
      }
    );
    return SecurityPolicySchema.parse(
      await ApiProxy.request(
        `/apis/gateway.envoyproxy.io/v1alpha1/namespaces/${params.namespace}/securitypolicies/${existing.metadata.name}`,
        { method: 'GET' }
      )
    );
  }
  const ownerRef = await buildHttpRouteOwnerRef(params.namespace, params.httpRouteName);
  const body: SecurityPolicy = {
    apiVersion: 'gateway.envoyproxy.io/v1alpha1',
    kind: 'SecurityPolicy',
    metadata: {
      name: params.policyName,
      namespace: params.namespace,
      ...(ownerRef ? { ownerReferences: [ownerRef] } : {}),
    },
    spec: {
      targetRefs: [
        {
          group: 'gateway.networking.k8s.io',
          kind: 'HTTPRoute',
          name: params.httpRouteName,
        },
      ],
      ...buildAuthorizationRules(params.allowCidrs || [], params.denyCidrs || [], false),
    },
  };
  return SecurityPolicySchema.parse(
    await ApiProxy.request(
      `/apis/gateway.envoyproxy.io/v1alpha1/namespaces/${params.namespace}/securitypolicies`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    )
  );
}

export async function updateIpAccessSecurityPolicy(params: {
  namespace: string;
  policyName: string;
  allowCidrs: string[];
  denyCidrs: string[];
}): Promise<ApiResult> {
  const patch = {
    spec: {
      ...buildAuthorizationRules(params.allowCidrs || [], params.denyCidrs || [], true),
    },
  };
  try {
    await ApiProxy.request(
      `/apis/gateway.envoyproxy.io/v1alpha1/namespaces/${params.namespace}/securitypolicies/${params.policyName}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/merge-patch+json' },
        body: JSON.stringify(patch),
      }
    );
    return { isSuccess: true };
  } catch (e) {
    const message = (e as Error)?.message?.trim();
    return { isSuccess: false, errorMessage: message };
  }
}

// ---- Disable/Delete helpers ----

export async function disableBasicAuthForHTTPRoute(params: {
  namespace: string;
  httpRouteName: string;
}): Promise<ApiResult> {
  const existing = await findSecurityPolicyForHTTPRoute(params.namespace, params.httpRouteName);
  if (!existing?.metadata?.name) {
    return { isSuccess: true };
  }
  const patch = { spec: { basicAuth: null } };
  try {
    await ApiProxy.request(
      `/apis/gateway.envoyproxy.io/v1alpha1/namespaces/${params.namespace}/securitypolicies/${existing.metadata.name}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/merge-patch+json' },
        body: JSON.stringify(patch),
      }
    );
    return { isSuccess: true };
  } catch (e) {
    const message = (e as Error)?.message?.trim();
    return { isSuccess: false, errorMessage: message };
  }
}

export async function disableIpAccessSecurityPolicy(params: {
  namespace: string;
  policyName: string;
}): Promise<ApiResult> {
  const patch = { spec: { authorization: null } };
  try {
    await ApiProxy.request(
      `/apis/gateway.envoyproxy.io/v1alpha1/namespaces/${params.namespace}/securitypolicies/${params.policyName}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/merge-patch+json' },
        body: JSON.stringify(patch),
      }
    );
    return { isSuccess: true };
  } catch (e) {
    const message = (e as Error)?.message?.trim();
    return { isSuccess: false, errorMessage: message };
  }
}

export async function deleteRetryBackendTrafficPolicy(params: {
  namespace: string;
  policyName: string;
}): Promise<ApiResult> {
  try {
    await ApiProxy.request(
      `/apis/gateway.envoyproxy.io/v1alpha1/namespaces/${params.namespace}/backendtrafficpolicies/${params.policyName}`,
      {
        method: 'DELETE',
      }
    );
    return { isSuccess: true };
  } catch (e) {
    const message = (e as Error)?.message?.trim();
    return { isSuccess: false, errorMessage: message };
  }
}

export async function listAllHttpRoutes(): Promise<HTTPRoute[]> {
  try {
    const res = HTTPRouteListSchema.parse(
      await ApiProxy.request(`/apis/gateway.networking.k8s.io/v1/httproutes`, {
        method: 'GET',
      })
    );
    return res.items ?? [];
  } catch {
    return [];
  }
}
