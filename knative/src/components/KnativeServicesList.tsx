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
  Typography,
} from '@mui/material';
import type { KnativeService } from '../types/knative';
import { getAge, listServices } from '../api/knative';
import KnativeServiceDetails from './KnativeServiceDetails';

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

  const namespaces = React.useMemo(() => {
    const set = new Set<string>();
    services?.forEach(s => s.metadata.namespace && set.add(s.metadata.namespace));
    return Array.from(set).sort();
  }, [services]);

  React.useEffect(() => {
    let mounted = true;
    let intervalId: number | undefined;

    const fetchServices = async () => {
      try {
        const items = await listServices();
        if (mounted) {
          setServices(items);
          setError(null);
        }
      } catch (err) {
        if (mounted) {
          setError((err as Error)?.message || 'Failed to load services');
        }
      }
    };

    fetchServices();
    intervalId = window.setInterval(fetchServices, 10000);

    return () => {
      mounted = false;
      if (intervalId) {
        window.clearInterval(intervalId);
      }
    };
  }, []);

  const filtered = React.useMemo(() => {
    if (!services) return [];
    return services.filter(s => nsFilter === 'all' || s.metadata.namespace === nsFilter);
  }, [services, nsFilter]);

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

  return (
    <Stack spacing={2} p={2}>
      <Box display="flex" justifyContent="space-between" alignItems="center">
        <Typography variant="h5">KServices</Typography>
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
      </Box>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small" stickyHeader aria-label="Knative services table">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Namespace</TableCell>
              <TableCell>URL</TableCell>
              <TableCell>Latest Revision</TableCell>
              <TableCell>Traffic</TableCell>
              <TableCell>Tags</TableCell>
              <TableCell>Age</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filtered.map(svc => {
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
                    {svc.status?.url ? (
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
    </Stack>
  );
}
