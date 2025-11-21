import React from 'react';
import { Alert, Box, CircularProgress, Stack, Typography } from '@mui/material';
import type { KnativeRevision, KnativeService } from '../types/knative';
import {
  fetchAutoscalingGlobalDefaults,
  fetchIngressClass,
  fetchNetworkTemplates,
  getService,
  listRevisions,
  redeployService,
  restartService,
} from '../api/knative';
import { listHttpRoutesByVisibilityForService } from '../api/envoy';
import { useNotify } from './common/notifications/useNotify';
import { useParams } from 'react-router-dom';
import AutoscalingSettings from './AutoscalingSettings';
import ScaleBoundsSection from './ScaleBoundsSection';
import HttpRoutesSection from './HttpRoutesSection';
import ConditionsSection from './ConditionsSection';
import ServiceHeader from './ServiceHeader';
import TrafficSplittingSection from './TrafficSplittingSection';
import type { HTTPRoute } from '../api/envoy';
import DomainMappingSection from './DomainMappingSection';

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
  const [svc, setSvc] = React.useState<KnativeService | null>(null);
  const [revs, setRevs] = React.useState<KnativeRevision[] | null>(null);
  const [acting, setActing] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const { notifyError, notifyInfo } = useNotify();
  const [externalHttpRoutes, setExternalHttpRoutes] = React.useState<HTTPRoute[] | null>(null);
  const [internalHttpRoutes, setInternalHttpRoutes] = React.useState<HTTPRoute[] | null>(null);
  const [autoDefaults, setAutoDefaults] = React.useState<{
    concurrencyTarget: number;
    targetUtilizationPercentage: number;
    rpsTarget: number;
    containerConcurrency: number;
    minScale: number;
    maxScale: number;
    maxScaleLimit?: number;
    initialScale: number;
    allowZeroInitialScale: boolean;
    scaleDownDelay: string;
    stableWindow: string;
    activationScaleDefault: number;
  } | null>(null);
  const [networkTemplates, setNetworkTemplates] = React.useState<{
    domainTemplate: string;
    tagTemplate: string;
  } | null>(null);
  const [ingressClass, setIngressClass] = React.useState<string | null>(null);
  const [ingressClassLoaded, setIngressClassLoaded] = React.useState(false);

  const refetchServiceAndRevisions = React.useCallback(async () => {
    try {
      const [s, r] = await Promise.all([
        getService(namespace, name),
        listRevisions(namespace, name),
      ]);
      setSvc(s);
      setRevs(r);
    } catch (err) {
      setError((err as Error)?.message || 'Failed to load resource');
    }
  }, [namespace, name]);

  const refetchRoutes = React.useCallback(async () => {
    try {
      const { external, internal } = await listHttpRoutesByVisibilityForService(namespace, name);
      setExternalHttpRoutes(external);
      setInternalHttpRoutes(internal);
    } catch {
      setExternalHttpRoutes([]);
      setInternalHttpRoutes([]);
    }
  }, [namespace, name]);

  React.useEffect(() => {
    refetchServiceAndRevisions();
  }, [refetchServiceAndRevisions]);

  // Fetch autoscaling defaults
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await fetchAutoscalingGlobalDefaults();
        if (!cancelled) setAutoDefaults(d);
      } catch {
        // ignore; keep null
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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

  // Fetch ingress.class from config-network to warn when Gateway API integration is not enabled.
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
    refetchRoutes();
  }, [refetchRoutes]);

  const ready = React.useMemo(
    () => svc?.status?.conditions?.find(c => c.type === 'Ready')?.status === 'True',
    [svc]
  );

  React.useEffect(() => {
    if (!svc || ready) return;
    const timer = window.setInterval(() => {
      refetchServiceAndRevisions();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [svc, ready, refetchServiceAndRevisions]);

  React.useEffect(() => {
    const timer = window.setInterval(() => {
      refetchRoutes();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [refetchRoutes]);

  async function handleRedeploy() {
    if (!svc) return;
    setActing('redeploy');
    try {
      await redeployService(namespace, name);
      notifyInfo('Redeploy requested');
      refetchServiceAndRevisions();
    } catch (err) {
      const detail = (err as Error)?.message?.trim();
      notifyError(detail ? `Redeploy failed: ${detail}` : 'Redeploy failed');
    } finally {
      setActing(null);
    }
  }

  async function handleRestart() {
    if (!svc) return;
    setActing('restart');
    try {
      await restartService(namespace, svc);
      notifyInfo('Restart requested');
    } catch (err) {
      const detail = (err as Error)?.message?.trim();
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

  if (!svc || !revs) {
    return (
      <Box p={4} display="flex" justifyContent="center" alignItems="center">
        <CircularProgress />
      </Box>
    );
  }

  const expectedIngressClass = 'gateway-api.ingress.networking.knative.dev';
  const shouldShowIngressWarning = ingressClassLoaded && ingressClass !== expectedIngressClass;

  function formatIngressClass(): string {
    if (!ingressClassLoaded) return '';
    if (!ingressClass) return '(not set)';
    const suffix = '.ingress.networking.knative.dev';
    return ingressClass.endsWith(suffix) ? ingressClass.slice(0, -suffix.length) : ingressClass;
  }

  return (
    <Stack spacing={2} p={2}>
      {shouldShowIngressWarning && (
        <Alert severity="warning">
          Gateway API integration may be limited because Knative &quot;config-network&quot;
          ConfigMap ingress.class
          {ingressClass == null
            ? ' is not set.'
            : ` is set to "${ingressClass}", not "${expectedIngressClass}".`}{' '}
          Set it to &quot;gateway-api.ingress.networking.knative.dev&quot; to enable all
          HTTPRoute-related features in this plugin.
        </Alert>
      )}
      <ServiceHeader
        serviceName={svc.metadata.name}
        namespace={svc.metadata.namespace}
        ready={!!ready}
        acting={acting}
        onRedeploy={handleRedeploy}
        onRestart={handleRestart}
      />

      {ingressClassLoaded && (
        <Typography variant="body2" color="text.secondary">
          Ingress class: {formatIngressClass()}
        </Typography>
      )}

      <ConditionsSection title="Conditions" conditions={svc.status?.conditions} />

      <TrafficSplittingSection
        namespace={namespace}
        name={name}
        service={svc}
        revisions={revs}
        onSaved={refetchServiceAndRevisions}
      />

      <HttpRoutesSection
        title="HTTPRoutes (external)"
        namespace={namespace}
        routes={externalHttpRoutes}
        serviceName={name}
        networkTemplates={networkTemplates ?? undefined}
      />

      <DomainMappingSection namespace={namespace} serviceName={name} />

      <HttpRoutesSection
        title="HTTPRoutes (internal)"
        namespace={namespace}
        routes={internalHttpRoutes}
        serviceName={name}
        networkTemplates={networkTemplates ?? undefined}
      />

      <AutoscalingSettings
        namespace={namespace}
        name={name}
        service={svc}
        defaults={autoDefaults}
        onSaved={refetchServiceAndRevisions}
      />

      <ScaleBoundsSection
        namespace={namespace}
        name={name}
        service={svc}
        defaults={autoDefaults}
        onSaved={refetchServiceAndRevisions}
      />
    </Stack>
  );
}
