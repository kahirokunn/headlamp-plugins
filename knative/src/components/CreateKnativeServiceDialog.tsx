import React from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
  InputAdornment,
  Switch,
  FormControlLabel,
} from '@mui/material';
import { createSecret, createService } from '../api/knative';
import {
  createIpAccessSecurityPolicy,
  createSecurityPolicyForHTTPRoute,
  upsertBasicAuthSecret,
  waitForServiceHttpRoute,
} from '../api/envoy';
import { useNotify } from './common/notifications/useNotify';

type Props = {
  onClose: () => void;
  onCreated?: () => void;
};

type EnvRow = { key: string; value: string; id: string };

const parseNumericInput = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : null;
};

const isRequestGreaterThanLimit = (request: string, limit: string): boolean => {
  const req = parseNumericInput(request);
  const lim = parseNumericInput(limit);

  if (req == null) return false;
  if (lim == null) return true;

  return req > lim;
};

const sanitizeList = (list: string[]): string[] => list.map(s => s.trim()).filter(Boolean);

const isValidCIDR = (value: string): boolean => {
  const ipv4 =
    /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}\/([0-9]|[12]\d|3[0-2])$/;
  const ipv6 = /^[0-9a-fA-F:]+\/(12[0-8]|1[01]\d|\d{1,2})$/;
  return ipv4.test(value) || ipv6.test(value);
};

const validateCidrs = (allow: string[], deny: string[]): string | null => {
  for (const v of [...sanitizeList(allow), ...sanitizeList(deny)]) {
    if (!isValidCIDR(v)) {
      return `Invalid CIDR format: ${v}`;
    }
  }
  return null;
};

