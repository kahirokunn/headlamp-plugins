import React from 'react';
import {
  Box,
  Button,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  SelectChangeEvent,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import type { KnativeService } from '../types/knative';
import { useNotify } from './common/notifications/useNotify';
import { updateAutoscalingSettings } from '../api/knative';

type MetricType = '' | 'concurrency' | 'rps';

type AutoscalingDefaults = {
  concurrencyTarget: number;
  targetUtilizationPercentage: number;
  rpsTarget: number;
  containerConcurrency: number;
  minScale: number;
  maxScale: number;
  maxScaleLimit?: number;
  initialScale: number;
  allowZeroInitialScale: boolean;
  scaleDownDelay: string;
  stableWindow: string;
  activationScaleDefault: number;
};

export default function AutoscalingSettings({
  namespace,
  name,
  service,
  defaults,
  onSaved,
}: {
  namespace: string;
  name: string;
  service: KnativeService;
  defaults: AutoscalingDefaults | null;
  onSaved?: () => void;
}) {
  const anns = service?.spec?.template?.metadata?.annotations ?? {};
  const templateSpec = (service?.spec?.template?.spec as Record<string, unknown>) ?? {};

  const [metric, setMetric] = React.useState<MetricType>(
    (anns['autoscaling.knative.dev/metric'] as MetricType) || ''
  );
  const [target, setTarget] = React.useState<string>(anns['autoscaling.knative.dev/target'] ?? '');
  const [util, setUtil] = React.useState<string>(
    anns['autoscaling.knative.dev/target-utilization-percentage'] ?? ''
  );
  const [hard, setHard] = React.useState<string>(
    templateSpec?.hasOwnProperty('containerConcurrency')
      ? String((templateSpec as any).containerConcurrency ?? '')
      : ''
  );
  const [saving, setSaving] = React.useState(false);

  const { notifySuccess, notifyError } = useNotify();

  function resetSection() {
    const a = service?.spec?.template?.metadata?.annotations ?? {};
    const s = (service?.spec?.template?.spec as Record<string, unknown>) ?? {};
    setMetric((a['autoscaling.knative.dev/metric'] as MetricType) || '');
    setTarget(a['autoscaling.knative.dev/target'] ?? '');
    setUtil(a['autoscaling.knative.dev/target-utilization-percentage'] ?? '');
    setHard(
      s?.hasOwnProperty('containerConcurrency') ? String((s as any).containerConcurrency ?? '') : ''
    );
  }

  function isValid(): boolean {
    // hard limit: integer >= 0 or empty
    if (hard !== '') {
      const n = Number(hard);
      if (!Number.isInteger(n) || n < 0) return false;
    }
    // metric+target consistency
    if (metric) {
      if (target === '') return false;
      const t = Number(target);
      if (!Number.isFinite(t) || t <= 0) return false;
    } else {
      // when metric is unset, target should be empty (we allow user to clear)
    }
    // utilization: 1-100 float, or empty
    if (util !== '') {
      const u = Number(util);
      if (!Number.isFinite(u) || u <= 0 || u > 100) return false;
    }
    return true;
  }

  async function onSave() {
    if (!isValid()) return;
    setSaving(true);
    try {
      const metricToSave = metric ? (metric as 'concurrency' | 'rps') : undefined;
      await updateAutoscalingSettings(namespace, name, {
        metric: metricToSave,
        target: target === '' ? null : Number(target),
        targetUtilization: util === '' ? null : Number(util),
        containerConcurrency: hard === '' ? null : Number(hard),
      });
      notifySuccess('Autoscaling updated');
      onSaved?.();
    } catch (err) {
      const detail = (err as Error)?.message?.trim();
      notifyError(detail ? `Failed to update settings: ${detail}` : 'Failed to update settings');
    } finally {
      setSaving(false);
    }
  }

  const effectiveMetric = metric || 'concurrency';
  const resolvedDefaultTarget =
    effectiveMetric === 'rps' ? defaults?.rpsTarget : defaults?.concurrencyTarget;
  const resolvedDefaultUtil = defaults?.targetUtilizationPercentage;
  const resolvedDefaultHard = defaults?.containerConcurrency;

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={2}>
        <Typography variant="subtitle1">Autoscaling</Typography>

        <Stack direction="row" spacing={2}>
          <FormControl sx={{ minWidth: 220 }}>
            <InputLabel id="metric-label">Metric</InputLabel>
            <Select
              size="small"
              labelId="metric-label"
              label="Metric"
              value={metric}
              onChange={(e: SelectChangeEvent<string>) =>
                setMetric((e.target.value as MetricType) || '')
              }
            >
              <MenuItem value="">
                <em>
                  Unset
                  {resolvedDefaultTarget != null
                    ? ` (default target: ${resolvedDefaultTarget})`
                    : ' (use cluster default)'}
                </em>
              </MenuItem>
              <MenuItem value="concurrency">Concurrency</MenuItem>
              <MenuItem value="rps">RPS</MenuItem>
            </Select>
          </FormControl>

          <TextField
            size="small"
            type="number"
            label={effectiveMetric === 'rps' ? 'RPS target' : 'Concurrency target'}
            value={target}
            onChange={e => setTarget(e.target.value)}
            inputProps={{ min: 1, step: 1, inputMode: 'numeric' }}
            helperText={
              metric
                ? resolvedDefaultTarget != null
                  ? `Per-revision soft limit target (default: ${resolvedDefaultTarget})`
                  : 'Per-revision soft limit target'
                : resolvedDefaultTarget != null
                ? `Disabled when Metric is unset (default: ${resolvedDefaultTarget})`
                : 'Disabled when Metric is unset'
            }
            disabled={!metric}
          />

          <TextField
            size="small"
            type="number"
            label="Target utilization %"
            value={util}
            onChange={e => setUtil(e.target.value)}
            inputProps={{ min: 1, max: 100, step: 1, inputMode: 'numeric' }}
            helperText={
              resolvedDefaultUtil != null
                ? `Optional (default: ${resolvedDefaultUtil}%)`
                : 'Optional'
            }
          />
        </Stack>

        <Stack direction="row" spacing={2}>
          <TextField
            size="small"
            type="number"
            label="Hard limit (containerConcurrency)"
            value={hard}
            onChange={e => setHard(e.target.value)}
            inputProps={{ min: 0, step: 1, inputMode: 'numeric' }}
            helperText={
              resolvedDefaultHard != null
                ? `0 = no limit (default: ${resolvedDefaultHard})`
                : '0 = no limit. Enforced upper bound per replica.'
            }
          />
        </Stack>

        <Box display="flex" justifyContent="space-between" alignItems="center">
          <Typography variant="body2" color={isValid() ? 'text.secondary' : 'error'}>
            {isValid() ? 'All inputs valid' : 'Fix invalid inputs'}
          </Typography>
          <Box display="flex" gap={1}>
            <Button variant="text" onClick={resetSection} aria-label="Reset autoscaling">
              Reset
            </Button>
            <Button
              variant="contained"
              onClick={onSave}
              disabled={!isValid() || saving}
              aria-label="Save autoscaling"
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </Box>
        </Box>
      </Stack>
    </Paper>
  );
}
