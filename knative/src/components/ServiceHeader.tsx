import React from 'react';
import { Button, Chip, Paper, Stack, Typography } from '@mui/material';

type ServiceHeaderProps = {
  serviceName: string;
  namespace: string;
  ready: boolean;
  acting?: string | null;
  onRedeploy: () => void;
  onRestart: () => void;
};

export default function ServiceHeader({
  serviceName,
  namespace,
  ready,
  acting,
  onRedeploy,
  onRestart,
}: ServiceHeaderProps) {
  return (
    <Paper variant="outlined" sx={{ position: 'sticky', top: 0, zIndex: 1, p: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Stack direction="row" spacing={2} alignItems="center">
          <Typography variant="h5">{serviceName}</Typography>
          <Chip label={namespace} size="small" />
          {ready ? (
            <Chip label="Ready" color="success" size="small" />
          ) : (
            <Chip label="Not Ready" color="warning" size="small" />
          )}
        </Stack>
        <Stack direction="row" spacing={1}>
          <Button
            onClick={onRedeploy}
            disabled={!!acting}
            variant="outlined"
            aria-label="Redeploy Latest Revision"
          >
            Redeploy Latest Revision
          </Button>
          <Button onClick={onRestart} disabled={!!acting} variant="contained" aria-label="Restart">
            Restart
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}
