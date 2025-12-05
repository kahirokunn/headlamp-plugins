import { Box, CircularProgress, Paper, Typography } from '@mui/material';
import type { GatewayConfigResult } from '../api/knativeRtkApi';
import { useFetchGatewayConfigQuery, useFetchIngressClassQuery } from '../api/knativeRtkApi';
import { INGRESS_CLASS_GATEWAY_API, formatIngressClass } from '../config/ingress';
import { useClusters } from '../hooks/useClusters';

function GatewaySection({
  label,
  config,
}: {
  label: string;
  config: GatewayConfigResult['external'];
}) {
  if (!config) {
    return (
      <Box sx={{ mt: 1.5 }}>
        <Typography variant="subtitle2">{label}</Typography>
        <Typography variant="body2" color="text.secondary">
          Not configured.
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ mt: 1.5 }}>
      <Typography variant="subtitle2">{label}</Typography>
      <Typography variant="body2">
        GatewayClass: <strong>{config.class}</strong>
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Controller: {config.controllerName ?? '(unknown)'}
      </Typography>
      <Typography variant="body2">
        Gateway: {config.gateway.namespace}/{config.gateway.name}
      </Typography>
      <Typography variant="body2">
        Service:{' '}
        {config.service ? `${config.service.namespace}/${config.service.name}` : '(not set)'}
      </Typography>
      {config.supportedFeatures && config.supportedFeatures.length > 0 && (
        <Typography variant="body2">
          Supported features: {config.supportedFeatures.join(', ')}
        </Typography>
      )}
    </Box>
  );
}

function ClusterNetworkingCard({
  cluster,
  ingressClass,
  gatewayConfig,
}: {
  cluster: string;
  ingressClass: string | null;
  gatewayConfig: GatewayConfigResult | null;
}) {
  const isGatewayApi = ingressClass === INGRESS_CLASS_GATEWAY_API;

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="subtitle1" color="text.secondary" sx={{ mb: 1 }}>
        Cluster: {cluster}
      </Typography>

      <Box sx={{ mb: 2 }}>
        <Typography variant="h6">Ingress</Typography>
        <Typography variant="body2">
          Effective ingress class: <strong>{formatIngressClass(ingressClass)}</strong>
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Raw value: {ingressClass ?? '(not set)'}
        </Typography>
      </Box>

      <Box>
        <Typography variant="h6">Gateway API</Typography>
        {isGatewayApi ? (
          <>
            <Typography variant="body2" color="text.secondary">
              Using Gateway API ingress (ingress class &quot;
              {formatIngressClass(ingressClass)}&quot;).
            </Typography>
            <GatewaySection label="External gateway" config={gatewayConfig?.external ?? null} />
            <GatewaySection
              label="Local gateway (cluster-local)"
              config={gatewayConfig?.local ?? null}
            />
            {!gatewayConfig?.external && !gatewayConfig?.local && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
                No external or local gateway entries found in the config-gateway ConfigMap.
              </Typography>
            )}
          </>
        ) : (
          <Typography variant="body2" color="text.secondary">
            Gateway API ingress class is not enabled. Current ingress class is{' '}
            {formatIngressClass(ingressClass)}.
          </Typography>
        )}
      </Box>
    </Paper>
  );
}

export default function KnativeNetworkingOverview() {
  const clusters = useClusters();
  const hasCluster = clusters.length > 0;

  const {
    data: ingressResults,
    isLoading: ingressLoading,
    isUninitialized: ingressUninitialized,
  } = useFetchIngressClassQuery({ clusters }, { skip: !hasCluster });

  const {
    data: gatewayResults,
    isLoading: gatewayLoading,
    isUninitialized: gatewayUninitialized,
  } = useFetchGatewayConfigQuery({ clusters }, { skip: !hasCluster });

  if (!hasCluster) {
    return (
      <Box sx={{ p: 4, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <Typography color="text.secondary">
          No cluster selected. Select a cluster to view Knative networking details.
        </Typography>
      </Box>
    );
  }

  const loading = ingressLoading || gatewayLoading || ingressUninitialized || gatewayUninitialized;

  if (loading) {
    return (
      <Box sx={{ p: 4, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  const clusterConfigs = clusters.map(cluster => {
    const ingressResultForCluster = ingressResults?.find(result => result.cluster === cluster);
    const gatewayResultForCluster = gatewayResults?.find(result => result.cluster === cluster);

    const ingressClassForCluster = ingressResultForCluster?.ingressClass ?? null;
    const gatewayConfigForCluster: GatewayConfigResult | null = gatewayResultForCluster
      ? {
          external: gatewayResultForCluster.external,
          local: gatewayResultForCluster.local,
        }
      : null;

    return {
      cluster,
      ingressClass: ingressClassForCluster,
      gatewayConfig: gatewayConfigForCluster,
    };
  });

  return (
    <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box sx={{ mb: 1 }}>
        <Typography variant="h5">Knative Networking</Typography>
        <Typography variant="body2" color="text.secondary">
          Overview of ingress settings configured
        </Typography>
      </Box>

      {clusterConfigs.map(config => (
        <ClusterNetworkingCard
          key={config.cluster}
          cluster={config.cluster}
          ingressClass={config.ingressClass}
          gatewayConfig={config.gatewayConfig}
        />
      ))}
    </Box>
  );
}
