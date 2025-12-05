import React from 'react';
import { listHttpRoutesByVisibilityForService } from '../../../api/envoy';
import { useFetchNetworkTemplatesQuery } from '../../../api/knativeRtkApi';
import { useClusters } from '../../../hooks/useClusters';
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
  const clusters = useClusters();
  const [externalHttpRoutes, setExternalHttpRoutes] = React.useState<HTTPRoute[] | null>(null);
  const [internalHttpRoutes, setInternalHttpRoutes] = React.useState<HTTPRoute[] | null>(null);

  const { data: networkTemplatesData, isLoading: networkTemplatesLoading } =
    useFetchNetworkTemplatesQuery({ clusters }, { skip: clusters.length === 0 });

  const networkTemplates = React.useMemo(() => {
    if (!networkTemplatesData || networkTemplatesData.length === 0) return null;
    // Use the first cluster's templates
    const { cluster: _, ...templates } = networkTemplatesData[0];
    return templates;
  }, [networkTemplatesData]);

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
