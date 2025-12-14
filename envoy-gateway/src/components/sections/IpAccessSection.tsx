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
  IconButton,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { ValidationAlert } from '../common/ValidationAlert';
import { useNotify } from '../common/notifications/useNotify';
import { SecurityPolicy } from '../../resources/envoyGateway/securityPolicy';
import { buildHttpRouteOwnerRefFromRoute, findSecurityPolicyForHTTPRoute } from './common';
import HTTPRoute, { KubeHTTPRoute } from '@kinvolk/headlamp-plugin/lib/lib/k8s/httpRoute';

type ApiResult = {
  isSuccess: boolean;
  errorMessage?: string;
};

export function IpAccessSection({
  cluster,
  httpRoute,
}: {
  cluster: string;
  httpRoute: KubeHTTPRoute;
}) {
  const [acting, setActing] = React.useState(false);
  const [validationErrors, setValidationErrors] = React.useState<string[]>([]);

  // Form dialogs
  const [openEnable, setOpenEnable] = React.useState(false);
  const [openEdit, setOpenEdit] = React.useState(false);
  const [formAllowCidrs, setFormAllowCidrs] = React.useState<string[]>([]);
  const [formDenyCidrs, setFormDenyCidrs] = React.useState<string[]>([]);

  const { notifySuccess, notifyError } = useNotify();

  // Input refs for smooth Enter navigation and focusing next row
  const allowInputRefs = React.useRef<Array<HTMLInputElement | null>>([]);
  const denyInputRefs = React.useRef<Array<HTMLInputElement | null>>([]);

  function sanitizeList(list: string[]): string[] {
    return list.map(s => s.trim()).filter(Boolean);
  }

  // Simple CIDR validation for UX (IPv4 strict, IPv6 lenient)
  function isValidCIDR(value: string): boolean {
    const ipv4 =
      /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}\/([0-9]|[12]\d|3[0-2])$/;
    const ipv6 = /^[0-9a-fA-F:]+\/(12[0-8]|1[01]\d|\d{1,2})$/; // lenient IPv6 matcher
    return ipv4.test(value) || ipv6.test(value);
  }

  function validateLists(a: string[], d: string[]): string | null {
    for (const v of [...sanitizeList(a), ...sanitizeList(d)]) {
      if (!isValidCIDR(v)) {
        return `Invalid CIDR format: ${v}`;
      }
    }
    return null;
  }

  function setAllowAt(index: number, value: string) {
    setFormAllowCidrs(prev => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }
  function addAllowRow() {
    setFormAllowCidrs(prev => [...prev, '']);
  }
  function removeAllowRow(index: number) {
    setFormAllowCidrs(prev => prev.filter((_, i) => i !== index));
  }
  function setDenyAt(index: number, value: string) {
    setFormDenyCidrs(prev => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }
  function addDenyRow() {
    setFormDenyCidrs(prev => [...prev, '']);
  }
  function removeDenyRow(index: number) {
    setFormDenyCidrs(prev => prev.filter((_, i) => i !== index));
  }

  function focusAllowAt(index: number) {
    const el = allowInputRefs.current[index];
    el?.focus();
  }
  function focusDenyAt(index: number) {
    const el = denyInputRefs.current[index];
    el?.focus();
  }
  function handleAllowKeyDown(e: React.KeyboardEvent, idx: number) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const isLast = idx === formAllowCidrs.length - 1;
    if (isLast) {
      const nextIndex = formAllowCidrs.length;
      addAllowRow();
      setTimeout(() => {
        focusAllowAt(nextIndex);
      }, 0);
    } else {
      focusAllowAt(idx + 1);
    }
  }
  function handleDenyKeyDown(e: React.KeyboardEvent, idx: number) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const isLast = idx === formDenyCidrs.length - 1;
    if (isLast) {
      const nextIndex = formDenyCidrs.length;
      addDenyRow();
      setTimeout(() => {
        focusDenyAt(nextIndex);
      }, 0);
    } else {
      focusDenyAt(idx + 1);
    }
  }

  const namespace = httpRoute.metadata.namespace!;

  const securityPolicyListResult = SecurityPolicy.useList({ cluster, namespace });

  const securityPolicies = securityPolicyListResult.items ?? [];

  const httpRouteName = httpRoute.metadata.name ?? null;

  const securityPolicy = React.useMemo(
    () => (httpRouteName ? findSecurityPolicyForHTTPRoute(securityPolicies, httpRouteName) : null),
    [securityPolicies, httpRouteName]
  );

  const policyName = securityPolicy?.metadata?.name ?? null;

  const rules: any[] = (securityPolicy as any)?.spec?.authorization?.rules ?? [];
  const allowCidrs =
    rules
      ?.filter((r: any) => String(r?.action) === 'Allow')
      ?.flatMap((r: any) => r?.principal?.clientCIDRs || [])
      ?.filter(Boolean) ?? [];
  const denyCidrs =
    rules
      ?.filter((r: any) => String(r?.action) === 'Deny')
      ?.flatMap((r: any) => r?.principal?.clientCIDRs || [])
      ?.filter(Boolean) ?? [];

  const configured = allowCidrs.length > 0 || denyCidrs.length > 0;

  const dataLoading = securityPolicyListResult.isLoading;
  const loading = acting || dataLoading;

  const error = (securityPolicyListResult.error as { message?: string } | null)?.message ?? null;

  async function handleEnable() {
    if (!httpRoute || !httpRouteName) return;
    const a = sanitizeList(formAllowCidrs);
    const d = sanitizeList(formDenyCidrs);
    const err = validateLists(a, d);
    if (err) {
      setValidationErrors([err]);
      return;
    }
    setValidationErrors([]);
    try {
      setActing(true);
      await createOrUpdateIpAccessSecurityPolicyForRoute({
        cluster,
        namespace,
        policyName: httpRouteName,
        httpRoute,
        allowCidrs: a,
        denyCidrs: d,
        existingSecurityPolicy: securityPolicy ?? null,
      });
      notifySuccess('IP access control enabled');
      setOpenEnable(false);
      setValidationErrors([]);
    } catch (e) {
      const detail = (e as Error)?.message?.trim();
      notifyError(
        detail
          ? `Failed to enable IP access control: ${detail}`
          : 'Failed to enable IP access control'
      );
    } finally {
      setActing(false);
    }
  }

  async function handleSave() {
    if (!policyName || !securityPolicy) return;
    const a = sanitizeList(formAllowCidrs);
    const d = sanitizeList(formDenyCidrs);
    const err = validateLists(a, d);
    if (err) {
      setValidationErrors([err]);
      return;
    }
    setValidationErrors([]);
    try {
      setActing(true);
      const result = await updateIpAccessSecurityPolicyForRoute({
        cluster,
        namespace,
        securityPolicy,
        allowCidrs: a,
        denyCidrs: d,
      });
      if (!result.isSuccess) {
        notifyError(
          result.errorMessage
            ? `Failed to update IP access control: ${result.errorMessage}`
            : 'Failed to update IP access control'
        );
        return;
      }
      notifySuccess('IP access control updated');
      setOpenEdit(false);
      setValidationErrors([]);
    } catch (e) {
      const detail = (e as Error)?.message?.trim();
      notifyError(
        detail
          ? `Failed to update IP access control: ${detail}`
          : 'Failed to update IP access control'
      );
    } finally {
      setActing(false);
    }
  }

  async function handleDelete() {
    if (!policyName || !securityPolicy) return;
    if (!window.confirm('Delete all IP access rules?')) return;
    try {
      setActing(true);
      const result = await disableIpAccessSecurityPolicyForRoute({
        cluster,
        namespace,
        securityPolicy,
      });
      if (!result.isSuccess) {
        notifyError(
          result.errorMessage
            ? `Failed to disable IP access control: ${result.errorMessage}`
            : 'Failed to disable IP access control'
        );
        return;
      }
      notifySuccess('IP access control disabled');
      setOpenEdit(false);
      setValidationErrors([]);
    } catch (e) {
      const detail = (e as Error)?.message?.trim();
      notifyError(
        detail
          ? `Failed to disable IP access control: ${detail}`
          : 'Failed to disable IP access control'
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
            IP Access Control (Allow/Deny CIDRs)
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
          <Stack>
            <Typography variant="subtitle2">Allow CIDRs:</Typography>
            <Typography variant="body2" color="text.secondary">
              {allowCidrs.length ? allowCidrs.join(', ') : '-'}
            </Typography>
          </Stack>
          <Stack>
            <Typography variant="subtitle2">Deny CIDRs:</Typography>
            <Typography variant="body2" color="text.secondary">
              {denyCidrs.length ? denyCidrs.join(', ') : '-'}
            </Typography>
          </Stack>
        </Stack>
        <Box>
          {!configured ? (
            <Button
              variant="contained"
              disabled={!httpRouteName || loading}
              onClick={() => {
                setFormAllowCidrs(allowCidrs.length ? allowCidrs : ['']);
                setFormDenyCidrs(denyCidrs.length ? denyCidrs : ['']);
                setValidationErrors([]);
                setOpenEnable(true);
              }}
            >
              Enable IP Access Control
            </Button>
          ) : (
            <Stack direction="row" spacing={1}>
              <Button
                variant="outlined"
                onClick={() => {
                  setFormAllowCidrs(allowCidrs.length ? allowCidrs : ['']);
                  setFormDenyCidrs(denyCidrs.length ? denyCidrs : ['']);
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
        maxWidth="md"
      >
        <DialogTitle>Enable IP Access Control</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <ValidationAlert errors={validationErrors} sx={{ mb: 1 }} />
            <Stack>
              <Typography variant="subtitle2" gutterBottom>
                Allow CIDRs
              </Typography>
              <Stack spacing={1}>
                {formAllowCidrs.map((val, idx) => (
                  <Stack key={idx} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <TextField
                      label="CIDR"
                      value={val}
                      onChange={e => setAllowAt(idx, e.target.value)}
                      onKeyDown={e => handleAllowKeyDown(e, idx)}
                      inputRef={el => {
                        allowInputRefs.current[idx] = el;
                      }}
                      size="small"
                      sx={{ flex: 1 }}
                      placeholder="e.g. 203.0.113.0/24"
                    />
                    <IconButton
                      aria-label="remove"
                      onClick={() => removeAllowRow(idx)}
                      size="small"
                    >
                      ×
                    </IconButton>
                  </Stack>
                ))}
                <Box>
                  <Button onClick={addAllowRow} size="small">
                    Add Row
                  </Button>
                </Box>
              </Stack>
            </Stack>
            <Stack>
              <Typography variant="subtitle2" gutterBottom>
                Deny CIDRs
              </Typography>
              <Stack spacing={1}>
                {formDenyCidrs.map((val, idx) => (
                  <Stack key={idx} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <TextField
                      label="CIDR"
                      value={val}
                      onChange={e => setDenyAt(idx, e.target.value)}
                      onKeyDown={e => handleDenyKeyDown(e, idx)}
                      inputRef={el => {
                        denyInputRefs.current[idx] = el;
                      }}
                      size="small"
                      sx={{ flex: 1 }}
                      placeholder="e.g. 198.51.100.0/24"
                    />
                    <IconButton aria-label="remove" onClick={() => removeDenyRow(idx)} size="small">
                      ×
                    </IconButton>
                  </Stack>
                ))}
                <Box>
                  <Button onClick={addDenyRow} size="small">
                    Add Row
                  </Button>
                </Box>
              </Stack>
            </Stack>
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
        maxWidth="md"
      >
        <DialogTitle>Edit IP Access Control</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <ValidationAlert errors={validationErrors} sx={{ mb: 1 }} />
            <Stack>
              <Typography variant="subtitle2" gutterBottom>
                Allow CIDRs
              </Typography>
              <Stack spacing={1}>
                {formAllowCidrs.map((val, idx) => (
                  <Stack key={idx} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <TextField
                      label="CIDR"
                      value={val}
                      onChange={e => setAllowAt(idx, e.target.value)}
                      onKeyDown={e => handleAllowKeyDown(e, idx)}
                      inputRef={el => {
                        allowInputRefs.current[idx] = el;
                      }}
                      size="small"
                      sx={{ flex: 1 }}
                    />
                    <IconButton
                      aria-label="remove"
                      onClick={() => removeAllowRow(idx)}
                      size="small"
                    >
                      ×
                    </IconButton>
                  </Stack>
                ))}
                <Box>
                  <Button onClick={addAllowRow} size="small">
                    Add Row
                  </Button>
                </Box>
              </Stack>
            </Stack>
            <Stack>
              <Typography variant="subtitle2" gutterBottom>
                Deny CIDRs
              </Typography>
              <Stack spacing={1}>
                {formDenyCidrs.map((val, idx) => (
                  <Stack key={idx} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <TextField
                      label="CIDR"
                      value={val}
                      onChange={e => setDenyAt(idx, e.target.value)}
                      onKeyDown={e => handleDenyKeyDown(e, idx)}
                      inputRef={el => {
                        denyInputRefs.current[idx] = el;
                      }}
                      size="small"
                      sx={{ flex: 1 }}
                    />
                    <IconButton aria-label="remove" onClick={() => removeDenyRow(idx)} size="small">
                      ×
                    </IconButton>
                  </Stack>
                ))}
                <Box>
                  <Button onClick={addDenyRow} size="small">
                    Add Row
                  </Button>
                </Box>
              </Stack>
            </Stack>
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

function buildAuthorizationRules(
  allowCidrs: string[],
  denyCidrs: string[],
  forPatch = false
): { authorization: { rules: unknown[] } } | { authorization: null } | {} {
  const rules: any[] = [];
  if (allowCidrs?.length) {
    rules.push({
      name: 'allow-source-ips',
      principal: { clientCIDRs: allowCidrs },
      action: 'Allow',
    });
  }
  if (denyCidrs?.length) {
    rules.push({
      name: 'deny-source-ips',
      principal: { clientCIDRs: denyCidrs },
      action: 'Deny',
    });
  }
  if (rules.length === 0) {
    return forPatch ? { authorization: null } : {};
  }
  return { authorization: { rules } };
}

async function createOrUpdateIpAccessSecurityPolicyForRoute(params: {
  cluster: string;
  namespace: string;
  policyName: string;
  httpRoute: KubeHTTPRoute;
  allowCidrs: string[];
  denyCidrs: string[];
  existingSecurityPolicy: SecurityPolicy | null;
}): Promise<void> {
  const {
    cluster,
    namespace,
    policyName,
    httpRoute,
    allowCidrs,
    denyCidrs,
    existingSecurityPolicy,
  } = params;

  if (!httpRoute?.metadata?.name) {
    throw new Error('HTTPRoute is missing required metadata');
  }

  if (existingSecurityPolicy?.jsonData?.metadata?.name) {
    await SecurityPolicy.apiEndpoint.put(
      {
        ...existingSecurityPolicy.jsonData,
        spec: {
          ...(existingSecurityPolicy.spec ?? {}),
          ...buildAuthorizationRules(allowCidrs || [], denyCidrs || [], true),
        },
      },
      {},
      cluster
    );
    return;
  }

  const ownerRef = buildHttpRouteOwnerRefFromRoute(httpRoute);

  await SecurityPolicy.apiEndpoint.post(
    {
      apiVersion: 'gateway.envoyproxy.io/v1alpha1',
      kind: 'SecurityPolicy',
      metadata: {
        name: policyName,
        namespace,
        ...(ownerRef ? { ownerReferences: [ownerRef] } : {}),
      },
      spec: {
        targetRefs: [
          {
            group: 'gateway.networking.k8s.io',
            kind: 'HTTPRoute',
            name: httpRoute.metadata.name,
          },
        ],
        ...buildAuthorizationRules(allowCidrs || [], denyCidrs || [], false),
      },
    },
    {},
    cluster
  );
}

async function updateIpAccessSecurityPolicyForRoute(params: {
  cluster: string;
  namespace: string;
  securityPolicy: SecurityPolicy;
  allowCidrs: string[];
  denyCidrs: string[];
}): Promise<ApiResult> {
  const { cluster, securityPolicy, allowCidrs, denyCidrs } = params;

  if (!securityPolicy.jsonData?.metadata?.name) {
    return { isSuccess: false, errorMessage: 'SecurityPolicy not found' };
  }

  try {
    await SecurityPolicy.apiEndpoint.put(
      {
        ...securityPolicy.jsonData,
        spec: {
          ...(securityPolicy.spec ?? {}),
          ...buildAuthorizationRules(allowCidrs || [], denyCidrs || [], true),
        },
      },
      {},
      cluster
    );
    return { isSuccess: true };
  } catch (e) {
    const message = (e as Error)?.message?.trim();
    return { isSuccess: false, errorMessage: message };
  }
}

async function disableIpAccessSecurityPolicyForRoute(params: {
  cluster: string;
  namespace: string;
  securityPolicy: SecurityPolicy;
}): Promise<ApiResult> {
  const { cluster, securityPolicy } = params;

  if (!securityPolicy.metadata?.name) {
    return { isSuccess: true };
  }

  try {
    await SecurityPolicy.apiEndpoint.put(
      {
        ...securityPolicy.jsonData,
        spec: {
          ...(securityPolicy.spec ?? {}),
          authorization: null,
        },
      },
      {},
      cluster
    );
    return { isSuccess: true };
  } catch (e) {
    const message = (e as Error)?.message?.trim();
    return { isSuccess: false, errorMessage: message };
  }
}
