import React from 'react';
import { Paper, Stack, Typography } from '@mui/material';
import type { HTTPRoute } from '../api/envoy';
import { Link as HeadlampLink } from '@kinvolk/headlamp-plugin/lib/CommonComponents';

type HttpRoutesSectionProps = {
  title: string;
  namespace: string;
  routes: HTTPRoute[] | null;
};

export default function HttpRoutesSection({ title, namespace, routes }: HttpRoutesSectionProps) {
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={1}>
        <Typography variant="subtitle1" gutterBottom>
          {title}
        </Typography>
        {routes && routes.length > 0 ? (
          <Stack spacing={0.5}>
            {routes.map(r => (
              <Stack key={r.metadata.name} direction="row" spacing={1} alignItems="center">
                <HeadlampLink
                  routeName="/plugins/envoy-gateway/httproutes/:namespace/:name"
                  params={{ namespace, name: r.metadata.name }}
                >
                  {r.metadata.name}
                </HeadlampLink>
                <Typography variant="caption" color="text.secondary">
                  {(r.spec?.hostnames ?? []).join(', ')}
                </Typography>
              </Stack>
            ))}
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary">
            -
          </Typography>
        )}
      </Stack>
    </Paper>
  );
}
