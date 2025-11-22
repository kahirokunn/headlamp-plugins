import React from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  Typography,
} from '@mui/material';
import type { KnativeService } from '../types/knative';
import { fetchIngressClass, getAge, listServices, listDomainMappings } from '../api/knative';
import { formatIngressClass } from '../config/ingress';
import KnativeServiceDetails from './KnativeServiceDetails';
import CreateKnativeServiceDialog from './CreateKnativeServiceDialog';

type SortKey = 'name' | 'namespace' | 'url' | 'latestRevision' | 'traffic' | 'tags' | 'age';

function trafficSummary(svc: KnativeService): string {
  const tr = svc.spec?.traffic || [];
  // Don't display 0% traffic
  const nonZero = tr.filter(t => (t.percent ?? 0) > 0);
  if (!nonZero.length) return '';
  return nonZero
    .map(t => {
      const target = t.latestRevision ? 'latest' : t.revisionName || 'rev';
      return `${t.percent ?? 0}% ${target}`;
    })
    .join(', ');
}

export default function KnativeServicesList() {
  const [services, setServices] = React.useState<KnativeService[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [nsFilter, setNsFilter] = React.useState<string>('all');
  const [detailOpen, setDetailOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<{ namespace: string; name: string } | null>(null);
  const [domainByServiceKey, setDomainByServiceKey] = React.useState<Record<string, string[]>>({});
  const [createOpen, setCreateOpen] = React.useState(false);
  const [sortKey, setSortKey] = React.useState<SortKey>('name');
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>('asc');
  const [ingressClass, setIngressClass] = React.useState<string | null>(null);
  const [ingressClassLoaded, setIngressClassLoaded] = React.useState(false);

  const namespaces = React.useMemo(() => {
    const set = new Set<string>();
    services?.forEach(s => s.metadata.namespace && set.add(s.metadata.namespace));
    return Array.from(set).sort();
  }, [services]);

  const fetchServices = React.useCallback(async () => {
    try {
      const [items, dms] = await Promise.all([listServices(), listDomainMappings()]);
      const domainMap: Record<string, string[]> = {};
      for (const dm of dms || []) {
        const refName = dm.spec?.ref?.name;
        if (!refName) continue;
        const svcNs = dm.spec?.ref?.namespace || dm.metadata?.namespace || 'default';
        const key = `${svcNs}/${refName}`;
        const isReady = dm.status?.conditions?.find(c => c.type === 'Ready')?.status === 'True';
        const url = dm.status?.url || dm.status?.address?.url;
        if (isReady && url) {
          if (!domainMap[key]) domainMap[key] = [];
          if (!domainMap[key].includes(url)) domainMap[key].push(url);
        }
      }
      setServices(items);
      setDomainByServiceKey(domainMap);
      setError(null);
    } catch (err) {
      setError((err as Error)?.message || 'Failed to load services');
    }
  }, []);

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
    let mounted = true;
    let intervalId: number | undefined;
    const wrappedFetch = async () => {
      if (!mounted) return;
      await fetchServices();
    };
    wrappedFetch();
    intervalId = window.setInterval(wrappedFetch, 10000);
    return () => {
      mounted = false;
      if (intervalId) {
        window.clearInterval(intervalId);
      }
    };
  }, [fetchServices]);

  const filtered = React.useMemo(() => {
    if (!services) return [];
    return services.filter(s => nsFilter === 'all' || s.metadata.namespace === nsFilter);
  }, [services, nsFilter]);

  function getSortValue(svc: KnativeService, key: SortKey): string {
    const ns = svc.metadata.namespace || 'default';
    const name = svc.metadata.name;
    const serviceKey = `${ns}/${name}`;
    switch (key) {
      case 'name':
        return name.toLowerCase();
      case 'namespace':
        return ns.toLowerCase();
      case 'url': {
        const urls = domainByServiceKey[serviceKey];
        const primaryUrl = (urls && urls[0]) || svc.status?.url || '';
        return primaryUrl.toLowerCase();
      }
      case 'latestRevision': {
        const latestRevisionFull =
          svc.status?.latestCreatedRevisionName ?? svc.status?.latestReadyRevisionName ?? '';
        const latestRevisionShort =
          latestRevisionFull && latestRevisionFull.startsWith(`${name}-`)
            ? latestRevisionFull.slice(name.length + 1)
            : latestRevisionFull || '';
        return latestRevisionShort.toLowerCase();
      }
      case 'traffic':
        return trafficSummary(svc).toLowerCase();
      case 'tags': {
        const tags = Array.from(
          new Set((svc.spec?.traffic ?? []).map(t => t.tag).filter((v): v is string => Boolean(v)))
        ).sort();
        return tags.join(',').toLowerCase();
      }
      case 'age':
        return svc.metadata.creationTimestamp || '';
      default:
        return '';
    }
  }

  function handleSort(nextKey: SortKey) {
    if (sortKey === nextKey) {
      setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(nextKey);
      setSortDir('asc');
    }
  }

  const sorted = React.useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      const av = getSortValue(a, sortKey);
      const bv = getSortValue(b, sortKey);
      if (av === bv) return 0;
      const cmp = av < bv ? -1 : 1;
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [filtered, sortKey, sortDir, domainByServiceKey]);

  if (error) {
    return (
      <Box p={2}>
        <Typography color="error">{error}</Typography>
      </Box>
    );
  }

  if (!services) {
    return (
      <Box p={4} display="flex" justifyContent="center" alignItems="center">
        <CircularProgress />
      </Box>
    );
  }

  function displayIngressClass(): string {
    if (!ingressClassLoaded) return '';
    return formatIngressClass(ingressClass);
  }

  return (
    <Stack spacing={2} p={2}>
      <Box display="flex" justifyContent="space-between" alignItems="center">
        <Typography variant="h5">KServices</Typography>
        <Stack direction="row" spacing={1} alignItems="center">
          <FormControl size="small" sx={{ minWidth: 220 }}>
            <InputLabel id="ns-filter">Namespace</InputLabel>
            <Select
              labelId="ns-filter"
              label="Namespace"
              value={nsFilter}
              onChange={e => setNsFilter(e.target.value)}
            >
              <MenuItem value="all">All namespaces</MenuItem>
              {namespaces.map(ns => (
                <MenuItem key={ns} value={ns}>
                  {ns}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Button variant="contained" onClick={() => setCreateOpen(true)}>
            Create Service
          </Button>
        </Stack>
      </Box>

      {ingressClassLoaded && (
        <Typography variant="body2" color="text.secondary">
          Ingress class: {displayIngressClass()}
        </Typography>
      )}

      <TableContainer component={Paper} variant="outlined">
        <Table size="small" stickyHeader aria-label="Knative services table">
          <TableHead>
            <TableRow>
              <TableCell sortDirection={sortKey === 'name' ? sortDir : false}>
                <TableSortLabel
                  active={sortKey === 'name'}
                  direction={sortKey === 'name' ? sortDir : 'asc'}
                  onClick={() => handleSort('name')}
                >
                  Name
                </TableSortLabel>
              </TableCell>
              <TableCell sortDirection={sortKey === 'namespace' ? sortDir : false}>
                <TableSortLabel
                  active={sortKey === 'namespace'}
                  direction={sortKey === 'namespace' ? sortDir : 'asc'}
                  onClick={() => handleSort('namespace')}
                >
                  Namespace
                </TableSortLabel>
              </TableCell>
              <TableCell sortDirection={sortKey === 'url' ? sortDir : false}>
                <TableSortLabel
                  active={sortKey === 'url'}
                  direction={sortKey === 'url' ? sortDir : 'asc'}
                  onClick={() => handleSort('url')}
                >
                  URL
                </TableSortLabel>
              </TableCell>
              <TableCell sortDirection={sortKey === 'latestRevision' ? sortDir : false}>
                <TableSortLabel
                  active={sortKey === 'latestRevision'}
                  direction={sortKey === 'latestRevision' ? sortDir : 'asc'}
                  onClick={() => handleSort('latestRevision')}
                >
                  Latest Revision
                </TableSortLabel>
              </TableCell>
              <TableCell sortDirection={sortKey === 'traffic' ? sortDir : false}>
                <TableSortLabel
                  active={sortKey === 'traffic'}
                  direction={sortKey === 'traffic' ? sortDir : 'asc'}
                  onClick={() => handleSort('traffic')}
                >
                  Traffic
                </TableSortLabel>
              </TableCell>
              <TableCell sortDirection={sortKey === 'tags' ? sortDir : false}>
                <TableSortLabel
                  active={sortKey === 'tags'}
                  direction={sortKey === 'tags' ? sortDir : 'asc'}
                  onClick={() => handleSort('tags')}
                >
                  Tags
                </TableSortLabel>
              </TableCell>
              <TableCell sortDirection={sortKey === 'age' ? sortDir : false}>
                <TableSortLabel
                  active={sortKey === 'age'}
                  direction={sortKey === 'age' ? sortDir : 'asc'}
                  onClick={() => handleSort('age')}
                >
                  Age
                </TableSortLabel>
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sorted.map(svc => {
              const ns = svc.metadata.namespace || 'default';
              const name = svc.metadata.name;
              const isReady =
                svc.status?.conditions?.find(c => c.type === 'Ready')?.status === 'True';
              const latestRevisionFull =
                svc.status?.latestCreatedRevisionName ?? svc.status?.latestReadyRevisionName ?? '';
              const latestRevisionShort =
                latestRevisionFull && latestRevisionFull.startsWith(`${name}-`)
                  ? latestRevisionFull.slice(name.length + 1)
                  : latestRevisionFull || '-';
              const tags = Array.from(
                new Set(
                  (svc.spec?.traffic ?? []).map(t => t.tag).filter((v): v is string => Boolean(v))
                )
              ).sort();
              return (
                <TableRow key={`${ns}/${name}`} hover>
                  <TableCell>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Button
                        size="small"
                        onClick={() => {
                          setSelected({ namespace: ns, name });
                          setDetailOpen(true);
                        }}
                      >
                        {name}
                      </Button>
                      {svc.metadata?.labels?.['networking.knative.dev/visibility'] ===
                      'cluster-local' ? (
                        <Chip label="Internal" color="info" size="small" />
                      ) : (
                        <Chip label="External" color="info" size="small" />
                      )}
                      {svc.status?.conditions?.find(
                        c => c.type === 'Ready' && c.status === 'True'
                      ) ? (
                        <Chip label="Ready" color="success" size="small" />
                      ) : (
                        <Chip label="Not Ready" color="warning" size="small" />
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell>{ns}</TableCell>
                  <TableCell>
                    {domainByServiceKey[`${ns}/${name}`] &&
                    domainByServiceKey[`${ns}/${name}`].length > 0 ? (
                      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                        {domainByServiceKey[`${ns}/${name}`].map(u => (
                          <a key={u} href={u} target="_blank" rel="noreferrer">
                            {u}
                          </a>
                        ))}
                      </Stack>
                    ) : svc.status?.url ? (
                      <Stack direction="row" spacing={1} alignItems="center">
                        <a href={svc.status.url} target="_blank" rel="noreferrer">
                          {svc.status.url}
                        </a>
                      </Stack>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        -
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    {latestRevisionShort !== '-' ? (
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Typography variant="body2">{latestRevisionShort}</Typography>
                        {isReady ? (
                          <Chip label="Ready" color="success" size="small" />
                        ) : (
                          <Chip label="Not Ready" color="warning" size="small" />
                        )}
                      </Stack>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        -
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {trafficSummary(svc) || '-'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {tags.length ? (
                      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                        {tags.map(tag => (
                          <Chip key={tag} label={tag} size="small" />
                        ))}
                      </Stack>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        -
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>{getAge(svc.metadata.creationTimestamp)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={detailOpen} onClose={() => setDetailOpen(false)} fullWidth maxWidth="lg">
        <DialogTitle>Service Details</DialogTitle>
        <DialogContent dividers>
          {selected && (
            <KnativeServiceDetails namespace={selected.namespace} name={selected.name} />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDetailOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {createOpen && (
        <CreateKnativeServiceDialog
          onClose={() => setCreateOpen(false)}
          onCreated={fetchServices}
        />
      )}
    </Stack>
  );
}
