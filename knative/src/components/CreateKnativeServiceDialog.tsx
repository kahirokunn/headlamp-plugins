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
} from '@mui/material';
import { createSecret, createService } from '../api/knative';
import { useNotify } from './common/notifications/useNotify';

type Props = {
  open: boolean;
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

export default function CreateKnativeServiceDialog({ open, onClose, onCreated }: Props) {
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

  const reset = React.useCallback(() => {
    setNamespace('');
    setName('');
    setImage('');
    setVisibility('external');
    setImagePullSecretName('');
    setPort('8080');
    setEnvRows([{ key: '', value: '', id: Math.random().toString(36).slice(2) }]);
    setSubmitting(false);
  }, []);

  const handleAddEnvRow = () => {
    setEnvRows(prev => [...prev, { key: '', value: '', id: Math.random().toString(36).slice(2) }]);
  };

  const handleRemoveEnvRow = (id: string) => {
    setEnvRows(prev => prev.filter(r => r.id !== id));
  };

  const handleChangeEnvRow = (id: string, field: 'key' | 'value', value: string) => {
    setEnvRows(prev => prev.map(r => (r.id === id ? { ...r, [field]: value } : r)));
  };

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
      onCreated && onCreated();
      onClose();
      reset();
    } catch (e) {
      notifyError((e as Error)?.message || 'Failed to create KService');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
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
            placeholder={'{"auths":{"your.private.registry.example.com":{"username":"janedoe","password":"xxxxxxxxxxx","email":"jdoe@example.com","auth":"c3R...zE2"}}}'}
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
