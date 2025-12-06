import React from 'react';
import { Alert, Box, CircularProgress, Stack, Typography } from '@mui/material';
import {
  useWatchKnativeRevisions,
  useRedeployServiceMutation,
  useRestartServiceMutation,
  useFetchAutoscalingGlobalDefaultsQuery,
  useFetchIngressClassQuery,
  KnativeServiceWithCluster,
} from '../api/knativeRtkApi';
import type { KnativeRevision } from '../types/knative';
import { useNotify } from './common/notifications/useNotify';
import AutoscalingSettings from './AutoscalingSettings';
import ScaleBoundsSection from './ScaleBoundsSection';
import ConditionsSection from './ConditionsSection';
import ServiceHeader from './ServiceHeader';
import TrafficSplittingSection from './TrafficSplittingSection';
import DomainMappingSection from './DomainMappingSection';
import IngressIntegrationsSection from './IngressIntegrationsSection';
import { INGRESS_CLASS_GATEWAY_API, formatIngressClass } from '../config/ingress';

type KnativeServiceDetailsProps = {
  kservice: KnativeServiceWithCluster;
};

export default function KnativeServiceDetails({ kservice }: KnativeServiceDetailsProps) {
  const {
    cluster,
    metadata: { name },
  } = kservice;
  const namespace = kservice.metadata.namespace!;
  const clusters = [kservice.cluster];
  const [acting, setActing] = React.useState<string | null>(null);
  const { notifyError, notifyInfo } = useNotify();

  const {
    data: revisionsData,
    error: revisionsError,
    isLoading: revisionsLoading,
  } = useWatchKnativeRevisions({
    clusters,
    namespace,
    serviceName: name,
  });

  const { data: autoDefaultsData } = useFetchAutoscalingGlobalDefaultsQuery(
    { clusters },
    { skip: clusters.length === 0 }
  );

  const {
    data: ingressClassData,
    isLoading: ingressClassLoading,
    isSuccess: ingressClassSuccess,
  } = useFetchIngressClassQuery({ clusters }, { skip: clusters.length === 0 });

  const [redeployService] = useRedeployServiceMutation();
  const [restartService] = useRestartServiceMutation();

  const revs: KnativeRevision[] | null = React.useMemo(() => {
    if (!revisionsData) {
      return null;
    }
    // Remove cluster field for compatibility with components that expect plain KnativeRevision
    return revisionsData.map(({ cluster: _cluster, ...rest }) => rest);
  }, [revisionsData]);

  const autoDefaults = React.useMemo(() => {
    if (!autoDefaultsData || autoDefaultsData.length === 0) return null;
    const match = autoDefaultsData.find(d => d.cluster === cluster);
    if (!match) return null;
    const { cluster: _cluster, ...defaults } = match;
    return defaults;
  }, [autoDefaultsData, cluster]);

  const ingressClass = React.useMemo(() => {
    if (!ingressClassData || ingressClassData.length === 0) return null;
    const match = ingressClassData.find(d => d.cluster === cluster);
    return match?.ingressClass ?? null;
  }, [ingressClassData, cluster]);

  const error = React.useMemo(() => {
    if (revisionsError) {
      return (revisionsError as { message?: string })?.message || 'Failed to load revisions';
    }
    return null;
  }, [revisionsError]);

  const ready = kservice?.status?.conditions?.find(c => c.type === 'Ready')?.status === 'True';

  async function handleRedeploy() {
    if (!kservice || !cluster) return;
    setActing('redeploy');
    try {
      await redeployService({ cluster, namespace, name }).unwrap();
      notifyInfo('Redeploy requested');
    } catch (err: unknown) {
      const error = err as { message?: string } | undefined;
      const detail = error?.message?.trim();
      notifyError(detail ? `Redeploy failed: ${detail}` : 'Redeploy failed');
    } finally {
      setActing(null);
    }
  }

  async function handleRestart() {
    if (!kservice || !cluster) return;
    setActing('restart');
    try {
      await restartService({ cluster, namespace, service: kservice }).unwrap();
      notifyInfo('Restart requested');
    } catch (err: unknown) {
      const error = err as { message?: string } | undefined;
      const detail = error?.message?.trim();
      notifyError(detail ? `Restart failed: ${detail}` : 'Restart failed');
    } finally {
      setActing(null);
    }
  }

  if (error) {
    return (
      <Box p={2}>
        <Typography color="error">{error}</Typography>
      </Box>
    );
  }

  if (revisionsLoading || !kservice || !revs) {
    return (
      <Box p={4} display="flex" justifyContent="center" alignItems="center">
        <CircularProgress />
      </Box>
    );
  }

  const shouldShowIngressWarning =
    !ingressClassLoading && ingressClass !== INGRESS_CLASS_GATEWAY_API;

  function displayIngressClass(): string {
    if (ingressClassLoading) return '';
    return formatIngressClass(ingressClass);
  }

  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      {shouldShowIngressWarning && (
        <Alert severity="warning" variant="filled">
          Gateway API integration may be limited because Knative "config-network" ConfigMap
          ingress.class
          {ingressClass == null
            ? ' is not set.'
            : ` is set to "${ingressClass}", not "${INGRESS_CLASS_GATEWAY_API}".`}
        </Alert>
      )}
      <ServiceHeader
        serviceName={kservice.metadata.name}
        namespace={kservice.metadata.namespace ?? namespace}
        cluster={cluster}
        ready={ready}
        acting={acting}
        onRedeploy={handleRedeploy}
        onRestart={handleRestart}
      />

      {!ingressClassLoading && (
        <Typography variant="body2" color="text.secondary">
          Ingress class: {displayIngressClass()}
        </Typography>
      )}

      {kservice.status?.conditions && <ConditionsSection conditions={kservice.status.conditions} />}

      <TrafficSplittingSection
        cluster={cluster}
        namespace={namespace}
        name={name}
        service={kservice}
        revisions={revs}
      />

      <DomainMappingSection namespace={namespace} serviceName={name} cluster={cluster} />

      <IngressIntegrationsSection
        namespace={namespace}
        serviceName={name}
        ingressClass={ingressClass}
        ingressClassLoaded={ingressClassSuccess}
        cluster={cluster}
      />

      <AutoscalingSettings
        namespace={namespace}
        name={name}
        cluster={cluster}
        service={kservice}
        defaults={autoDefaults}
      />

      <ScaleBoundsSection
        namespace={namespace}
        name={name}
        service={kservice}
        defaults={autoDefaults}
        cluster={cluster}
      />
    </Stack>
  );
}
