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
  Tooltip,
  Typography,
} from '@mui/material';
import type { Condition } from '../types/knative';
import { getAge } from '../api/knativeRtkApi';

type ConditionsSectionProps = {
  conditions: Condition[];
};

export default function ConditionsSection({ conditions }: ConditionsSectionProps) {
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack>
        <Typography variant="subtitle2" gutterBottom>
          Conditions
        </Typography>
        <TableContainer>
          <Table size="small" sx={{ tableLayout: 'fixed', width: '100%' }}>
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
              {conditions.map(c => (
                <TableRow key={c.type}>
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
                    {c.message ? (
                      <Tooltip title={c.message}>
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          noWrap
                          sx={{ maxWidth: 400 }}
                        >
                          {c.message}
                        </Typography>
                      </Tooltip>
                    ) : (
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        noWrap
                        sx={{ maxWidth: 400 }}
                      >
                        -
                      </Typography>
                    )}
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
