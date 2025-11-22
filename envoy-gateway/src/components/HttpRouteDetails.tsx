import React from 'react';
import { Box, Chip, CircularProgress, Paper, Stack, Typography } from '@mui/material';
import { useParams } from 'react-router-dom';
import { getHttpRoute } from '../api/envoy';
import BasicAuthSection from './sections/BasicAuthSection';
import RetrySection from './sections/RetrySection';
import IpAccessSection from './sections/IpAccessSection';

export default function HttpRouteDetails() {
  const params = useParams<{ namespace: string; name: string }>();
  const namespace = params.namespace ?? '';
  const name = params.name ?? '';
  const [hosts, setHosts] = React.useState<string[] | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const route = await getHttpRoute(namespace, name);
      const hs = route?.spec?.hostnames ?? [];
      setHosts(hs);
    } catch (e) {
      setError((e as Error)?.message || 'Failed to load HTTPRoute');
    } finally {
      setLoading(false);
    }
  }, [namespace, name]);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

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

  const primaryHost = hosts?.[0] || '';

  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          <Typography variant="h5">HTTPRoute</Typography>
          <Chip label={name} size="small" />
          <Chip label={namespace} size="small" />
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography variant="subtitle2">Hosts:</Typography>
            {hosts?.length ? (
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                {hosts.map(h => (
                  <Chip key={h} label={h} size="small" variant="outlined" />
                ))}
              </Stack>
            ) : (
              <Typography variant="body2" color="text.secondary">
                -
              </Typography>
            )}
          </Stack>
        </Stack>
      </Paper>

      {!!primaryHost && (
        <>
          <BasicAuthSection namespace={namespace} host={primaryHost} onChanged={refresh} />
          <RetrySection namespace={namespace} host={primaryHost} onChanged={refresh} />
          <IpAccessSection namespace={namespace} host={primaryHost} onChanged={refresh} />
        </>
      )}
    </Stack>
  );
}
