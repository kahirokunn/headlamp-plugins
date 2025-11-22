import React from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { ValidationAlert } from '../common/ValidationAlert';
import { useNotify } from '../common/notifications/useNotify';
import {
  createRetryBackendTrafficPolicy,
  detectRetryConfig,
  updateRetryBackendTrafficPolicy,
} from '../../api/envoy';
import { deleteRetryBackendTrafficPolicy } from '../../api/envoy';

export default function RetrySection({
  namespace,
  host,
  onChanged,
}: {
  namespace: string;
  host: string;
  onChanged?: () => void;
}) {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [httpRouteName, setHttpRouteName] = React.useState<string | null>(null);
  const [policyName, setPolicyName] = React.useState<string | null>(null);
  const [validationErrors, setValidationErrors] = React.useState<string[]>([]);

  const [numRetries, setNumRetries] = React.useState<number>(5);
  const [baseInterval, setBaseInterval] = React.useState<string>('100ms');
  const [maxInterval, setMaxInterval] = React.useState<string>('10s');
  const [timeout, setTimeoutVal] = React.useState<string>('250ms');
  const [httpStatusCodes, setHttpStatusCodes] = React.useState<string>('500');
  const [triggers, setTriggers] = React.useState<string>('connect-failure,retriable-status-codes');

  const [openEnable, setOpenEnable] = React.useState(false);
  const [openEdit, setOpenEdit] = React.useState(false);

  const { notifySuccess, notifyError } = useNotify();

  function parseNumberList(input: string): number[] {
    return input
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .map(s => Number(s))
      .filter(n => Number.isFinite(n));
  }

  async function handleDelete() {
    if (!policyName) return;
    if (!window.confirm('Disable Retry configuration?')) return;
    try {
      setLoading(true);
      await deleteRetryBackendTrafficPolicy({ namespace, policyName });
      notifySuccess('Retry config disabled');
      setOpenEdit(false);
      setValidationErrors([]);
      await refresh();
      onChanged?.();
    } catch (e) {
      const detail = (e as Error)?.message?.trim();
      notifyError(
        detail ? `Failed to disable Retry config: ${detail}` : 'Failed to disable Retry config'
      );
    } finally {
      setLoading(false);
    }
  }

  function parseStringList(input: string): string[] {
    return input
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
  }

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const res = await detectRetryConfig(namespace, host);
      setHttpRouteName(res.httpRoute?.metadata?.name ?? null);
      setPolicyName(res.backendTrafficPolicy?.metadata?.name ?? null);
      if (res.numRetries != null) setNumRetries(res.numRetries);
      if (res.baseInterval) setBaseInterval(res.baseInterval);
      if (res.maxInterval) setMaxInterval(res.maxInterval);
      if (res.timeout) setTimeoutVal(res.timeout);
      if (res.httpStatusCodes?.length) setHttpStatusCodes(res.httpStatusCodes.join(','));
      if (res.triggers?.length) setTriggers(res.triggers.join(','));
    } catch (e) {
      setError((e as Error)?.message || 'Failed to detect Retry config');
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namespace, host]);

  const configured = !!(httpRouteName && policyName);

  function validate(): string | null {
    if (!Number.isFinite(numRetries) || numRetries < 0)
      return 'Please enter a number greater than or equal to 0 for numRetries';
    if (!baseInterval) return 'Please enter baseInterval (e.g., 100ms)';
    if (!maxInterval) return 'Please enter maxInterval (e.g., 10s)';
    if (!timeout) return 'Please enter timeout (e.g., 250ms)';
    return null;
  }

  async function handleEnable() {
    if (!httpRouteName) return;
    const err = validate();
    if (err) {
      setValidationErrors([err]);
      return;
    }
    setValidationErrors([]);
    try {
      setLoading(true);
      const policy = await createRetryBackendTrafficPolicy({
        namespace,
        policyName: httpRouteName,
        httpRouteName,
        numRetries,
        baseInterval,
        maxInterval,
        timeout,
        httpStatusCodes: parseNumberList(httpStatusCodes),
        triggers: parseStringList(triggers),
      });
      notifySuccess('Retry config enabled');
      setOpenEnable(false);
      setValidationErrors([]);
      setPolicyName(policy.metadata.name);
      await refresh();
      onChanged?.();
    } catch (e) {
      const detail = (e as Error)?.message?.trim();
      notifyError(
        detail ? `Failed to enable Retry config: ${detail}` : 'Failed to enable Retry config'
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!policyName) return;
    const err = validate();
    if (err) {
      setValidationErrors([err]);
      return;
    }
    setValidationErrors([]);
    try {
      setLoading(true);
      await updateRetryBackendTrafficPolicy({
        namespace,
        policyName,
        numRetries,
        baseInterval,
        maxInterval,
        timeout,
        httpStatusCodes: parseNumberList(httpStatusCodes),
        triggers: parseStringList(triggers),
      });
      notifySuccess('Retry config updated');
      setOpenEdit(false);
      setValidationErrors([]);
      await refresh();
      onChanged?.();
    } catch (e) {
      const detail = (e as Error)?.message?.trim();
      notifyError(
        detail ? `Failed to update Retry config: ${detail}` : 'Failed to update Retry config'
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={2}>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="subtitle1" gutterBottom>
            Retry (BackendTrafficPolicy)
          </Typography>
          {loading ? (
            <CircularProgress size={20} />
          ) : configured ? (
            <Chip label="Configured" color="success" size="small" />
          ) : (
            <Chip label="Not Configured" color="warning" size="small" />
          )}
        </Stack>
        {error && (
          <Typography variant="body2" color="error">
            {error}
          </Typography>
        )}
        <Stack spacing={1}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography variant="subtitle2">Host:</Typography>
            <Typography variant="body2">{host || '-'}</Typography>
          </Stack>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography variant="subtitle2">HTTPRoute:</Typography>
            <Typography variant="body2">{httpRouteName || '-'}</Typography>
          </Stack>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography variant="subtitle2">Policy:</Typography>
            <Typography variant="body2">{policyName || '-'}</Typography>
          </Stack>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography variant="subtitle2">numRetries:</Typography>
            <Typography variant="body2">{numRetries}</Typography>
          </Stack>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography variant="subtitle2">backOff:</Typography>
            <Typography variant="body2">
              base={baseInterval}, max={maxInterval}
            </Typography>
          </Stack>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography variant="subtitle2">perRetry.timeout:</Typography>
            <Typography variant="body2">{timeout}</Typography>
          </Stack>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography variant="subtitle2">retryOn.httpStatusCodes:</Typography>
            <Typography variant="body2">{httpStatusCodes || '-'}</Typography>
          </Stack>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography variant="subtitle2">retryOn.triggers:</Typography>
            <Typography variant="body2">{triggers || '-'}</Typography>
          </Stack>
        </Stack>
        <Box>
          {!configured ? (
            <Button
              variant="contained"
              disabled={!httpRouteName || loading}
              onClick={() => {
                setValidationErrors([]);
                setOpenEnable(true);
              }}
            >
              Enable Retry
            </Button>
          ) : (
            <Stack direction="row" spacing={1}>
              <Button
                variant="outlined"
                onClick={() => {
                  setValidationErrors([]);
                  setOpenEdit(true);
                }}
              >
                Edit
              </Button>
              <Button color="error" variant="outlined" onClick={handleDelete}>
                Delete
              </Button>
            </Stack>
          )}
        </Box>
      </Stack>

      {/* Enable Dialog */}
      <Dialog
        open={openEnable}
        onClose={() => {
          setOpenEnable(false);
          setValidationErrors([]);
        }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Enable Retry</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <ValidationAlert errors={validationErrors} sx={{ mb: 1 }} />
            <TextField
              label="numRetries"
              type="number"
              value={numRetries}
              onChange={e => setNumRetries(Number(e.target.value))}
              size="small"
              fullWidth
              inputProps={{ min: 0, step: 1 }}
            />
            <TextField
              label="backOff.baseInterval"
              value={baseInterval}
              onChange={e => setBaseInterval(e.target.value)}
              size="small"
              fullWidth
              helperText='e.g. "100ms"'
            />
            <TextField
              label="backOff.maxInterval"
              value={maxInterval}
              onChange={e => setMaxInterval(e.target.value)}
              size="small"
              fullWidth
              helperText='e.g. "10s"'
            />
            <TextField
              label="perRetry.timeout"
              value={timeout}
              onChange={e => setTimeoutVal(e.target.value)}
              size="small"
              fullWidth
              helperText='e.g. "250ms"'
            />
            <TextField
              label="retryOn.httpStatusCodes (comma separated)"
              value={httpStatusCodes}
              onChange={e => setHttpStatusCodes(e.target.value)}
              size="small"
              fullWidth
            />
            <TextField
              label="retryOn.triggers (comma separated)"
              value={triggers}
              onChange={e => setTriggers(e.target.value)}
              size="small"
              fullWidth
              helperText='e.g. "connect-failure,retriable-status-codes"'
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setOpenEnable(false);
              setValidationErrors([]);
            }}
          >
            Cancel
          </Button>
          <Button variant="contained" onClick={handleEnable}>
            Create
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog
        open={openEdit}
        onClose={() => {
          setOpenEdit(false);
          setValidationErrors([]);
        }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Edit Retry</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <ValidationAlert errors={validationErrors} sx={{ mb: 1 }} />
            <TextField
              label="numRetries"
              type="number"
              value={numRetries}
              onChange={e => setNumRetries(Number(e.target.value))}
              size="small"
              fullWidth
              inputProps={{ min: 0, step: 1 }}
            />
            <TextField
              label="backOff.baseInterval"
              value={baseInterval}
              onChange={e => setBaseInterval(e.target.value)}
              size="small"
              fullWidth
            />
            <TextField
              label="backOff.maxInterval"
              value={maxInterval}
              onChange={e => setMaxInterval(e.target.value)}
              size="small"
              fullWidth
            />
            <TextField
              label="perRetry.timeout"
              value={timeout}
              onChange={e => setTimeoutVal(e.target.value)}
              size="small"
              fullWidth
            />
            <TextField
              label="retryOn.httpStatusCodes (comma separated)"
              value={httpStatusCodes}
              onChange={e => setHttpStatusCodes(e.target.value)}
              size="small"
              fullWidth
            />
            <TextField
              label="retryOn.triggers (comma separated)"
              value={triggers}
              onChange={e => setTriggers(e.target.value)}
              size="small"
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setOpenEdit(false);
              setValidationErrors([]);
            }}
          >
            Cancel
          </Button>
          <Button variant="contained" onClick={handleSave}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
