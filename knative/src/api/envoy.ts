import * as ApiProxy from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import * as z from 'zod/mini';
import { knativeRtkApi, toApiError } from './knativeRtkApi';

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

const HTTPRouteSchema = z.object({
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

type HttpRoutesByVisibility = {
  external: HTTPRoute[];
  internal: HTTPRoute[];
};

type UpsertBasicAuthSecretArgs = {
  cluster: string;
  namespace: string;
  name: string;
  username: string;
  password: string;
  ownerHttpRouteName?: string;
};

type CreateSecurityPolicyForHTTPRouteArgs = {
  cluster: string;
  namespace: string;
  policyName: string;
  httpRouteName: string;
  secretName: string;
};

type CreateIpAccessSecurityPolicyArgs = {
  cluster: string;
  namespace: string;
  policyName: string;
  httpRouteName: string;
  allowCidrs: string[];
  denyCidrs: string[];
};

type ListHttpRoutesByVisibilityForServiceArgs = {
  cluster: string;
  namespace: string;
  serviceName: string;
};

type WaitForServiceHttpRouteArgs = {
  cluster: string;
  namespace: string;
  serviceName: string;
  timeoutMs?: number;
  intervalMs?: number;
};

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

async function getHttpRoute(
  cluster: string,
  namespace: string,
  name: string
): Promise<HTTPRoute | null> {
  try {
    const response = await ApiProxy.clusterRequest(
      `/apis/gateway.networking.k8s.io/v1/namespaces/${namespace}/httproutes/${name}`,
      { method: 'GET', cluster }
    );
    const parsed = HTTPRouteSchema.safeParse(response);
    if (!parsed.success) {
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

async function buildHttpRouteOwnerRef(
  cluster: string,
  namespace: string,
  httpRouteName: string
): Promise<OwnerReference | null> {
  const route = await getHttpRoute(cluster, namespace, httpRouteName);
  if (!route) return null;
  return {
    apiVersion: route.apiVersion || 'gateway.networking.k8s.io/v1',
    kind: route.kind || 'HTTPRoute',
    name: route.metadata.name,
    uid: route.metadata.uid || '',
    blockOwnerDeletion: true,
  };
}

async function getSecret(
  cluster: string,
  namespace: string,
  name: string
): Promise<K8sSecret | null> {
  try {
    const response = await ApiProxy.clusterRequest(
      `/api/v1/namespaces/${namespace}/secrets/${name}`,
      {
        method: 'GET',
        cluster,
      }
    );
    const parsed = K8sSecretSchema.safeParse(response);
    if (!parsed.success) {
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

async function findSecurityPolicyForHTTPRoute(
  cluster: string,
  namespace: string,
  httpRouteName: string
): Promise<SecurityPolicy | null> {
  try {
    const response = await ApiProxy.clusterRequest(
      `/apis/gateway.envoyproxy.io/v1alpha1/namespaces/${namespace}/securitypolicies`,
      { method: 'GET', cluster }
    );
    const parsed = SecurityPolicyListSchema.safeParse(response);
    if (!parsed.success) {
      return null;
    }
    const items = parsed.data.items ?? [];
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

async function listHttpRoutesByVisibilityForServiceInternal(
  cluster: string,
  namespace: string,
  serviceName: string
): Promise<HttpRoutesByVisibility> {
  try {
    const labelSelector1 = encodeURIComponent(`serving.knative.dev/service=${serviceName}`);
    const labelSelector2 = encodeURIComponent(`serving.knative.dev/route=${serviceName}`);
    const labelSelectorDmNs = encodeURIComponent(
      `serving.knative.dev/domainMappingNamespace=${namespace}`
    );
    const [raw1, raw2, rawDm] = await Promise.all([
      ApiProxy.clusterRequest(
        `/apis/gateway.networking.k8s.io/v1/namespaces/${namespace}/httproutes?labelSelector=${labelSelector1}`,
        { method: 'GET', cluster }
      ),
      ApiProxy.clusterRequest(
        `/apis/gateway.networking.k8s.io/v1/namespaces/${namespace}/httproutes?labelSelector=${labelSelector2}`,
        { method: 'GET', cluster }
      ),
      ApiProxy.clusterRequest(
        `/apis/gateway.networking.k8s.io/v1/namespaces/${namespace}/httproutes?labelSelector=${labelSelectorDmNs}`,
        { method: 'GET', cluster }
      ),
    ]);
    const parsed1 = HTTPRouteListSchema.safeParse(raw1);
    const parsed2 = HTTPRouteListSchema.safeParse(raw2);
    const parsedDm = HTTPRouteListSchema.safeParse(rawDm);
    if (!parsed1.success || !parsed2.success || !parsedDm.success) {
      return { external: [], internal: [] };
    }
    const res1 = parsed1.data;
    const res2 = parsed2.data;
    const resDm = parsedDm.data;
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

const envoyRtkApi = knativeRtkApi.injectEndpoints({
  endpoints: build => ({
    upsertBasicAuthSecret: build.mutation<void, UpsertBasicAuthSecretArgs>({
      async queryFn({ cluster, namespace, name, username, password, ownerHttpRouteName }) {
        const line = await buildHtpasswdLine(username, password);
        const fileContent = `${line}\n`;
        const dataB64 =
          typeof btoa === 'function'
            ? btoa(fileContent)
            : Buffer.from(fileContent, 'utf8').toString('base64');

        try {
          const existing = await getSecret(cluster, namespace, name);
          if (!existing) {
            const ownerRef = ownerHttpRouteName
              ? await buildHttpRouteOwnerRef(cluster, namespace, ownerHttpRouteName)
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
            await ApiProxy.clusterRequest(`/api/v1/namespaces/${namespace}/secrets`, {
              method: 'POST',
              cluster,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            });
          } else {
            const patch = {
              data: { '.htpasswd': dataB64 },
              type: 'Opaque',
            };
            await ApiProxy.clusterRequest(`/api/v1/namespaces/${namespace}/secrets/${name}`, {
              method: 'PATCH',
              cluster,
              headers: { 'Content-Type': 'application/merge-patch+json' },
              body: JSON.stringify(patch),
            });
          }
          return { data: undefined };
        } catch (error) {
          return { error: toApiError(error, 'Failed to upsert basic auth Secret') };
        }
      },
    }),

    createSecurityPolicyForHTTPRoute: build.mutation<void, CreateSecurityPolicyForHTTPRouteArgs>({
      async queryFn({ cluster, namespace, policyName, httpRouteName, secretName }) {
        try {
          const existing = await findSecurityPolicyForHTTPRoute(cluster, namespace, httpRouteName);
          if (existing?.metadata?.name) {
            const patch = {
              spec: {
                basicAuth: {
                  users: {
                    name: secretName,
                  },
                },
              },
            };
            await ApiProxy.clusterRequest(
              `/apis/gateway.envoyproxy.io/v1alpha1/namespaces/${namespace}/securitypolicies/${existing.metadata.name}`,
              {
                method: 'PATCH',
                cluster,
                headers: { 'Content-Type': 'application/merge-patch+json' },
                body: JSON.stringify(patch),
              }
            );
            const getResponse = await ApiProxy.clusterRequest(
              `/apis/gateway.envoyproxy.io/v1alpha1/namespaces/${namespace}/securitypolicies/${existing.metadata.name}`,
              { method: 'GET', cluster }
            );
            const parsed = SecurityPolicySchema.safeParse(getResponse);
            if (!parsed.success) {
              return {
                error: {
                  kind: 'ValidationError',
                  message: 'Invalid SecurityPolicy response',
                },
              };
            }
            return { data: undefined };
          }

          const ownerRef = await buildHttpRouteOwnerRef(cluster, namespace, httpRouteName);
          const body: SecurityPolicy = {
            apiVersion: 'gateway.envoyproxy.io/v1alpha1',
            kind: 'SecurityPolicy',
            metadata: {
              name: policyName,
              namespace,
              ...(ownerRef ? { ownerReferences: [ownerRef] } : {}),
            },
            spec: {
              targetRefs: [
                {
                  group: 'gateway.networking.k8s.io',
                  kind: 'HTTPRoute',
                  name: httpRouteName,
                },
              ],
              basicAuth: {
                users: {
                  name: secretName,
                },
              },
            },
          };
          const response = await ApiProxy.clusterRequest(
            `/apis/gateway.envoyproxy.io/v1alpha1/namespaces/${namespace}/securitypolicies`,
            {
              method: 'POST',
              cluster,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            }
          );
          const parsed = SecurityPolicySchema.safeParse(response);
          if (!parsed.success) {
            return {
              error: {
                kind: 'ValidationError',
                message: 'Invalid SecurityPolicy response',
              },
            };
          }
          return { data: undefined };
        } catch (error) {
          return {
            error: toApiError(error, 'Failed to create SecurityPolicy for HTTPRoute'),
          };
        }
      },
    }),

    createIpAccessSecurityPolicy: build.mutation<void, CreateIpAccessSecurityPolicyArgs>({
      async queryFn({ cluster, namespace, policyName, httpRouteName, allowCidrs, denyCidrs }) {
        try {
          const existing = await findSecurityPolicyForHTTPRoute(cluster, namespace, httpRouteName);
          if (existing?.metadata?.name) {
            const patch = {
              spec: {
                ...buildAuthorizationRulesForPatch(allowCidrs || [], denyCidrs || []),
              },
            };
            await ApiProxy.clusterRequest(
              `/apis/gateway.envoyproxy.io/v1alpha1/namespaces/${namespace}/securitypolicies/${existing.metadata.name}`,
              {
                method: 'PATCH',
                cluster,
                headers: { 'Content-Type': 'application/merge-patch+json' },
                body: JSON.stringify(patch),
              }
            );
            const getResponse = await ApiProxy.clusterRequest(
              `/apis/gateway.envoyproxy.io/v1alpha1/namespaces/${namespace}/securitypolicies/${existing.metadata.name}`,
              { method: 'GET', cluster }
            );
            const parsed = SecurityPolicySchema.safeParse(getResponse);
            if (!parsed.success) {
              return {
                error: {
                  kind: 'ValidationError',
                  message: 'Invalid SecurityPolicy response',
                },
              };
            }
            return { data: undefined };
          }

          const ownerRef = await buildHttpRouteOwnerRef(cluster, namespace, httpRouteName);
          const body: SecurityPolicy = {
            apiVersion: 'gateway.envoyproxy.io/v1alpha1',
            kind: 'SecurityPolicy',
            metadata: {
              name: policyName,
              namespace,
              ...(ownerRef ? { ownerReferences: [ownerRef] } : {}),
            },
            spec: {
              targetRefs: [
                {
                  group: 'gateway.networking.k8s.io',
                  kind: 'HTTPRoute',
                  name: httpRouteName,
                },
              ],
              ...buildAuthorizationRulesForSpec(allowCidrs || [], denyCidrs || []),
            },
          };
          const response = await ApiProxy.clusterRequest(
            `/apis/gateway.envoyproxy.io/v1alpha1/namespaces/${namespace}/securitypolicies`,
            {
              method: 'POST',
              cluster,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            }
          );
          const parsed = SecurityPolicySchema.safeParse(response);
          if (!parsed.success) {
            return {
              error: {
                kind: 'ValidationError',
                message: 'Invalid SecurityPolicy response',
              },
            };
          }
          return { data: undefined };
        } catch (error) {
          return {
            error: toApiError(error, 'Failed to create IP access SecurityPolicy'),
          };
        }
      },
    }),

    listHttpRoutesByVisibilityForService: build.query<
      HttpRoutesByVisibility,
      ListHttpRoutesByVisibilityForServiceArgs
    >({
      async queryFn({ cluster, namespace, serviceName }) {
        const result = await listHttpRoutesByVisibilityForServiceInternal(
          cluster,
          namespace,
          serviceName
        );
        return { data: result };
      },
    }),

    waitForServiceHttpRoute: build.mutation<HTTPRoute | null, WaitForServiceHttpRouteArgs>({
      async queryFn({ cluster, namespace, serviceName, timeoutMs = 30000, intervalMs = 1000 }) {
        const start = Date.now();
        const effectiveInterval = intervalMs > 0 ? intervalMs : 1000;
        const effectiveTimeout = timeoutMs > 0 ? timeoutMs : 30000;

        // Poll until an HTTPRoute appears or timeout elapses.
        while (Date.now() - start <= effectiveTimeout) {
          const { external, internal } = await listHttpRoutesByVisibilityForServiceInternal(
            cluster,
            namespace,
            serviceName
          );
          const route = external[0] || internal[0] || null;
          if (route) {
            return { data: route };
          }
          await new Promise(resolve => setTimeout(resolve, effectiveInterval));
        }

        return { data: null };
      },
    }),
  }),
  overrideExisting: false,
});

export const {
  useUpsertBasicAuthSecretMutation,
  useCreateSecurityPolicyForHTTPRouteMutation,
  useCreateIpAccessSecurityPolicyMutation,
  useListHttpRoutesByVisibilityForServiceQuery,
  useWaitForServiceHttpRouteMutation,
} = envoyRtkApi;
