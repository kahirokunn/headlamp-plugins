import React from 'react';
import {
  Box,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  TextField,
  Typography,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
} from '@mui/material';
import { Link as HeadlampLink } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { HTTPRoute, listAllHttpRoutes } from '../api/envoy';

type VisibilityFilter = 'all' | 'external' | 'internal';
type SortKey = 'name' | 'namespace' | 'hosts' | 'backends' | 'visibility';

export default function HttpRoutesList() {
  const [routes, setRoutes] = React.useState<HTTPRoute[] | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState('');
  const [visibility, setVisibility] = React.useState<VisibilityFilter>('all');
  const [namespaceFilter, setNamespaceFilter] = React.useState<string>('all');
  const [sortKey, setSortKey] = React.useState<SortKey>('name');
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>('asc');

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const items = await listAllHttpRoutes();
      setRoutes(items);
    } catch (e) {
      setError((e as Error)?.message || 'Failed to list HTTPRoutes');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  function getVisibilityLabel(r: HTTPRoute): 'external' | 'internal' | '-' {
    const v = (r.metadata?.labels ?? {})['networking.knative.dev/visibility'];
    if (v === '') return 'external';
    if (v === 'cluster-local') return 'internal';
    return '-';
    // Non-Knative HTTPRoutes may not have a visibility label
  }

  function getHostsString(r: HTTPRoute): string {
    return (r.spec?.hostnames ?? []).join(', ');
  }

  function getBackendsSummary(r: HTTPRoute): string {
    const backendRefs = r.spec?.rules?.flatMap(rule => rule.backendRefs ?? []) ?? [];
    if (!backendRefs.length) return '';
    return (
      backendRefs
        .map(br => {
          const name = br.name ?? '';
          if (!name) return null;
          const ns = br.namespace || r.metadata.namespace || '';
          return ns ? `${name} (${ns})` : name;
        })
        .filter(Boolean)
        .join(', ') || ''
    );
  }

  function getSortValue(r: HTTPRoute, key: SortKey): string {
    switch (key) {
      case 'name':
        return (r.metadata?.name || '').toLowerCase();
      case 'namespace':
        return (r.metadata?.namespace || '').toLowerCase();
      case 'hosts':
        return getHostsString(r).toLowerCase();
      case 'backends':
        return getBackendsSummary(r).toLowerCase();
      case 'visibility':
        return getVisibilityLabel(r);
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

  const namespaces = React.useMemo(() => {
    const set = new Set<string>();
    for (const r of routes ?? []) {
      const ns = r.metadata?.namespace || '';
      if (ns) set.add(ns);
    }
    return Array.from(set).sort();
  }, [routes]);

  const filtered = React.useMemo(() => {
    const list = routes ?? [];
    const s = search.trim().toLowerCase();
    return list.filter(r => {
      const vis = getVisibilityLabel(r);
      if (visibility === 'external' && vis !== 'external') return false;
      if (visibility === 'internal' && vis !== 'internal') return false;
      if (namespaceFilter !== 'all' && (r.metadata?.namespace || '') !== namespaceFilter)
        return false;
      if (!s) return true;
      const name = r.metadata?.name?.toLowerCase() || '';
      const ns = (r.metadata?.namespace || '').toLowerCase();
      const hosts = (r.spec?.hostnames ?? []).join(',').toLowerCase();
      return name.includes(s) || ns.includes(s) || hosts.includes(s);
    });
  }, [routes, search, visibility, namespaceFilter]);

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
  }, [filtered, sortKey, sortDir]);

  if (loading) {
    return (
      <Box p={4} display="flex" justifyContent="center" alignItems="center">
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box p={2}>
        <Typography color="error">{error}</Typography>
      </Box>
    );
  }

  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography variant="h5">HTTPRoutes</Typography>
          <TextField
            size="small"
            label="Search (name/ns/host)"
            value={search}
            onChange={e => setSearch(e.target.value)}
            sx={{ minWidth: 260 }}
          />
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel id="visibility-label">Visibility</InputLabel>
            <Select
              labelId="visibility-label"
              value={visibility}
              label="Visibility"
              onChange={e => setVisibility(e.target.value as VisibilityFilter)}
            >
              <MenuItem value="all">All</MenuItem>
              <MenuItem value="external">External</MenuItem>
              <MenuItem value="internal">Internal</MenuItem>
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel id="namespace-label">Namespace</InputLabel>
            <Select
              labelId="namespace-label"
              value={namespaceFilter}
              label="Namespace"
              onChange={e => setNamespaceFilter(e.target.value as string)}
            >
              <MenuItem value="all">All</MenuItem>
              {namespaces.map(ns => (
                <MenuItem key={ns} value={ns}>
                  {ns}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 0 }}>
        <TableContainer>
          <Table size="small" stickyHeader>
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
                <TableCell sortDirection={sortKey === 'hosts' ? sortDir : false}>
                  <TableSortLabel
                    active={sortKey === 'hosts'}
                    direction={sortKey === 'hosts' ? sortDir : 'asc'}
                    onClick={() => handleSort('hosts')}
                  >
                    Hosts
                  </TableSortLabel>
                </TableCell>
                <TableCell sortDirection={sortKey === 'backends' ? sortDir : false}>
                  <TableSortLabel
                    active={sortKey === 'backends'}
                    direction={sortKey === 'backends' ? sortDir : 'asc'}
                    onClick={() => handleSort('backends')}
                  >
                    Backends
                  </TableSortLabel>
                </TableCell>
                <TableCell sortDirection={sortKey === 'visibility' ? sortDir : false}>
                  <TableSortLabel
                    active={sortKey === 'visibility'}
                    direction={sortKey === 'visibility' ? sortDir : 'asc'}
                    onClick={() => handleSort('visibility')}
                  >
                    Visibility
                  </TableSortLabel>
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sorted.map(r => {
                const vis = getVisibilityLabel(r);
                const backendSummary = getBackendsSummary(r);
                return (
                  <TableRow key={`${r.metadata.namespace}/${r.metadata.name}`} hover>
                    <TableCell>
                      <HeadlampLink
                        routeName="/plugins/envoy-gateway/httproutes/:namespace/:name"
                        params={{ namespace: r.metadata.namespace, name: r.metadata.name }}
                      >
                        {r.metadata.name}
                      </HeadlampLink>
                    </TableCell>
                    <TableCell>{r.metadata.namespace}</TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {(r.spec?.hostnames ?? []).join(', ') || '-'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {backendSummary}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {vis === 'external' ? (
                        <Chip label="external" color="success" size="small" />
                      ) : vis === 'internal' ? (
                        <Chip label="internal" color="info" size="small" />
                      ) : (
                        <Chip label="-" size="small" />
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5}>
                    <Typography variant="body2" color="text.secondary">
                      No items
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Stack>
  );
}
