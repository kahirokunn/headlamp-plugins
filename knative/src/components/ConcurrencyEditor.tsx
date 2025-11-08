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
import { updateAutoscalingSettings, fetchAutoscalingGlobalDefaults } from '../api/knative';

type MetricType = '' | 'concurrency' | 'rps';

export default function ConcurrencyEditor({
  namespace,
  name,
  service,
  onSaved,
}: {
  namespace: string;
  name: string;
  service: KnativeService;
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
  const [defaults, setDefaults] = React.useState<{
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
  } | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await fetchAutoscalingGlobalDefaults();
        if (!cancelled) setDefaults(d);
      } catch {
        // ignore, keep null -> no defaults shown
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Scale bounds states (per-revision annotations)
  const [minScale, setMinScale] = React.useState<string>(
    anns['autoscaling.knative.dev/min-scale'] ?? ''
  );
  const [maxScale, setMaxScale] = React.useState<string>(
    anns['autoscaling.knative.dev/max-scale'] ?? ''
  );
  const [initialScale, setInitialScale] = React.useState<string>(
    anns['autoscaling.knative.dev/initial-scale'] ?? ''
  );
  const [activationScale, setActivationScale] = React.useState<string>(
    anns['autoscaling.knative.dev/activation-scale'] ?? ''
  );
  const [scaleDownDelay, setScaleDownDelay] = React.useState<string>(
    anns['autoscaling.knative.dev/scale-down-delay'] ?? ''
  );
  const [stableWindow, setStableWindow] = React.useState<string>(
    anns['autoscaling.knative.dev/window'] ?? ''
  );

  const { notifySuccess, notifyError } = useNotify();

  function resetFromService() {
    const a = service?.spec?.template?.metadata?.annotations ?? {};
    const s = (service?.spec?.template?.spec as Record<string, unknown>) ?? {};
    setMetric((a['autoscaling.knative.dev/metric'] as MetricType) || '');
    setTarget(a['autoscaling.knative.dev/target'] ?? '');
    setUtil(a['autoscaling.knative.dev/target-utilization-percentage'] ?? '');
    setHard(
      s?.hasOwnProperty('containerConcurrency') ? String((s as any).containerConcurrency ?? '') : ''
    );
    setMinScale(a['autoscaling.knative.dev/min-scale'] ?? '');
    setMaxScale(a['autoscaling.knative.dev/max-scale'] ?? '');
    setInitialScale(a['autoscaling.knative.dev/initial-scale'] ?? '');
    setActivationScale(a['autoscaling.knative.dev/activation-scale'] ?? '');
    setScaleDownDelay(a['autoscaling.knative.dev/scale-down-delay'] ?? '');
    setStableWindow(a['autoscaling.knative.dev/window'] ?? '');
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
      // not strictly invalid, will be cleaned up on save
    }
    // utilization: 1-100 float, or empty
    if (util !== '') {
      const u = Number(util);
      if (!Number.isFinite(u) || u <= 0 || u > 100) return false;
    }
    // min/max/initial/activation numeric if set
    const numericOrEmpty = (v: string, min?: number) =>
      v === '' || (!Number.isNaN(Number(v)) && Number(v) >= (min ?? 0));
    if (!numericOrEmpty(minScale, 0)) return false;
    if (!numericOrEmpty(maxScale, 0)) return false;
    if (!numericOrEmpty(initialScale, 0)) return false;
    if (!numericOrEmpty(activationScale, 1)) return false;
    // basic duration validation for delay/window if set
    const durationOk = (v: string) => v === '' || /^[0-9]+(ms|s|m|h)$/.test(v);
    if (!durationOk(scaleDownDelay)) return false;
    if (!durationOk(stableWindow)) return false;
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
        minScale: minScale === '' ? null : Number(minScale),
        maxScale: maxScale === '' ? null : Number(maxScale),
        initialScale: initialScale === '' ? null : Number(initialScale),
        activationScale: activationScale === '' ? null : Number(activationScale),
        scaleDownDelay: scaleDownDelay === '' ? null : scaleDownDelay,
        stableWindow: stableWindow === '' ? null : stableWindow,
      });
      notifySuccess('Autoscaling settings updated');
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
  const resolvedMinScale = defaults?.minScale;
  const resolvedMaxScale = defaults?.maxScale;
  const resolvedMaxScaleLimit = defaults?.maxScaleLimit;
  const resolvedInitialScale = defaults?.initialScale;
  const resolvedAllowZeroInitial = defaults?.allowZeroInitialScale;
  const resolvedActivationScaleDefault = defaults?.activationScaleDefault;
  const resolvedScaleDownDelay = defaults?.scaleDownDelay;
  const resolvedStableWindow = defaults?.stableWindow;

  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={2}>
          <Typography variant="subtitle1">Autoscaling settings</Typography>

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
              <Button variant="text" onClick={resetFromService} aria-label="Reset">
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

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={2}>
          <Typography variant="subtitle1">Scale bounds</Typography>
          <Stack direction="row" spacing={2}>
            <TextField
              size="small"
              type="number"
              label="Min replicas (min-scale)"
              value={minScale}
              onChange={e => setMinScale(e.target.value)}
              inputProps={{ min: 0, step: 1, inputMode: 'numeric' }}
              helperText={resolvedMinScale != null ? `Default: ${resolvedMinScale}` : undefined}
            />
            <TextField
              size="small"
              type="number"
              label="Max replicas (max-scale)"
              value={maxScale}
              onChange={e => setMaxScale(e.target.value)}
              inputProps={{ min: 0, step: 1, inputMode: 'numeric' }}
              helperText={
                resolvedMaxScale != null
                  ? resolvedMaxScaleLimit && resolvedMaxScaleLimit > 0
                    ? `Default: ${resolvedMaxScale} (cluster limit: ${resolvedMaxScaleLimit})${
                        resolvedMaxScale === 0 ? ' — 0 = unlimited (no upper bound)' : ''
                      }`
                    : `Default: ${resolvedMaxScale}${
                        resolvedMaxScale === 0 ? ' — 0 = unlimited (no upper bound)' : ''
                      }`
                  : resolvedMaxScaleLimit && resolvedMaxScaleLimit > 0
                  ? `Cluster limit: ${resolvedMaxScaleLimit}`
                  : undefined
              }
            />
          </Stack>

          <Stack direction="row" spacing={2}>
            <TextField
              size="small"
              type="number"
              label="Initial scale"
              value={initialScale}
              onChange={e => setInitialScale(e.target.value)}
              inputProps={{ min: 0, step: 1, inputMode: 'numeric' }}
              helperText={
                resolvedInitialScale != null
                  ? resolvedAllowZeroInitial
                    ? `Default: ${resolvedInitialScale} (zero allowed)`
                    : `Default: ${resolvedInitialScale}`
                  : undefined
              }
            />
            <TextField
              size="small"
              type="number"
              label="Activation scale"
              value={activationScale}
              onChange={e => setActivationScale(e.target.value)}
              inputProps={{ min: 1, step: 1, inputMode: 'numeric' }}
              helperText={`Default: ${resolvedActivationScaleDefault ?? 1}`}
            />
          </Stack>

          <Stack direction="row" spacing={2}>
            <TextField
              size="small"
              label="Scale down delay"
              placeholder="e.g., 15m"
              value={scaleDownDelay}
              onChange={e => setScaleDownDelay(e.target.value)}
              helperText={`Default: ${resolvedScaleDownDelay ?? '0s'} (0s to 1h)`}
            />
            <TextField
              size="small"
              label="Stable window"
              placeholder="e.g., 60s"
              value={stableWindow}
              onChange={e => setStableWindow(e.target.value)}
              helperText={`Default: ${resolvedStableWindow ?? '60s'} (6s to 1h)`}
            />
          </Stack>
        </Stack>
      </Paper>
    </Stack>
  );
}
