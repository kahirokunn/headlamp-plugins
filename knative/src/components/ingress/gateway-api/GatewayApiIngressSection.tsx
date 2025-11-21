import React from 'react';
import { listHttpRoutesByVisibilityForService } from '../../../api/envoy';
import { fetchNetworkTemplates } from '../../../api/knative';
import HttpRoutesSection from './HttpRoutesSection';
import type { HTTPRoute } from '../../../api/envoy';

type GatewayApiIngressSectionProps = {
  namespace: string;
  serviceName: string;
};

export default function GatewayApiIngressSection({
  namespace,
  serviceName,
}: GatewayApiIngressSectionProps) {
  const [externalHttpRoutes, setExternalHttpRoutes] = React.useState<HTTPRoute[] | null>(null);
  const [internalHttpRoutes, setInternalHttpRoutes] = React.useState<HTTPRoute[] | null>(null);
  const [networkTemplates, setNetworkTemplates] = React.useState<{
    domainTemplate: string;
    tagTemplate: string;
  } | null>(null);

  const refetchRoutes = React.useCallback(async () => {
    try {
      const { external, internal } = await listHttpRoutesByVisibilityForService(
        namespace,
        serviceName
      );
      setExternalHttpRoutes(external);
      setInternalHttpRoutes(internal);
    } catch {
      setExternalHttpRoutes([]);
      setInternalHttpRoutes([]);
    }
  }, [namespace, serviceName]);

  // Fetch network templates (domain-template, tag-template)
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const t = await fetchNetworkTemplates();
        if (!cancelled) setNetworkTemplates(t);
      } catch {
        // ignore; keep null
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Initial fetch and polling for routes
  React.useEffect(() => {
    refetchRoutes();
  }, [refetchRoutes]);

  React.useEffect(() => {
    const timer = window.setInterval(() => {
      refetchRoutes();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [refetchRoutes]);

  return (
    <>
      <HttpRoutesSection
        title="HTTPRoutes (external)"
        namespace={namespace}
        routes={externalHttpRoutes}
        serviceName={serviceName}
        networkTemplates={networkTemplates ?? undefined}
      />
      <HttpRoutesSection
        title="HTTPRoutes (internal)"
        namespace={namespace}
        routes={internalHttpRoutes}
        serviceName={serviceName}
        networkTemplates={networkTemplates ?? undefined}
      />
    </>
  );
}

