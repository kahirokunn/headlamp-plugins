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
import {
  getAge,
  useWatchKnativeServices,
  useWatchDomainMappings,
  useFetchIngressClassQuery,
} from '../api/knativeRtkApi';
import type { KnativeServiceWithCluster } from '../api/knativeRtkApi';
import { useClusters } from '../hooks/useClusters';
import { formatIngressClass, INGRESS_CLASS_GATEWAY_API } from '../config/ingress';
import KnativeServiceDetails from './KnativeServiceDetails';
import CreateKnativeServiceDialogWithClusterSelector from './CreateKnativeServiceDialogWithClusterSelector';

type SortKey =
  | 'name'
  | 'namespace'
  | 'cluster'
  | 'visibility'
  | 'url'
  | 'latestRevision'
  | 'traffic'
  | 'tags'
  | 'age';

function trafficSummary(svc: KnativeServiceWithCluster): string {
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
  const clusters = useClusters();
  const [nsFilter, setNsFilter] = React.useState<string>('all');
  const [detailOpen, setDetailOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<{
    namespace: string;
    name: string;
    cluster: string;
  } | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [sortKey, setSortKey] = React.useState<SortKey>('name');
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>('asc');

  const {
    data: servicesData,
    error: servicesError,
    isLoading: servicesLoading,
  } = useWatchKnativeServices({ clusters });

  const { data: domainMappingsData, error: domainMappingsError } = useWatchDomainMappings({
    clusters,
  });

  const { data: ingressClassData, isLoading: ingressClassLoading } = useFetchIngressClassQuery({
    clusters,
  });

  const showClusterColumn = clusters.length > 1;

  const services = React.useMemo(() => {
    if (!servicesData) return null;
    return servicesData;
  }, [servicesData]);

  const domainByServiceKey = React.useMemo(() => {
    const domainMap: Record<string, string[]> = {};
    if (!domainMappingsData) return domainMap;
    for (const dm of domainMappingsData) {
      const refName = dm.spec.ref.name;
      if (!refName) continue;
      const svcNs = dm.spec.ref.namespace || dm.metadata.namespace!;
      const key = `${dm.cluster}/${svcNs}/${refName}`;
      const isReady = dm.status?.conditions?.find(c => c.type === 'Ready')?.status === 'True';
      const url = dm.status?.url || dm.status?.address?.url;
      if (isReady && url) {
        if (!domainMap[key]) domainMap[key] = [];
        if (!domainMap[key].includes(url)) domainMap[key].push(url);
      }
    }
    return domainMap;
  }, [domainMappingsData]);

  const ingressClasses = React.useMemo(
    () =>
      ingressClassData?.map(({ cluster, ingressClass }) => {
        const formatted = formatIngressClass(ingressClass);
        const isGatewayApi = ingressClass === INGRESS_CLASS_GATEWAY_API;
        const isSet = ingressClass != null;

        const color: 'default' | 'success' | 'warning' = isGatewayApi
          ? 'success'
          : isSet
          ? 'default'
          : 'warning';

        const variant: 'filled' | 'outlined' = isSet ? 'filled' : 'outlined';

        const label = clusters.length > 1 ? `${cluster}: ${formatted}` : formatted;

        return {
          key: cluster,
          label,
          color,
          variant,
        };
      }) || [],
    [ingressClassData, clusters]
  );

  const ingressClassLabel = React.useMemo(() => {
    if (!ingressClassData || ingressClassData.length <= 1) {
      return 'Ingress class';
    }
    return 'Ingress classes';
  }, [ingressClassData]);

  const error = React.useMemo(() => {
    if (servicesError) {
      return servicesError.message || 'Failed to load services';
    }
    if (domainMappingsError) {
      return domainMappingsError.message || 'Failed to load domain mappings';
    }
    return null;
  }, [servicesError, domainMappingsError]);

  const namespaces = React.useMemo(() => {
    const set = new Set<string>();
    services?.forEach(s => s.metadata.namespace && set.add(s.metadata.namespace));
    return Array.from(set).sort();
  }, [services]);

  const filtered = React.useMemo(() => {
    if (!services) return [];
    return services.filter(s => nsFilter === 'all' || s.metadata.namespace === nsFilter);
  }, [services, nsFilter]);

  function getSortValue(svc: KnativeServiceWithCluster, key: SortKey): string {
    const ns = svc.metadata.namespace!;
    const name = svc.metadata.name;
    const serviceKey = `${svc.cluster}/${ns}/${name}`;
    switch (key) {
      case 'name':
        return name.toLowerCase();
      case 'namespace':
        return ns.toLowerCase();
      case 'cluster':
        return svc.cluster.toLowerCase();
      case 'visibility': {
        const visibilityLabel =
          svc.metadata.labels?.['networking.knative.dev/visibility'] === 'cluster-local'
            ? 'internal'
            : 'external';
        return visibilityLabel;
      }
      case 'url': {
        const urls = domainByServiceKey[serviceKey];
        const primaryUrl = urls?.[0] || svc.status?.url || '';
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

  if (servicesLoading || !services) {
    return (
      <Box p={4} display="flex" justifyContent="center" alignItems="center">
        <CircularProgress />
      </Box>
    );
  }

  const selectedKservice = servicesData?.find(
    s =>
      selected &&
      s.cluster === selected.cluster &&
      s.metadata.namespace === selected.namespace &&
      s.metadata.name === selected.name
  );

  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      <Box display="flex" justifyContent="space-between" alignItems="center">
        <Typography variant="h5">KServices</Typography>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
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
          <Button
            variant="contained"
            onClick={() => setCreateOpen(true)}
            disabled={clusters.length === 0}
          >
            Create Service
          </Button>
        </Stack>
      </Box>

      {!ingressClassLoading && (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography variant="body2" color="text.secondary">
            {ingressClassLabel}:
          </Typography>
          {ingressClasses.length > 0 ? (
            <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }}>
              {ingressClasses.map(item => (
                <Chip
                  key={item.key}
                  label={item.label}
                  size="small"
                  color={item.color}
                  variant={item.variant}
                />
              ))}
            </Stack>
          ) : (
            <Chip label={formatIngressClass(null)} size="small" variant="outlined" />
          )}
        </Stack>
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
              {showClusterColumn && (
                <TableCell sortDirection={sortKey === 'cluster' ? sortDir : false}>
                  <TableSortLabel
                    active={sortKey === 'cluster'}
                    direction={sortKey === 'cluster' ? sortDir : 'asc'}
                    onClick={() => handleSort('cluster')}
                  >
                    Cluster
                  </TableSortLabel>
                </TableCell>
              )}
              <TableCell sortDirection={sortKey === 'visibility' ? sortDir : false}>
                <TableSortLabel
                  active={sortKey === 'visibility'}
                  direction={sortKey === 'visibility' ? sortDir : 'asc'}
                  onClick={() => handleSort('visibility')}
                >
                  Visibility
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
              const visibilityLabel =
                svc.metadata?.labels?.['networking.knative.dev/visibility'] === 'cluster-local'
                  ? 'Internal'
                  : 'External';
              return (
                <TableRow key={`${svc.cluster}/${ns}/${name}`} hover>
                  <TableCell>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <Button
                        size="small"
                        onClick={() => {
                          setSelected({ namespace: ns, name, cluster: svc.cluster });
                          setDetailOpen(true);
                        }}
                      >
                        {name}
                      </Button>
                    </Stack>
                  </TableCell>
                  <TableCell>{ns}</TableCell>
                  {showClusterColumn && <TableCell>{svc.cluster}</TableCell>}
                  <TableCell>
                    <Chip
                      label={visibilityLabel}
                      color={visibilityLabel === 'Internal' ? 'default' : 'primary'}
                      size="small"
                    />
                  </TableCell>
                  <TableCell>
                    {domainByServiceKey[`${svc.cluster}/${ns}/${name}`] &&
                    domainByServiceKey[`${svc.cluster}/${ns}/${name}`].length > 0 ? (
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                      >
                        {domainByServiceKey[`${svc.cluster}/${ns}/${name}`].map(u => (
                          <a key={u} href={u} target="_blank" rel="noreferrer">
                            {u}
                          </a>
                        ))}
                      </Stack>
                    ) : svc.status?.url ? (
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
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
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
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
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                      >
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
        <DialogTitle>KService Details</DialogTitle>
        <DialogContent dividers>
          {selectedKservice && <KnativeServiceDetails kservice={selectedKservice} />}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDetailOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {createOpen && (
        <CreateKnativeServiceDialogWithClusterSelector
          clusters={clusters}
          onClose={() => setCreateOpen(false)}
        />
      )}
    </Stack>
  );
}
