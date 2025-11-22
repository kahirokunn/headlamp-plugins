import React from 'react';
import { Box, Button, Chip, Paper, Stack, TextField, Typography } from '@mui/material';
import type { DomainMapping } from '../types/knative';
import {
  createDomainMapping,
  deleteDomainMapping,
  listDomainMappings,
  createClusterDomainClaim,
  getClusterDomainClaim,
  annotateDomainMapping,
} from '../api/knative';
import { useNotify } from './common/notifications/useNotify';

type Props = {
  namespace: string;
  serviceName: string;
};

export default function DomainMappingSection({ namespace, serviceName }: Props) {
  const { notifyError, notifyInfo } = useNotify();
  const [loading, setLoading] = React.useState<boolean>(false);
  const [creating, setCreating] = React.useState<boolean>(false);
  const [domainInput, setDomainInput] = React.useState<string>('');
  const [mappings, setMappings] = React.useState<DomainMapping[] | null>(null);
  const [cdcMissingByHost, setCdcMissingByHost] = React.useState<Record<string, boolean>>({});

  const refetch = React.useCallback(async () => {
    setLoading(true);
    try {
      const all = await listDomainMappings();
      const filtered = (all || []).filter(dm => {
        const ref = dm.spec?.ref;
        const refNs = ref?.namespace || dm.metadata?.namespace;
        return ref?.name === serviceName && refNs === namespace;
      });
      setMappings(filtered);
    } catch (err) {
      const detail = (err as Error)?.message?.trim();
      notifyError(
        detail ? `Failed to fetch DomainMappings: ${detail}` : 'Failed to fetch DomainMappings'
      );
      setMappings([]);
    } finally {
      setLoading(false);
    }
  }, [namespace, serviceName, notifyError]);

  React.useEffect(() => {
    refetch();
  }, [refetch]);

  // Periodically refresh to catch Ready transitions after CDC/annotation
  React.useEffect(() => {
    const intervalId = window.setInterval(() => {
      refetch();
    }, 4000);
    return () => window.clearInterval(intervalId);
  }, [refetch]);

  // Check CDC existence for each mapping host (only when not Ready to reduce noise)
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const next: Record<string, boolean> = {};
      for (const dm of mappings ?? []) {
        const host = dm.metadata?.name || '';
        if (!host) continue;
        const ready = dm.status?.conditions?.find(c => c.type === 'Ready')?.status === 'True';
        if (ready) {
          next[host] = false;
          continue;
        }
        // Try exact host, then parent one level (best-effort)
        const candidates = [host];
        const parts = host.split('.');
        if (parts.length >= 3) {
          candidates.push(parts.slice(1).join('.'));
        }
        let exists = false;
        for (const name of candidates) {
          const cdc = await getClusterDomainClaim(name);
          if (cdc) {
            exists = true;
            break;
          }
        }
        next[host] = !exists;
      }
      if (!cancelled) setCdcMissingByHost(next);
    })();
    return () => {
      cancelled = true;
    };
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
    setCreating(true);
    try {
      // 1) Create ClusterDomainClaim first (ignore if already exists)
      try {
        await createClusterDomainClaim(host, namespace);
      } catch (e) {
        const msg = String((e as Error)?.message || '');
        // Ignore if already exists or conflicts (loosely check for 409/AlreadyExists messages)
        if (!/AlreadyExists|409|exists/i.test(msg)) {
          throw e;
        }
      }
      // 2) Create DomainMapping
      await createDomainMapping({
        namespace,
        domain: host,
        serviceName,
        serviceNamespace: namespace,
      });
      notifyInfo('DomainMapping created');
      setDomainInput('');
      refetch();
    } catch (err) {
      const detail = (err as Error)?.message?.trim();
      notifyError(detail ? `Failed to create: ${detail}` : 'Failed to create DomainMapping');
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(dm: DomainMapping) {
    const name = dm.metadata?.name;
    const ns = dm.metadata?.namespace || namespace;
    if (!name) return;
    try {
      await deleteDomainMapping(ns, name);
      notifyInfo('DomainMapping deleted');
      refetch();
    } catch (err) {
      const detail = (err as Error)?.message?.trim();
      notifyError(detail ? `Failed to delete: ${detail}` : 'Failed to delete DomainMapping');
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={1}>
        <Typography variant="subtitle1" gutterBottom>
          Custom Domains (DomainMapping)
        </Typography>
        <Stack direction="row" spacing={1} alignItems="center">
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
          {loading ? (
            <Typography variant="body2" color="text.secondary">
              Loading...
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
                    alignItems="center"
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
                            if (!host) return;
                            try {
                              await createClusterDomainClaim(host, namespace);
                              notifyInfo('ClusterDomainClaim created');
                              // Add dummy annotation to trigger DomainMapping reconciliation
                              try {
                                await annotateDomainMapping(namespace, host, {
                                  'knative.headlamp.dev/reconciledAt': new Date().toISOString(),
                                });
                              } catch (e2) {
                                const detail2 = (e2 as Error)?.message?.trim();
                                notifyError(
                                  detail2
                                    ? `Failed to annotate DomainMapping: ${detail2}`
                                    : 'Failed to annotate DomainMapping'
                                );
                              }
                              refetch();
                            } catch (e) {
                              const detail = (e as Error)?.message?.trim();
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
