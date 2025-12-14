type HttpRouteLike = {
  metadata?: {
    name?: string;
    uid?: string;
  };
  spec?: {
    hostnames?: string[] | null;
  };
};

type EnvoyTargetRef = {
  group?: string;
  kind?: string;
  name?: string;
};

type EnvoyTargetRefPolicyLike = {
  spec?: {
    targetRefs?: EnvoyTargetRef[] | null;
  };
};

function findHttpRouteForHost<TRoute extends HttpRouteLike>(
  routes: TRoute[],
  host: string
): TRoute | null {
  if (!host) {
    return null;
  }

  // Prefer direct match by name first (host === HTTPRoute name).
  const direct = routes.find(r => r.metadata?.name === host);
  if (direct) {
    return direct;
  }

  return (
    routes.find(r => (r.spec?.hostnames ?? []).includes(host)) ??
    routes.find(r => r.metadata?.name === host) ??
    null
  );
}

function matchesHttpRouteTargetRef(
  targetRef: EnvoyTargetRef | undefined,
  httpRouteName: string
): boolean {
  if (!targetRef) {
    return false;
  }

  const group = targetRef.group ?? '';
  const kind = targetRef.kind ?? '';
  const name = targetRef.name ?? '';

  return group === 'gateway.networking.k8s.io' && kind === 'HTTPRoute' && name === httpRouteName;
}

function findEnvoyPolicyForHTTPRoute<TPolicy extends EnvoyTargetRefPolicyLike>(
  policies: TPolicy[],
  httpRouteName: string
): TPolicy | null {
  return (
    policies.find(policy =>
      (policy.spec?.targetRefs ?? []).some(ref => matchesHttpRouteTargetRef(ref, httpRouteName))
    ) ?? null
  );
}

export function findSecurityPolicyForHTTPRoute<TPolicy extends EnvoyTargetRefPolicyLike>(
  policies: TPolicy[],
  httpRouteName: string
): TPolicy | null {
  return findEnvoyPolicyForHTTPRoute(policies, httpRouteName);
}

export function findBackendTrafficPolicyForHTTPRoute<TPolicy extends EnvoyTargetRefPolicyLike>(
  policies: TPolicy[],
  httpRouteName: string
): TPolicy | null {
  return findEnvoyPolicyForHTTPRoute(policies, httpRouteName);
}

type HttpRouteOwnerReference = {
  apiVersion: string;
  kind: string;
  name: string;
  uid: string;
  controller: boolean;
  blockOwnerDeletion: boolean;
};

export function buildHttpRouteOwnerRefFromRoute<TRoute extends HttpRouteLike>(
  httpRoute: TRoute | null | undefined
): HttpRouteOwnerReference | null {
  if (!httpRoute?.metadata?.name) {
    return null;
  }

  return {
    apiVersion: 'gateway.networking.k8s.io/v1',
    kind: 'HTTPRoute',
    name: httpRoute.metadata.name,
    uid: httpRoute.metadata.uid ?? '',
    controller: true,
    blockOwnerDeletion: true,
  };
}
