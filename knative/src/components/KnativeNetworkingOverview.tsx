import React from 'react';
import { Box, CircularProgress, Paper, Typography } from '@mui/material';
import { fetchGatewayConfig, fetchIngressClass, GatewayConfigResult } from '../api/knative';
import { INGRESS_CLASS_GATEWAY_API, formatIngressClass } from '../config/ingress';

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

export default function KnativeNetworkingOverview() {
  const [ingressClass, setIngressClass] = React.useState<string | null>(null);
  const [ingressClassLoaded, setIngressClassLoaded] = React.useState(false);
  const [gatewayConfig, setGatewayConfig] = React.useState<GatewayConfigResult | null>(null);
  const [gatewayLoaded, setGatewayLoaded] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const value = await fetchIngressClass();
        if (!cancelled) {
          setIngressClass(value);
          setIngressClassLoaded(true);
        }
      } catch {
        if (!cancelled) {
          setIngressClass(null);
          setIngressClassLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const config = await fetchGatewayConfig();
        if (!cancelled) {
          setGatewayConfig(config);
          setGatewayLoaded(true);
        }
      } catch {
        if (!cancelled) {
          setGatewayConfig({ external: null, local: null });
          setGatewayLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loading = !ingressClassLoaded || !gatewayLoaded;
  const isGatewayApi = ingressClass === INGRESS_CLASS_GATEWAY_API;

  if (loading) {
    return (
      <Box sx={{ p: 4, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box sx={{ mb: 1 }}>
        <Typography variant="h5">Knative Networking</Typography>
        <Typography variant="body2" color="text.secondary">
          Overview of ingress settings configured
        </Typography>
      </Box>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6">Ingress</Typography>
        <Typography variant="body2">
          Effective ingress class: <strong>{formatIngressClass(ingressClass)}</strong>
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Raw value: {ingressClass ?? '(not set)'}
        </Typography>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
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
      </Paper>
    </Box>
  );
}
