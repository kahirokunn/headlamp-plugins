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
import { ResourceClasses } from '@kinvolk/headlamp-plugin/lib/k8s';
import { ValidationAlert } from '../common/ValidationAlert';
import { useNotify } from '../common/notifications/useNotify';
import { SecurityPolicy } from '../../resources/envoyGateway/securityPolicy';
import { buildHttpRouteOwnerRefFromRoute, findSecurityPolicyForHTTPRoute } from './common';
import type { KubeHTTPRoute } from '@kinvolk/headlamp-plugin/lib/lib/k8s/httpRoute';

const { Secret } = ResourceClasses;

type ApiResult = {
  isSuccess: boolean;
  errorMessage?: string;
};

export function BasicAuthSection({
  cluster,
  httpRoute,
}: {
  cluster: string;
  httpRoute: KubeHTTPRoute;
}) {
  const [acting, setActing] = React.useState(false);
  const [validationErrors, setValidationErrors] = React.useState<string[]>([]);

  const [openEnable, setOpenEnable] = React.useState(false);
  const [openEdit, setOpenEdit] = React.useState(false);

  // Form states
  const [formUsername, setFormUsername] = React.useState('');
  const [formPassword, setFormPassword] = React.useState('');
  const [formSecretName, setFormSecretName] = React.useState('basic-auth');

  const { notifySuccess, notifyError } = useNotify();

  const namespace = httpRoute.metadata?.namespace;

  if (!namespace) {
    return (
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="body2" color="error">
          HTTPRoute namespace is not available
        </Typography>
      </Paper>
    );
  }

  const securityPolicyListResult = SecurityPolicy.useList({ cluster, namespace });

  const securityPolicies = securityPolicyListResult.items ?? [];

  const httpRouteName = httpRoute.metadata?.name ?? null;

  const securityPolicy = React.useMemo(
    () => (httpRouteName ? findSecurityPolicyForHTTPRoute(securityPolicies, httpRouteName) : null),
    [securityPolicies, httpRouteName]
  );

  const basicAuthSecretName = securityPolicy?.spec?.basicAuth?.users?.name ?? null;

  const secretCluster = cluster;

  const secretNameForQuery =
    basicAuthSecretName ?? '__headlamp_envoygateway_basic_auth_placeholder_secret__';
  const secretQuery = Secret.useGet(secretNameForQuery, namespace, { cluster: secretCluster });
  const [secret, secretError] = secretQuery;

  const secretIs404 =
    !!basicAuthSecretName && !!secretError && (secretError as { status?: number }).status === 404;

  const enableSecretNameForQuery =
    openEnable && formSecretName
      ? formSecretName
      : '__headlamp_envoygateway_basic_auth_enable_placeholder_secret__';
  const enableSecretQuery = Secret.useGet(enableSecretNameForQuery, namespace, {
    cluster: secretCluster,
  });
  const [enableSecret, enableSecretError] = enableSecretQuery;

  const enableSecretIs404 =
    openEnable &&
    !!formSecretName &&
    !!enableSecretError &&
    (enableSecretError as { status?: number }).status === 404;

  const usernames = React.useMemo(
    () =>
      basicAuthSecretName && !secretIs404 && secret ? readHtpasswdUsernamesFromSecret(secret) : [],
    [basicAuthSecretName, secretIs404, secret]
  );

  React.useEffect(() => {
    if (openEnable || openEdit) {
      return;
    }

    if (basicAuthSecretName) {
      setFormSecretName(basicAuthSecretName);
    } else {
      setFormSecretName('basic-auth');
    }

    if (usernames.length > 0) {
      setFormUsername(usernames[0]);
    } else {
      setFormUsername('');
    }

    setFormPassword('');
  }, [basicAuthSecretName, usernames, openEnable, openEdit, namespace]);

  const configured = !!(httpRouteName && basicAuthSecretName);
  const dataLoading =
    securityPolicyListResult.isLoading || (basicAuthSecretName ? secretQuery.isLoading : false);
  const loading = acting || dataLoading;

  const error =
    (securityPolicyListResult.error as { message?: string } | null)?.message ??
    (basicAuthSecretName && !secretIs404
      ? (secretError as { message?: string } | null)?.message ?? null
      : null);

  async function handleEnableSave() {
    if (!httpRoute || !httpRouteName || !namespace) return;
    if (!formUsername || !formPassword || !formSecretName) {
      setValidationErrors(['Please enter a username, password, and secret name']);
      return;
    }
    setValidationErrors([]);
    try {
      setActing(true);
      const upsertResult = await upsertBasicAuthSecretForRoute({
        cluster,
        namespace,
        secretName: formSecretName,
        username: formUsername,
        password: formPassword,
        httpRoute,
        existingSecret: enableSecretIs404 ? null : enableSecret ?? null,
      });
      if (!upsertResult.isSuccess) {
        notifyError(
          upsertResult.errorMessage
            ? `Failed to enable Basic authentication: ${upsertResult.errorMessage}`
            : 'Failed to enable Basic authentication'
        );
        return;
      }
      await createOrUpdateSecurityPolicyForHTTPRoute({
        cluster,
        namespace,
        policyName: httpRouteName,
        httpRoute,
        secretName: formSecretName,
        existingSecurityPolicy: securityPolicy ?? null,
      });
      notifySuccess('Basic authentication enabled');
      setOpenEnable(false);
      setValidationErrors([]);
      setFormPassword('');
    } catch (e) {
      const detail = (e as Error)?.message?.trim();
      notifyError(
        detail
          ? `Failed to enable Basic authentication: ${detail}`
          : 'Failed to enable Basic authentication'
      );
    } finally {
      setActing(false);
    }
  }

  async function handleDelete() {
    if (!httpRouteName || !namespace) return;
    if (!window.confirm('Disable Basic authentication?')) return;
    try {
      setActing(true);
      const result = await disableBasicAuthForHTTPRoute({
        cluster,
        namespace,
        httpRouteName,
        existingSecurityPolicy: securityPolicy ?? null,
      });
      if (!result.isSuccess) {
        notifyError(
          result.errorMessage
            ? `Failed to disable Basic authentication: ${result.errorMessage}`
            : 'Failed to disable Basic authentication'
        );
        return;
      }
      notifySuccess('Basic authentication disabled');
      setOpenEdit(false);
      setValidationErrors([]);
      setFormPassword('');
    } catch (e) {
      const detail = (e as Error)?.message?.trim();
      notifyError(
        detail
          ? `Failed to disable Basic authentication: ${detail}`
          : 'Failed to disable Basic authentication'
      );
    } finally {
      setActing(false);
    }
  }

  async function handleEditSave() {
    if (!basicAuthSecretName) return;
    if (!httpRoute || !namespace) return;
    if (!formUsername || !formPassword) {
      setValidationErrors(['Please enter a username and new password']);
      return;
    }
    setValidationErrors([]);
    try {
      setActing(true);
      const result = await upsertBasicAuthSecretForRoute({
        cluster,
        namespace,
        secretName: basicAuthSecretName,
        username: formUsername,
        password: formPassword,
        httpRoute,
        existingSecret: secretIs404 ? null : secret ?? null,
      });
      if (!result.isSuccess) {
        notifyError(
          result.errorMessage
            ? `Failed to update Basic authentication: ${result.errorMessage}`
            : 'Failed to update Basic authentication'
        );
        return;
      }
      notifySuccess('Basic authentication credentials updated');
      setOpenEdit(false);
      setValidationErrors([]);
      setFormPassword('');
    } catch (e) {
      const detail = (e as Error)?.message?.trim();
      notifyError(
        detail
          ? `Failed to update Basic authentication: ${detail}`
          : 'Failed to update Basic authentication'
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
            Basic Authentication
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
            <Typography variant="subtitle2">Secret:</Typography>
            <Typography variant="body2">{basicAuthSecretName || '-'}</Typography>
          </Stack>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography variant="subtitle2">Usernames:</Typography>
            <Typography variant="body2">{usernames.length ? usernames.join(', ') : '-'}</Typography>
          </Stack>
          {configured && (
            <Typography variant="body2" color="text.secondary">
              Password is stored as a hash and cannot be displayed for security reasons. Changes can
              be made from "Edit".
            </Typography>
          )}
        </Stack>
        <Box>
          {!configured ? (
            <Button
              variant="contained"
              disabled={!httpRouteName || loading}
              onClick={() => {
                setFormUsername(usernames[0] || '');
                setFormPassword('');
                setFormSecretName(basicAuthSecretName || 'basic-auth');
                setValidationErrors([]);
                setOpenEnable(true);
              }}
            >
              Enable Basic Authentication
            </Button>
          ) : (
            <Stack direction="row" spacing={1}>
              <Button
                variant="outlined"
                onClick={() => {
                  setFormUsername(usernames[0] || '');
                  setFormPassword('');
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
        <DialogTitle>Enable Basic Authentication</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <ValidationAlert errors={validationErrors} sx={{ mb: 1 }} />
            <TextField
              label="Secret Name"
              value={formSecretName}
              onChange={e => setFormSecretName(e.target.value)}
              size="small"
              fullWidth
              helperText="Secret name to store the authentication information (.htpasswd)"
            />
            <TextField
              label="Username"
              value={formUsername}
              onChange={e => setFormUsername(e.target.value)}
              size="small"
              fullWidth
            />
            <TextField
              label="Password"
              value={formPassword}
              onChange={e => setFormPassword(e.target.value)}
              size="small"
              fullWidth
              type="password"
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
          <Button variant="contained" onClick={handleEnableSave}>
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
        <DialogTitle>Edit Basic Authentication</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <ValidationAlert errors={validationErrors} sx={{ mb: 1 }} />
            <TextField
              label="Secret Name"
              value={basicAuthSecretName || ''}
              size="small"
              fullWidth
              disabled
            />
            <TextField
              label="Username"
              value={formUsername}
              onChange={e => setFormUsername(e.target.value)}
              size="small"
              fullWidth
            />
            <TextField
              label="New Password"
              value={formPassword}
              onChange={e => setFormPassword(e.target.value)}
              size="small"
              fullWidth
              type="password"
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
          <Button variant="contained" onClick={handleEditSave}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}

function decodeBase64ToString(data: string): string {
  if (typeof atob === 'function') {
    return atob(data);
  }
  return Buffer.from(data, 'base64').toString('utf8');
}

function readHtpasswdUsernamesFromSecret(secret: InstanceType<typeof Secret>): string[] {
  const encoded = secret?.data?.['.htpasswd'];
  if (!encoded) {
    return [];
  }

  try {
    const decoded = decodeBase64ToString(encoded);
    const lines = decoded.split(/\r?\n/).filter(Boolean);
    const users: string[] = [];
    for (const line of lines) {
      const idx = line.indexOf(':');
      if (idx > 0) {
        users.push(line.slice(0, idx));
      }
    }
    return users;
  } catch {
    return [];
  }
}

function base64Encode(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) {
    bin += String.fromCharCode(bytes[i]);
  }
  if (typeof btoa === 'function') {
    return btoa(bin);
  }
  return Buffer.from(bytes).toString('base64');
}

function encodeStringToBase64(data: string): string {
  if (typeof btoa === 'function') {
    return btoa(data);
  }
  return Buffer.from(data, 'utf8').toString('base64');
}

async function sha1Base64(input: string): Promise<string> {
  const enc = new TextEncoder();
  const data = enc.encode(input);

  if (typeof crypto !== 'undefined' && crypto.subtle && crypto.subtle.digest) {
    const digest = await crypto.subtle.digest('SHA-1', data);
    return base64Encode(new Uint8Array(digest));
  }

  // Node / non-browser fallback
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const nodeCrypto = require('crypto') as typeof import('crypto');
  const hash = nodeCrypto.createHash('sha1').update(Buffer.from(data)).digest();
  return hash.toString('base64');
}

async function buildHtpasswdLine(username: string, password: string): Promise<string> {
  const b64 = await sha1Base64(password);
  return `${username}:{SHA}${b64}`;
}

async function upsertBasicAuthSecretForRoute(params: {
  cluster: string;
  namespace: string;
  secretName: string;
  username: string;
  password: string;
  httpRoute: KubeHTTPRoute;
  existingSecret?: InstanceType<typeof Secret> | null;
}): Promise<ApiResult> {
  const { cluster, namespace, secretName, username, password, httpRoute, existingSecret } = params;

  try {
    const dataB64 = encodeStringToBase64(await buildHtpasswdLine(username, password));

    const existingJson = existingSecret?.jsonData;

    if (!existingJson) {
      const ownerRef = buildHttpRouteOwnerRefFromRoute(httpRoute);
      const body = Secret.getBaseObject();
      body.metadata.name = secretName;
      body.metadata.namespace = namespace;
      if (ownerRef) {
        body.metadata.ownerReferences = [ownerRef];
      }
      body.type = 'Opaque';
      body.data = { '.htpasswd': dataB64 };
      await Secret.apiEndpoint.post(body, {}, cluster);
    } else {
      await Secret.apiEndpoint.put(
        {
          ...existingJson,
          data: {
            ...(existingJson.data ?? {}),
            '.htpasswd': dataB64,
          },
          type: 'Opaque',
        },
        {},
        cluster
      );
    }

    return { isSuccess: true };
  } catch (e) {
    const message = (e as Error)?.message?.trim();
    return { isSuccess: false, errorMessage: message };
  }
}

async function createOrUpdateSecurityPolicyForHTTPRoute(params: {
  cluster: string;
  namespace: string;
  policyName: string;
  httpRoute: KubeHTTPRoute;
  secretName: string;
  existingSecurityPolicy: SecurityPolicy | null;
}): Promise<void> {
  const { cluster, namespace, policyName, httpRoute, secretName, existingSecurityPolicy } = params;

  if (existingSecurityPolicy?.jsonData?.metadata?.name) {
    await SecurityPolicy.apiEndpoint.put(
      {
        ...existingSecurityPolicy.jsonData,
        spec: {
          ...(existingSecurityPolicy.spec ?? {}),
          basicAuth: {
            users: {
              name: secretName,
            },
          },
        },
      },
      {},
      cluster
    );
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
            name: httpRoute.metadata.name!,
          },
        ],
        basicAuth: {
          users: {
            name: secretName,
          },
        },
      },
    },
    {},
    cluster
  );
}

async function disableBasicAuthForHTTPRoute(params: {
  cluster: string;
  namespace: string;
  httpRouteName: string;
  existingSecurityPolicy: SecurityPolicy | null;
}): Promise<ApiResult> {
  try {
    const existing = params.existingSecurityPolicy?.jsonData;
    if (!existing?.metadata?.name) {
      return { isSuccess: true };
    }
    console.log('確認 existing', existing);

    await SecurityPolicy.apiEndpoint.put(
      {
        ...existing,
        spec: {
          ...(existing.spec ?? {}),
          basicAuth: null,
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
