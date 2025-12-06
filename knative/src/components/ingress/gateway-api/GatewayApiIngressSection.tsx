import React from 'react';
import { useListHttpRoutesByVisibilityForServiceQuery } from '../../../api/envoy';
import { useFetchNetworkTemplatesQuery } from '../../../api/knative';
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
  const { data: httpRoutesData } = useListHttpRoutesByVisibilityForServiceQuery(
    { cluster, namespace, serviceName },
    { skip: !cluster, pollingInterval: 4000 }
  );

  const externalHttpRoutes: HTTPRoute[] | null = httpRoutesData?.external ?? null;
  const internalHttpRoutes: HTTPRoute[] | null = httpRoutesData?.internal ?? null;

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
