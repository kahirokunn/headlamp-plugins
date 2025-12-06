import React from 'react';
import { listHttpRoutesByVisibilityForService } from '../../../api/envoy';
import { useFetchNetworkTemplatesQuery } from '../../../api/knativeRtkApi';
import HttpRoutesSection from './HttpRoutesSection';
import type { HTTPRoute } from '../../../api/envoy';

type GatewayApiIngressSectionProps = {
  namespace: string;
  serviceName: string;
  cluster: string;
};

export default function GatewayApiIngressSection({
  namespace,
  serviceName,
  cluster,
}: GatewayApiIngressSectionProps) {
  const clusters = [cluster];
  const [externalHttpRoutes, setExternalHttpRoutes] = React.useState<HTTPRoute[] | null>(null);
  const [internalHttpRoutes, setInternalHttpRoutes] = React.useState<HTTPRoute[] | null>(null);

  const { data: networkTemplatesData } = useFetchNetworkTemplatesQuery(
    { clusters },
    { skip: clusters.length === 0 }
  );

  const networkTemplates = React.useMemo(() => {
    if (!networkTemplatesData || networkTemplatesData.length === 0) return null;
    const match = networkTemplatesData.find(d => d.cluster === cluster);
    if (!match) return null;
    const { cluster: _cluster, ...templates } = match;
    return templates;
  }, [networkTemplatesData, cluster]);

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
