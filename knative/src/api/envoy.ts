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

const AuthorizationPrincipalSchema = z.object({
  clientCIDRs: z.optional(z.array(z.string())),
});

type AuthorizationPrincipal = z.infer<typeof AuthorizationPrincipalSchema>;

type AuthorizationRuleAction = 'Allow' | 'Deny';

const AuthorizationRuleSchema = z.object({
  name: z.optional(z.string()),
  principal: z.optional(AuthorizationPrincipalSchema),
  action: z.optional(z.string()),
});

type AuthorizationRule = z.infer<typeof AuthorizationRuleSchema>;

const AuthorizationSchema = z.object({
  rules: z.optional(z.array(AuthorizationRuleSchema)),
});

type Authorization = z.infer<typeof AuthorizationSchema>;

const SecurityPolicySchema = z.object({
  apiVersion: z.optional(z.string()),
  kind: z.optional(z.string()),
  metadata: z.object({
    name: z.string(),
    namespace: z.optional(z.string()),
    ownerReferences: z.optional(z.array(OwnerReferenceSchema)),
  }),
  spec: z.optional(
    z.object({
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
      authorization: z.optional(AuthorizationSchema),
    })
  ),
});

type SecurityPolicy = z.infer<typeof SecurityPolicySchema>;

const SecurityPolicyListSchema = z.object({
  items: z.optional(z.array(SecurityPolicySchema)),
});

const K8sSecretSchema = z.object({
  apiVersion: z.optional(z.string()),
  kind: z.optional(z.string()),
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
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
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
  return `${username}:{SHA}${b64}`;
}

async function getHttpRoute(namespace: string, name: string): Promise<HTTPRoute | null> {
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

export async function upsertBasicAuthSecret(
  namespace: string,
  name: string,
  username: string,
  password: string,
  ownerHttpRouteName?: string
): Promise<void> {
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

function buildAuthorizationRuleList(
  allowCidrs: string[],
  denyCidrs: string[]
): AuthorizationRule[] {
  const rules: AuthorizationRule[] = [];
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
    return [];
  }
  return rules;
}

function buildAuthorizationRulesForPatch(
  allowCidrs: string[],
  denyCidrs: string[]
): { authorization: Authorization | null } {
  const rules = buildAuthorizationRuleList(allowCidrs, denyCidrs);
  if (rules.length === 0) {
    return { authorization: null };
  }
  return { authorization: { rules } };
}

function buildAuthorizationRulesForSpec(
  allowCidrs: string[],
  denyCidrs: string[]
): { authorization?: Authorization } {
  const rules = buildAuthorizationRuleList(allowCidrs, denyCidrs);
  if (rules.length === 0) {
    return {};
  }
  return { authorization: { rules } };
}

export async function createSecurityPolicyForHTTPRoute(params: {
  namespace: string;
  policyName: string;
  httpRouteName: string;
  secretName: string;
}): Promise<SecurityPolicy> {
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

export async function createIpAccessSecurityPolicy(params: {
  namespace: string;
  policyName: string;
  httpRouteName: string;
  allowCidrs: string[];
  denyCidrs: string[];
}): Promise<SecurityPolicy> {
  const existing = await findSecurityPolicyForHTTPRoute(params.namespace, params.httpRouteName);
  if (existing?.metadata?.name) {
    const patch = {
      spec: {
        ...buildAuthorizationRulesForPatch(params.allowCidrs || [], params.denyCidrs || []),
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
      ...buildAuthorizationRulesForSpec(params.allowCidrs || [], params.denyCidrs || []),
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
    const labelSelectorDmNs = encodeURIComponent(
      `serving.knative.dev/domainMappingNamespace=${namespace}`
    );
    const [raw1, raw2, rawDm] = await Promise.all([
      ApiProxy.request(
        `/apis/gateway.networking.k8s.io/v1/namespaces/${namespace}/httproutes?labelSelector=${labelSelector1}`,
        { method: 'GET' }
      ),
      ApiProxy.request(
        `/apis/gateway.networking.k8s.io/v1/namespaces/${namespace}/httproutes?labelSelector=${labelSelector2}`,
        { method: 'GET' }
      ),
      ApiProxy.request(
        `/apis/gateway.networking.k8s.io/v1/namespaces/${namespace}/httproutes?labelSelector=${labelSelectorDmNs}`,
        { method: 'GET' }
      ),
    ]);
    const res1 = HTTPRouteListSchema.parse(raw1);
    const res2 = HTTPRouteListSchema.parse(raw2);
    const resDm = HTTPRouteListSchema.parse(rawDm);
    const mergedByName = new Map<string, HTTPRoute>();
    [...(res1.items ?? []), ...(res2.items ?? [])].forEach(r => {
      if (r?.metadata?.name) mergedByName.set(r.metadata.name, r);
    });
    // Add DomainMapping HTTPRoutes that actually point to this service via backendRefs
    for (const r of resDm.items ?? []) {
      const rules = r.spec?.rules ?? [];
      const pointsToService = rules.some(rule =>
        (rule.backendRefs ?? []).some(
          br => (br.kind ?? 'Service') === 'Service' && (br.name ?? '') === serviceName
        )
      );
      if (pointsToService && r.metadata?.name) {
        mergedByName.set(r.metadata.name, r);
      }
    }
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

// Wait until an HTTPRoute for a given Knative Service appears (best-effort).
// Used at creation time to attach SecurityPolicies.
export async function waitForServiceHttpRoute(
  namespace: string,
  serviceName: string,
  timeoutMs = 30000,
  intervalMs = 1000
): Promise<HTTPRoute | null> {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { external, internal } = await listHttpRoutesByVisibilityForService(
      namespace,
      serviceName
    );
    const route = external[0] || internal[0] || null;
    if (route) return route;
    if (Date.now() - start > timeoutMs) return null;
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
}
