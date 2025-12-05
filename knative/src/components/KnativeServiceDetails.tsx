import React from 'react';
import { Alert, Box, CircularProgress, Stack, Typography } from '@mui/material';
import type { KnativeRevision, KnativeService } from '../types/knative';
import {
  useGetServiceQuery,
  useWatchKnativeRevisions,
  useRedeployServiceMutation,
  useRestartServiceMutation,
  useFetchAutoscalingGlobalDefaultsQuery,
  useFetchIngressClassQuery,
} from '../api/knativeRtkApi';
import { useClusters } from '../hooks/useClusters';
import { useNotify } from './common/notifications/useNotify';
import { useParams } from 'react-router-dom';
import AutoscalingSettings from './AutoscalingSettings';
import ScaleBoundsSection from './ScaleBoundsSection';
import ConditionsSection from './ConditionsSection';
import ServiceHeader from './ServiceHeader';
import TrafficSplittingSection from './TrafficSplittingSection';
import DomainMappingSection from './DomainMappingSection';
import IngressIntegrationsSection from './IngressIntegrationsSection';
import { INGRESS_CLASS_GATEWAY_API, formatIngressClass } from '../config/ingress';

export default function KnativeServiceDetails({
  namespace: namespaceProp,
  name: nameProp,
}: {
  namespace?: string;
  name?: string;
}) {
  const params = useParams<{ namespace: string; name: string }>();
  const namespace = namespaceProp ?? params.namespace ?? '';
  const name = nameProp ?? params.name ?? '';
  const clusters = useClusters();
  const cluster = clusters[0] || '';
  const [acting, setActing] = React.useState<string | null>(null);
  const { notifyError, notifyInfo } = useNotify();

  const {
    data: serviceData,
    error: serviceError,
    isLoading: serviceLoading,
    refetch: refetchService,
  } = useGetServiceQuery({ cluster, namespace, name }, { skip: !cluster || !namespace || !name });

  const {
    data: revisionsData,
    error: revisionsError,
    isLoading: revisionsLoading,
  } = useWatchKnativeRevisions({
    clusters,
    namespace,
    serviceName: name,
  });

  const { data: autoDefaultsData, isLoading: autoDefaultsLoading } =
    useFetchAutoscalingGlobalDefaultsQuery({ clusters }, { skip: clusters.length === 0 });

  const { data: ingressClassData, isLoading: ingressClassLoading } = useFetchIngressClassQuery(
    { clusters },
    { skip: clusters.length === 0 }
  );

  const [redeployService] = useRedeployServiceMutation();
  const [restartService] = useRestartServiceMutation();

  const svc = React.useMemo(() => {
    if (!serviceData) return null;
    // Remove cluster field for compatibility
    const { cluster: _, ...service } = serviceData;
    return service;
  }, [serviceData]);

  const revs = React.useMemo(() => {
    if (!revisionsData) return null;
    // Remove cluster field for compatibility
    return revisionsData.map(({ cluster: _, ...rev }) => rev);
  }, [revisionsData]);

  const autoDefaults = React.useMemo(() => {
    if (!autoDefaultsData || autoDefaultsData.length === 0) return null;
    // Use the first cluster's defaults
    const { cluster: _, ...defaults } = autoDefaultsData[0];
    return defaults;
  }, [autoDefaultsData]);

  const ingressClass = React.useMemo(() => {
    if (!ingressClassData || ingressClassData.length === 0) return null;
    // Use the first cluster's ingress class
    return ingressClassData[0]?.ingressClass ?? null;
  }, [ingressClassData]);

  const error = React.useMemo(() => {
    if (serviceError) {
      return (serviceError as { message?: string })?.message || 'Failed to load service';
    }
    if (revisionsError) {
      return (revisionsError as { message?: string })?.message || 'Failed to load revisions';
    }
    return null;
  }, [serviceError, revisionsError]);

  const ready = React.useMemo(
    () => svc?.status?.conditions?.find(c => c.type === 'Ready')?.status === 'True',
    [svc]
  );

  async function handleRedeploy() {
    if (!svc || !cluster) return;
    setActing('redeploy');
    try {
      await redeployService({ cluster, namespace, name }).unwrap();
      notifyInfo('Redeploy requested');
      refetchService();
    } catch (err: unknown) {
      const error = err as { message?: string } | undefined;
      const detail = error?.message?.trim();
      notifyError(detail ? `Redeploy failed: ${detail}` : 'Redeploy failed');
    } finally {
      setActing(null);
    }
  }

  async function handleRestart() {
    if (!svc || !cluster) return;
    setActing('restart');
    try {
      await restartService({ cluster, namespace, service: svc }).unwrap();
      notifyInfo('Restart requested');
      refetchService();
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

  if (serviceLoading || revisionsLoading || !svc || !revs) {
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
        serviceName={svc.metadata.name}
        namespace={svc.metadata.namespace ?? namespace}
        ready={!!ready}
        acting={acting}
        onRedeploy={handleRedeploy}
        onRestart={handleRestart}
      />

      {!ingressClassLoading && (
        <Typography variant="body2" color="text.secondary">
          Ingress class: {displayIngressClass()}
        </Typography>
      )}

      <ConditionsSection title="Conditions" conditions={svc.status?.conditions} />

      <TrafficSplittingSection
        namespace={namespace}
        name={name}
        service={svc}
        revisions={revs}
        onSaved={() => {
          refetchService();
        }}
      />

      <DomainMappingSection namespace={namespace} serviceName={name} />

      <IngressIntegrationsSection
        namespace={namespace}
        serviceName={name}
        ingressClass={ingressClass}
        ingressClassLoaded={ingressClassLoaded}
      />

      <AutoscalingSettings
        namespace={namespace}
        name={name}
        service={svc}
        defaults={autoDefaults}
        onSaved={() => {
          refetchService();
        }}
      />

      <ScaleBoundsSection
        namespace={namespace}
        name={name}
        service={svc}
        defaults={autoDefaults}
        onSaved={() => {
          refetchService();
        }}
      />
    </Stack>
  );
}
