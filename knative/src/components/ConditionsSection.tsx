import React from 'react';
import {
  Chip,
  Paper,
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
import { getAge } from '../api/knative';

type Condition = NonNullable<KnativeService['status']>['conditions'][number];

type ConditionsSectionProps = {
  title?: string;
  conditions: Condition[] | undefined | null;
};

export default function ConditionsSection({
  title = 'Conditions',
  conditions,
}: ConditionsSectionProps) {
  const conds = conditions ?? [];
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack>
        <Typography variant="subtitle2" gutterBottom>
          {title}
        </Typography>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Type</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Reason</TableCell>
                <TableCell>Message</TableCell>
                <TableCell>Last Transition</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {conds.map((c, i) => (
                <TableRow key={i}>
                  <TableCell>{c.type}</TableCell>
                  <TableCell>
                    {c.status === 'True' ? (
                      <Chip label="True" color="success" size="small" />
                    ) : c.status === 'False' ? (
                      <Chip label="False" color="error" size="small" />
                    ) : (
                      <Chip label={c.status || 'Unknown'} color="warning" size="small" />
                    )}
                  </TableCell>
                  <TableCell>{c.reason || '-'}</TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {c.message || '-'}
                    </Typography>
                  </TableCell>
                  <TableCell>{c.lastTransitionTime ? getAge(c.lastTransitionTime) : '-'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Stack>
    </Paper>
  );
}
