import React from 'react';
import { Box, Button, Chip, Paper, Stack, TextField, Typography } from '@mui/material';
import type { DomainMapping } from '../types/knative';
import {
  useWatchDomainMappings,
  useCreateDomainMappingMutation,
  useDeleteDomainMappingMutation,
  useCreateClusterDomainClaimMutation,
  useGetClusterDomainClaimQuery,
  useAnnotateDomainMappingMutation,
} from '../api/knativeRtkApi';
import { useClusters } from '../hooks/useClusters';
import { useNotify } from './common/notifications/useNotify';

type Props = {
  namespace: string;
  serviceName: string;
};

export default function DomainMappingSection({ namespace, serviceName }: Props) {
  const clusters = useClusters();
  const cluster = clusters[0] || '';
  const { notifyError, notifyInfo } = useNotify();
  const [creating, setCreating] = React.useState<boolean>(false);
  const [domainInput, setDomainInput] = React.useState<string>('');

  const {
    data: domainMappingsData,
    isLoading: loading,
    error: domainMappingsError,
  } = useWatchDomainMappings({ clusters, namespace });

  const [createDomainMapping] = useCreateDomainMappingMutation();
  const [deleteDomainMapping] = useDeleteDomainMappingMutation();
  const [createClusterDomainClaim] = useCreateClusterDomainClaimMutation();
  const [annotateDomainMapping] = useAnnotateDomainMappingMutation();

  const mappings = React.useMemo(() => {
    if (!domainMappingsData) return null;
    const filtered = domainMappingsData
      .filter(dm => {
        const ref = dm.spec?.ref;
        const refNs = ref?.namespace || dm.metadata?.namespace;
        return ref?.name === serviceName && refNs === namespace;
      })
      .map(({ cluster: _, ...dm }) => dm);
    return filtered;
  }, [domainMappingsData, namespace, serviceName]);

  const [cdcMissingByHost, setCdcMissingByHost] = React.useState<Record<string, boolean>>({});

  // Check CDC existence for each mapping host (only when not Ready to reduce noise)
  // Note: This is a simplified version that doesn't check CDC existence dynamically
  // The CDC check is handled by the UI based on Ready status
  React.useEffect(() => {
    if (!mappings) return;
    const next: Record<string, boolean> = {};
    for (const dm of mappings) {
      const host = dm.metadata?.name || '';
      if (!host) continue;
      const ready = dm.status?.conditions?.find(c => c.type === 'Ready')?.status === 'True';
      // If not ready, assume CDC might be missing (simplified check)
      next[host] = !ready;
    }
    setCdcMissingByHost(next);
  }, [mappings]);

  const readyUrl = (dm: DomainMapping): string | undefined => {
    const isReady = dm.status?.conditions?.find(c => c.type === 'Ready')?.status === 'True';
    const url = dm.status?.url || dm.status?.address?.url;
    return isReady && url ? url : undefined;
  };

  function isValidDomain(host: string): boolean {
    // very permissive host validation; rely on API for authoritative validation
    const h = host.trim();
    if (h.length < 1 || h.length > 253) return false;
    // simple label check (letters, digits, hyphen; labels do not start/end with hyphen)
    return h.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
  }

  async function handleCreate() {
    const host = domainInput.trim();
    if (!host) {
      notifyError('Please enter a domain name');
      return;
    }
    if (!isValidDomain(host)) {
      notifyError('Invalid domain name format');
      return;
    }
    if (!cluster) {
      notifyError('No cluster available');
      return;
    }
    setCreating(true);
    try {
      // 1) Create ClusterDomainClaim first (ignore if already exists)
      try {
        await createClusterDomainClaim({
          cluster,
          domain: host,
          namespace,
        }).unwrap();
      } catch (e: unknown) {
        const error = e as { message?: string } | undefined;
        const msg = String(error?.message || '');
        // Ignore if already exists or conflicts (loosely check for 409/AlreadyExists messages)
        if (!/AlreadyExists|409|exists/i.test(msg)) {
          throw e;
        }
      }
      // 2) Create DomainMapping
      await createDomainMapping({
        cluster,
        namespace,
        domain: host,
        serviceName,
        serviceNamespace: namespace,
      }).unwrap();
      notifyInfo('DomainMapping created');
      setDomainInput('');
    } catch (err: unknown) {
      const error = err as { message?: string } | undefined;
      const detail = error?.message?.trim();
      notifyError(detail ? `Failed to create: ${detail}` : 'Failed to create DomainMapping');
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(dm: DomainMapping) {
    const name = dm.metadata?.name;
    const ns = dm.metadata?.namespace || namespace;
    if (!name || !cluster) return;
    try {
      await deleteDomainMapping({
        cluster,
        namespace: ns,
        domain: name,
      }).unwrap();
      notifyInfo('DomainMapping deleted');
    } catch (err: unknown) {
      const error = err as { message?: string } | undefined;
      const detail = error?.message?.trim();
      notifyError(detail ? `Failed to delete: ${detail}` : 'Failed to delete DomainMapping');
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={1}>
        <Typography variant="subtitle1" gutterBottom>
          Custom Domains (DomainMapping)
        </Typography>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <TextField
            label="Domain name (e.g. app.example.com)"
            size="small"
            value={domainInput}
            onChange={e => setDomainInput(e.target.value)}
            disabled={creating}
            fullWidth
          />
          <Button variant="contained" onClick={handleCreate} disabled={creating}>
            Create
          </Button>
        </Stack>

        <Box>
          {loading || domainMappingsError ? (
            <Typography variant="body2" color="text.secondary">
              {domainMappingsError ? 'Error loading DomainMappings' : 'Loading...'}
            </Typography>
          ) : (mappings?.length ?? 0) === 0 ? (
            <Typography variant="body2" color="text.secondary">
              -
            </Typography>
          ) : (
            <Stack spacing={0.5}>
              {(mappings ?? []).map(dm => {
                const url = readyUrl(dm);
                const isReady =
                  dm.status?.conditions?.find(c => c.type === 'Ready')?.status === 'True';
                return (
                  <Stack
                    key={`${dm.metadata?.namespace}/${dm.metadata?.name}`}
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: 'center' }}
                  >
                    <Typography variant="body2">{dm.metadata?.name}</Typography>
                    {isReady ? (
                      <Chip label="Ready" color="success" size="small" />
                    ) : (
                      <Chip label="Not Ready" color="warning" size="small" />
                    )}
                    {!isReady && cdcMissingByHost[dm.metadata?.name || ''] && (
                      <>
                        <Chip label="ClusterDomainClaim missing" color="warning" size="small" />
                        <Button
                          variant="text"
                          size="small"
                          onClick={async () => {
                            const host = dm.metadata?.name || '';
                            if (!host || !cluster) return;
                            try {
                              await createClusterDomainClaim({
                                cluster,
                                domain: host,
                                namespace,
                              }).unwrap();
                              notifyInfo('ClusterDomainClaim created');
                              // Add dummy annotation to trigger DomainMapping reconciliation
                              try {
                                await annotateDomainMapping({
                                  cluster,
                                  namespace,
                                  domain: host,
                                  annotations: {
                                    'knative.headlamp.dev/reconciledAt': new Date().toISOString(),
                                  },
                                }).unwrap();
                              } catch (e2: unknown) {
                                const error2 = e2 as { message?: string } | undefined;
                                const detail2 = error2?.message?.trim();
                                notifyError(
                                  detail2
                                    ? `Failed to annotate DomainMapping: ${detail2}`
                                    : 'Failed to annotate DomainMapping'
                                );
                              }
                            } catch (e: unknown) {
                              const error = e as { message?: string } | undefined;
                              const detail = error?.message?.trim();
                              notifyError(
                                detail
                                  ? `Failed to create ClusterDomainClaim: ${detail}`
                                  : 'Failed to create ClusterDomainClaim'
                              );
                            }
                          }}
                        >
                          Create ClusterDomainClaim
                        </Button>
                      </>
                    )}
                    <Typography variant="caption" color="text.secondary">
                      {url ? (
                        <a href={url} target="_blank" rel="noreferrer">
                          {url}
                        </a>
                      ) : (
                        '-'
                      )}
                    </Typography>
                    <Box flexGrow={1} />
                    <Button
                      variant="outlined"
                      size="small"
                      color="error"
                      onClick={() => handleDelete(dm)}
                    >
                      Delete
                    </Button>
                  </Stack>
                );
              })}
            </Stack>
          )}
        </Box>
      </Stack>
    </Paper>
  );
}