export default function CreateKnativeServiceDialog({ onClose, onCreated }: Props) {
  const [namespace, setNamespace] = React.useState<string>('');
  const [name, setName] = React.useState<string>('');
  const [image, setImage] = React.useState<string>('');
  const [visibility, setVisibility] = React.useState<'external' | 'internal'>('external');
  const [imagePullSecretName, setImagePullSecretName] = React.useState<string>('');
  const [port, setPort] = React.useState<string>('8080');
  const [protocol, setProtocol] = React.useState<'http1' | 'h2c'>('http1');
  const [minScale, setMinScale] = React.useState<string>('0');
  const [cpuRequest, setCpuRequest] = React.useState<string>('2');
  const [cpuLimit, setCpuLimit] = React.useState<string>('2');
  const [memoryRequest, setMemoryRequest] = React.useState<string>('4');
  const [memoryLimit, setMemoryLimit] = React.useState<string>('4');
  const [envRows, setEnvRows] = React.useState<EnvRow[]>([
    { key: '', value: '', id: Math.random().toString(36).slice(2) },
  ]);
  const [enableBasicAuth, setEnableBasicAuth] = React.useState(false);
  const [basicAuthUsername, setBasicAuthUsername] = React.useState('');
  const [basicAuthPassword, setBasicAuthPassword] = React.useState('');
  const [enableIpAccessControl, setEnableIpAccessControl] = React.useState(false);
  const [ipAllowCidrs, setIpAllowCidrs] = React.useState<string[]>(['']);
  const [ipDenyCidrs, setIpDenyCidrs] = React.useState<string[]>(['']);
  const [submitting, setSubmitting] = React.useState(false);
  const { notifyError, notifyInfo } = useNotify();

  React.useEffect(() => {
    if (isRequestGreaterThanLimit(cpuRequest, cpuLimit)) {
      setCpuLimit(cpuRequest);
    }
  }, [cpuRequest, cpuLimit]);

  React.useEffect(() => {
    if (isRequestGreaterThanLimit(memoryRequest, memoryLimit)) {
      setMemoryLimit(memoryRequest);
    }
  }, [memoryRequest, memoryLimit]);

  const handleAddEnvRow = () => {
    setEnvRows(prev => [...prev, { key: '', value: '', id: Math.random().toString(36).slice(2) }]);
  };

  const handleRemoveEnvRow = (id: string) => {
    setEnvRows(prev => prev.filter(r => r.id !== id));
  };

  const handleChangeEnvRow = (id: string, field: 'key' | 'value', value: string) => {
    setEnvRows(prev => prev.map(r => (r.id === id ? { ...r, [field]: value } : r)));
  };

  const handleChangeAllowCidr = (index: number, value: string) => {
    setIpAllowCidrs(prev => prev.map((v, i) => (i === index ? value : v)));
  };

  const handleAddAllowCidrRow = () => {
    setIpAllowCidrs(prev => [...prev, '']);
  };

  const handleRemoveAllowCidr = (index: number) => {
    setIpAllowCidrs(prev => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  };

  const handleChangeDenyCidr = (index: number, value: string) => {
    setIpDenyCidrs(prev => prev.map((v, i) => (i === index ? value : v)));
  };

  const handleAddDenyCidrRow = () => {
    setIpDenyCidrs(prev => [...prev, '']);
  };

  const handleRemoveDenyCidr = (index: number) => {
    setIpDenyCidrs(prev => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  };

  async function configureSecurityForService(serviceNamespace: string, serviceName: string) {
    if (!enableBasicAuth && !enableIpAccessControl) return;

    const route = await waitForServiceHttpRoute(serviceNamespace, serviceName);
    if (!route) {
      throw new Error('Timed out while waiting for HTTPRoute of the new service');
    }
    const httpRouteName = route.metadata.name;
    const basicAuthSecretName = `${serviceName}-basic-auth`;

    if (enableBasicAuth) {
      await upsertBasicAuthSecret(
        serviceNamespace,
        basicAuthSecretName.trim(),
        basicAuthUsername.trim(),
        basicAuthPassword,
        httpRouteName
      );
      await createSecurityPolicyForHTTPRoute({
        namespace: serviceNamespace,
        policyName: httpRouteName,
        httpRouteName,
        secretName: basicAuthSecretName.trim(),
      });
    }

    if (enableIpAccessControl) {
      const allow = sanitizeList(ipAllowCidrs);
      const deny = sanitizeList(ipDenyCidrs);
      await createIpAccessSecurityPolicy({
        namespace: serviceNamespace,
        policyName: httpRouteName,
        httpRouteName,
        allowCidrs: allow,
        denyCidrs: deny,
      });
    }
  }

  const handleSubmit = async () => {
    if (!namespace || !name || !image || !port) {
      notifyError('namespace, name, image, port are required');
      return;
    }
    const portNum = Number(port);
    if (!Number.isFinite(portNum) || portNum <= 0 || portNum > 65535) {
      notifyError('port must be a valid number (1-65535)');
      return;
    }
    const minScaleNum = Number(minScale);
    if (!Number.isFinite(minScaleNum) || minScaleNum < 0) {
      notifyError('minScale must be a non-negative number');
      return;
    }
    if (visibility === 'external' && enableBasicAuth) {
      if (!basicAuthUsername.trim() || !basicAuthPassword) {
        notifyError('Basic Auth: username and password are required');
        return;
      }
    }
    if (visibility === 'external' && enableIpAccessControl) {
      const err = validateCidrs(ipAllowCidrs, ipDenyCidrs);
      if (err) {
        notifyError(err);
        return;
      }
    }
    const memReqTrimmed = memoryRequest.trim();
    const memLimTrimmed = memoryLimit.trim();
    const memoryRequestQuantity = memReqTrimmed ? `${memReqTrimmed}Gi` : null;
    const memoryLimitQuantity = memLimTrimmed ? `${memLimTrimmed}Gi` : null;
    setSubmitting(true);
    try {
      const envData: Record<string, string> = {};
      for (const r of envRows) {
        if (r.key) envData[r.key] = r.value ?? '';
      }
      let createdEnvSecretName: string | undefined;
      if (Object.keys(envData).length > 0) {
        const secretName = `${name}-env`;
        await createSecret({ namespace, name: secretName, data: envData });
        createdEnvSecretName = secretName;
      }
      await createService({
        namespace,
        name,
        image,
        visibility,
        envSecretName: createdEnvSecretName,
        imagePullSecretName: imagePullSecretName || null,
        port: portNum,
        protocol,
        minScale: minScaleNum,
        cpuRequest,
        cpuLimit,
        memoryRequest: memoryRequestQuantity,
        memoryLimit: memoryLimitQuantity,
      });
      notifyInfo('KService created');

      if (visibility === 'external' && (enableBasicAuth || enableIpAccessControl)) {
        try {
          await configureSecurityForService(namespace, name);
          notifyInfo('Security settings applied via Envoy Gateway');
        } catch (e) {
          const detail = (e as Error)?.message?.trim();
          notifyError(
            detail
              ? `KService created but failed to configure security: ${detail}`
              : 'KService created but failed to configure security'
          );
        }
      }

      onCreated && onCreated();
      onClose();
    } catch (e) {
      notifyError((e as Error)?.message || 'Failed to create KService');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Create KService</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Stack direction="row" spacing={1}>
            <TextField
              label="Name"
              size="small"
              value={name}
              onChange={e => setName(e.target.value)}
              required
              sx={{ flex: 1 }}
            />
            <TextField
              label="Namespace"
              size="small"
              value={namespace}
              onChange={e => setNamespace(e.target.value)}
              required
              sx={{ flex: 1 }}
            />
          </Stack>
          <Stack direction="row" spacing={1}>
            <TextField
              label="Port"
              type="number"
              size="small"
              value={port}
              onChange={e => setPort(e.target.value)}
              sx={{ flex: 1 }}
              required
            />
            <FormControl size="small" sx={{ flex: 1 }}>
              <InputLabel id="protocol">Protocol</InputLabel>
              <Select
                labelId="protocol"
                label="Protocol"
                value={protocol}
                onChange={e => setProtocol(e.target.value as 'http1' | 'h2c')}
              >
                <MenuItem value="http1">HTTP/1.1</MenuItem>
                <MenuItem value="h2c">h2c (HTTP/2 cleartext, for gRPC)</MenuItem>
              </Select>
            </FormControl>
          </Stack>
          <TextField
            label="Min Scale"
            type="number"
            size="small"
            value={minScale}
            onChange={e => setMinScale(e.target.value)}
            required
            fullWidth
            helperText={
              minScale.trim() === '0' ? (
                <Typography variant="caption" color="success.main">
                  🎉 When traffic is 0, the cost is 0!
                </Typography>
              ) : undefined
            }
          />
          <Box>
            <Typography variant="subtitle1" gutterBottom>
              Resources
            </Typography>
            <Stack direction="row" spacing={1}>
              <TextField
                label="CPU Request"
                type="number"
                size="small"
                value={cpuRequest}
                onChange={e => setCpuRequest(e.target.value)}
                sx={{ flex: 1 }}
                inputProps={{ min: 0, step: 0.1 }}
                InputProps={{
                  endAdornment: <InputAdornment position="end">core</InputAdornment>,
                }}
              />
              <TextField
                label="CPU Limit"
                type="number"
                size="small"
                value={cpuLimit}
                onChange={e => setCpuLimit(e.target.value)}
                sx={{ flex: 1 }}
                inputProps={{ min: 0, step: 0.1 }}
                InputProps={{
                  endAdornment: <InputAdornment position="end">core</InputAdornment>,
                }}
              />
            </Stack>
            <Stack direction="row" spacing={1} mt={1}>
              <TextField
                label="Memory Request"
                type="number"
                size="small"
                value={memoryRequest}
                onChange={e => setMemoryRequest(e.target.value)}
                sx={{ flex: 1 }}
                inputProps={{ min: 0, step: 1 }}
                InputProps={{
                  endAdornment: <InputAdornment position="end">GiB</InputAdornment>,
                }}
              />
              <TextField
                label="Memory Limit"
                type="number"
                size="small"
                value={memoryLimit}
                onChange={e => setMemoryLimit(e.target.value)}
                sx={{ flex: 1 }}
                inputProps={{ min: 0, step: 1 }}
                InputProps={{
                  endAdornment: <InputAdornment position="end">GiB</InputAdornment>,
                }}
              />
            </Stack>
          </Box>

          <FormControl size="small" fullWidth>
            <InputLabel id="visibility">Visibility</InputLabel>
            <Select
              labelId="visibility"
              label="Visibility"
              value={visibility}
              onChange={e => setVisibility(e.target.value as 'external' | 'internal')}
            >
              <MenuItem value="external">External (Internet accessible)</MenuItem>
              <MenuItem value="internal">Internal (cluster-local)</MenuItem>
            </Select>
          </FormControl>
          {visibility === 'external' && (
            <Box>
              <Typography variant="subtitle1" gutterBottom>
                Security (Envoy Gateway)
              </Typography>
              <Stack spacing={2}>
                <Box>
                  <Stack direction="row" alignItems="center" justifyContent="space-between">
                    <Typography variant="subtitle2">Basic Authentication</Typography>
                    <FormControlLabel
                      control={
                        <Switch
                          size="small"
                          checked={enableBasicAuth}
                          onChange={e => setEnableBasicAuth(e.target.checked)}
                        />
                      }
                      label={enableBasicAuth ? 'Enabled' : 'Disabled'}
                    />
                  </Stack>
                  {enableBasicAuth && (
                    <Stack direction="row" spacing={1} mt={1}>
                      <TextField
                        label="Username"
                        size="small"
                        value={basicAuthUsername}
                        onChange={e => setBasicAuthUsername(e.target.value)}
                        sx={{ flex: 1 }}
                      />
                      <TextField
                        label="Password"
                        type="password"
                        size="small"
                        value={basicAuthPassword}
                        onChange={e => setBasicAuthPassword(e.target.value)}
                        sx={{ flex: 1 }}
                      />
                    </Stack>
                  )}
                </Box>

                <Box>
                  <Stack direction="row" alignItems="center" justifyContent="space-between">
                    <Typography variant="subtitle2">IP Access Control</Typography>
                    <FormControlLabel
                      control={
                        <Switch
                          size="small"
                          checked={enableIpAccessControl}
                          onChange={e => setEnableIpAccessControl(e.target.checked)}
                        />
                      }
                      label={enableIpAccessControl ? 'Enabled' : 'Disabled'}
                    />
                  </Stack>
                  {enableIpAccessControl && (
                    <Stack spacing={1} mt={1}>
                      <Typography variant="body2" color="text.secondary">
                        Enter in CIDR format (e.g., 203.0.113.0/24).
                      </Typography>
                      <Stack spacing={1}>
                        <Typography variant="subtitle2">Allow CIDRs</Typography>
                        {ipAllowCidrs.map((v, idx) => (
                          <Stack key={idx} direction="row" spacing={1} alignItems="center">
                            <TextField
                              label="CIDR"
                              size="small"
                              value={v}
                              onChange={e => handleChangeAllowCidr(idx, e.target.value)}
                              sx={{ flex: 1 }}
                            />
                            <Button
                              size="small"
                              onClick={() => handleRemoveAllowCidr(idx)}
                              disabled={ipAllowCidrs.length === 1}
                            >
                              Delete
                            </Button>
                          </Stack>
                        ))}
                        <Button size="small" onClick={handleAddAllowCidrRow}>
                          Add Row
                        </Button>
                      </Stack>
                      <Stack spacing={1}>
                        <Typography variant="subtitle2">Deny CIDRs</Typography>
                        {ipDenyCidrs.map((v, idx) => (
                          <Stack key={idx} direction="row" spacing={1} alignItems="center">
                            <TextField
                              label="CIDR"
                              size="small"
                              value={v}
                              onChange={e => handleChangeDenyCidr(idx, e.target.value)}
                              sx={{ flex: 1 }}
                            />
                            <Button
                              size="small"
                              onClick={() => handleRemoveDenyCidr(idx)}
                              disabled={ipDenyCidrs.length === 1}
                            >
                              Delete
                            </Button>
                          </Stack>
                        ))}
                        <Button size="small" onClick={handleAddDenyCidrRow}>
                          Add Row
                        </Button>
                      </Stack>
                    </Stack>
                  )}
                </Box>
              </Stack>
            </Box>
          )}
          <TextField
            label="Container Image"
            placeholder="ghcr.io/knative/helloworld-go:latest"
            size="small"
            value={image}
            onChange={e => setImage(e.target.value)}
            required
            fullWidth
          />
          <TextField
            label="Image Pull Secret (optional)"
            size="small"
            value={imagePullSecretName}
            onChange={e => setImagePullSecretName(e.target.value)}
            placeholder={
              '{"auths":{"your.private.registry.example.com":{"username":"janedoe","password":"xxxxxxxxxxx","email":"knative@example.com","auth":"c3R...zE2"}}}'
            }
            fullWidth
          />
          <Box>
            <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1}>
              <Typography variant="subtitle1">Environment Variables</Typography>
              <Button size="small" onClick={handleAddEnvRow}>
                Add
              </Button>
            </Stack>
            <Stack spacing={1}>
              {envRows.map(row => (
                <Stack key={row.id} direction="row" spacing={1} alignItems="center">
                  <TextField
                    label="Key"
                    size="small"
                    value={row.key}
                    onChange={e => handleChangeEnvRow(row.id, 'key', e.target.value)}
                    sx={{ flex: 1 }}
                  />
                  <TextField
                    label="Value"
                    size="small"
                    value={row.value}
                    onChange={e => handleChangeEnvRow(row.id, 'value', e.target.value)}
                    sx={{ flex: 2 }}
                  />
                  <Button size="small" onClick={() => handleRemoveEnvRow(row.id)}>
                    Delete
                  </Button>
                </Stack>
              ))}
            </Stack>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button variant="contained" onClick={handleSubmit} disabled={submitting}>
          Create
        </Button>
      </DialogActions>
    </Dialog>
  );
}
