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
  BackendTrafficPolicy,
  type EnvoyBackendTrafficPolicy,
} from '../../resources/envoyGateway/backendTrafficPolicy';
import { buildHttpRouteOwnerRefFromRoute, findBackendTrafficPolicyForHTTPRoute } from './common';
import type { KubeHTTPRoute } from '@kinvolk/headlamp-plugin/lib/lib/k8s/httpRoute';

type BackendTrafficPolicyResource = EnvoyBackendTrafficPolicy;

type ApiResult = {
  isSuccess: boolean;
  errorMessage?: string;
};

export function RetrySection({
  cluster,
  httpRoute,
}: {
  cluster: string;
  httpRoute: KubeHTTPRoute;
}) {
  const [acting, setActing] = React.useState(false);
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

  const namespace = httpRoute.metadata?.namespace!;

  const backendPolicyListResult = BackendTrafficPolicy.useList({ cluster, namespace });

  const backendPolicies = (backendPolicyListResult.items ?? []) as BackendTrafficPolicyResource[];

  const httpRouteName = httpRoute.metadata?.name ?? null;

  const backendPolicy = React.useMemo(
    () =>
      httpRouteName ? findBackendTrafficPolicyForHTTPRoute(backendPolicies, httpRouteName) : null,
    [backendPolicies, httpRouteName]
  );

  const policyName = backendPolicy?.metadata?.name ?? null;
  const retrySpec = backendPolicy?.spec?.retry;

  const currentNumRetries = retrySpec?.numRetries ?? null;
  const currentBaseInterval = retrySpec?.perRetry?.backOff?.baseInterval ?? '100ms';
  const currentMaxInterval = retrySpec?.perRetry?.backOff?.maxInterval ?? '10s';
  const currentTimeout = retrySpec?.perRetry?.timeout ?? '250ms';
  const currentStatusCodes =
    retrySpec?.retryOn?.httpStatusCodes && retrySpec.retryOn.httpStatusCodes.length
      ? retrySpec.retryOn.httpStatusCodes.join(',')
      : '';
  const currentTriggers =
    retrySpec?.retryOn?.triggers && retrySpec.retryOn.triggers.length
      ? retrySpec.retryOn.triggers.join(',')
      : '';

  React.useEffect(() => {
    if (openEnable || openEdit) {
      return;
    }

    if (currentNumRetries != null) {
      setNumRetries(currentNumRetries);
    } else {
      setNumRetries(5);
    }
    setBaseInterval(currentBaseInterval || '100ms');
    setMaxInterval(currentMaxInterval || '10s');
    setTimeoutVal(currentTimeout || '250ms');
    if (currentStatusCodes) {
      setHttpStatusCodes(currentStatusCodes);
    } else {
      setHttpStatusCodes('500');
    }
    if (currentTriggers) {
      setTriggers(currentTriggers);
    } else {
      setTriggers('connect-failure,retriable-status-codes');
    }
  }, [
    currentNumRetries,
    currentBaseInterval,
    currentMaxInterval,
    currentTimeout,
    currentStatusCodes,
    currentTriggers,
    openEnable,
    openEdit,
    namespace,
  ]);

  const configured = !!(httpRouteName && policyName);
  const dataLoading = backendPolicyListResult.isLoading;
  const loading = acting || dataLoading;

  const error = (backendPolicyListResult.error as { message?: string } | null)?.message ?? null;

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
      setActing(true);
      const result = await deleteRetryBackendTrafficPolicyForRoute({
        cluster,
        namespace,
        policyName,
      });
      if (!result.isSuccess) {
        notifyError(
          result.errorMessage
            ? `Failed to disable Retry config: ${result.errorMessage}`
            : 'Failed to disable Retry config'
        );
        return;
      }
      notifySuccess('Retry config disabled');
      setOpenEdit(false);
      setValidationErrors([]);
    } catch (e) {
      const detail = (e as Error)?.message?.trim();
      notifyError(
        detail ? `Failed to disable Retry config: ${detail}` : 'Failed to disable Retry config'
      );
    } finally {
      setActing(false);
    }
  }

  function parseStringList(input: string): string[] {
    return input
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
  }

  function validate(): string | null {
    if (!Number.isFinite(numRetries) || numRetries < 0)
      return 'Please enter a number greater than or equal to 0 for numRetries';
    if (!baseInterval) return 'Please enter baseInterval (e.g., 100ms)';
    if (!maxInterval) return 'Please enter maxInterval (e.g., 10s)';
    if (!timeout) return 'Please enter timeout (e.g., 250ms)';
    return null;
  }

  async function handleEnable() {
    if (!httpRoute || !httpRouteName) return;
    const err = validate();
    if (err) {
      setValidationErrors([err]);
      return;
    }
    setValidationErrors([]);
    try {
      setActing(true);
      await createRetryBackendTrafficPolicyForRoute({
        cluster,
        namespace,
        httpRoute,
        policyName: httpRouteName,
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
    } catch (e) {
      const detail = (e as Error)?.message?.trim();
      notifyError(
        detail ? `Failed to enable Retry config: ${detail}` : 'Failed to enable Retry config'
      );
    } finally {
      setActing(false);
    }
  }

  async function handleSave() {
    if (!policyName || !backendPolicy) return;
    const err = validate();
    if (err) {
      setValidationErrors([err]);
      return;
    }
    setValidationErrors([]);
    try {
      setActing(true);
      const result = await updateRetryBackendTrafficPolicyForRoute({
        cluster,
        namespace,
        policyName,
        backendPolicy,
        numRetries,
        baseInterval,
        maxInterval,
        timeout,
        httpStatusCodes: parseNumberList(httpStatusCodes),
        triggers: parseStringList(triggers),
      });
      if (!result.isSuccess) {
        notifyError(
          result.errorMessage
            ? `Failed to update Retry config: ${result.errorMessage}`
            : 'Failed to update Retry config'
        );
        return;
      }
      notifySuccess('Retry config updated');
      setOpenEdit(false);
      setValidationErrors([]);
    } catch (e) {
      const detail = (e as Error)?.message?.trim();
      notifyError(
        detail ? `Failed to update Retry config: ${detail}` : 'Failed to update Retry config'
      );
    } finally {
      setActing(false);
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
            <Typography variant="body2">{httpRoute.spec?.hostnames?.[0] || '-'}</Typography>
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

async function createRetryBackendTrafficPolicyForRoute(params: {
  cluster: string;
  namespace: string;
  httpRoute: KubeHTTPRoute;
  policyName: string;
  numRetries: number;
  baseInterval?: string;
  maxInterval?: string;
  timeout?: string;
  httpStatusCodes?: number[];
  triggers?: string[];
}): Promise<BackendTrafficPolicyResource> {
  const ownerRef = buildHttpRouteOwnerRefFromRoute(params.httpRoute);

  const body = BackendTrafficPolicy.getBaseObject();
  body.metadata.name = params.policyName;
  body.metadata.namespace = params.namespace;
  if (ownerRef) {
    body.metadata.ownerReferences = [ownerRef];
  }
  body.spec = {
    targetRefs: [
      {
        group: 'gateway.networking.k8s.io',
        kind: 'HTTPRoute',
        name: params.httpRoute.metadata?.name ?? params.policyName,
      },
    ],
    retry: {
      numRetries: params.numRetries,
      perRetry: {
        backOff: {
          baseInterval: params.baseInterval || '100ms',
          maxInterval: params.maxInterval || '10s',
        },
        timeout: params.timeout || '250ms',
      },
      retryOn: {
        httpStatusCodes:
          params.httpStatusCodes && params.httpStatusCodes.length ? params.httpStatusCodes : [500],
        triggers:
          params.triggers && params.triggers.length
            ? params.triggers
            : ['connect-failure', 'retriable-status-codes'],
      },
    },
  };

  await BackendTrafficPolicy.apiEndpoint.post(body, {}, params.cluster);
  return body;
}

async function updateRetryBackendTrafficPolicyForRoute(params: {
  cluster: string;
  namespace: string;
  policyName: string;
  backendPolicy: BackendTrafficPolicyResource;
  numRetries: number;
  baseInterval?: string;
  maxInterval?: string;
  timeout?: string;
  httpStatusCodes?: number[];
  triggers?: string[];
}): Promise<ApiResult> {
  const {
    backendPolicy,
    numRetries,
    baseInterval,
    maxInterval,
    timeout,
    httpStatusCodes,
    triggers,
  } = params;

  if (!backendPolicy.metadata?.name) {
    return { isSuccess: false, errorMessage: 'BackendTrafficPolicy not found' };
  }

  try {
    await BackendTrafficPolicy.apiEndpoint.put(
      {
        ...backendPolicy,
        spec: {
          ...(backendPolicy.spec ?? {}),
          retry: {
            numRetries,
            perRetry: {
              backOff: {
                baseInterval: baseInterval || '100ms',
                maxInterval: maxInterval || '10s',
              },
              timeout: timeout || '250ms',
            },
            retryOn: {
              httpStatusCodes: httpStatusCodes && httpStatusCodes.length ? httpStatusCodes : [500],
              triggers:
                triggers && triggers.length
                  ? triggers
                  : ['connect-failure', 'retriable-status-codes'],
            },
          },
        },
      },
      {},
      params.cluster
    );
    return { isSuccess: true };
  } catch (e) {
    const message = (e as Error)?.message?.trim();
    return { isSuccess: false, errorMessage: message };
  }
}

async function deleteRetryBackendTrafficPolicyForRoute(params: {
  cluster: string;
  namespace: string;
  policyName: string;
}): Promise<ApiResult> {
  try {
    await BackendTrafficPolicy.apiEndpoint.delete(
      params.namespace,
      params.policyName,
      undefined,
      params.cluster
    );
    return { isSuccess: true };
  } catch (e) {
    const message = (e as Error)?.message?.trim();
    return { isSuccess: false, errorMessage: message };
  }
}
