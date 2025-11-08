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
import {
  createApiKeySecurityPolicy,
  detectApiKeyAuthConfig,
  getSecret,
  upsertOpaqueKeyValueSecret,
  updateApiKeySecurityPolicyExtractFrom,
} from '../../api/envoy';

type ClientEntry = { clientId: string; apiKey: string };

export default function ApiKeyAuthSection({
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
  const [secretName, setSecretName] = React.useState<string | null>(null);
  const [headerName, setHeaderName] = React.useState<string>('x-api-key');
  const [existingClientIds, setExistingClientIds] = React.useState<string[]>([]);
  const [validationErrors, setValidationErrors] = React.useState<string[]>([]);

  const [openEnable, setOpenEnable] = React.useState(false);
  const [openEdit, setOpenEdit] = React.useState(false);

  // Form
  const [formSecretName, setFormSecretName] = React.useState('apikey-secret');
  const [formHeaderName, setFormHeaderName] = React.useState('x-api-key');
  const [clients, setClients] = React.useState<ClientEntry[]>([{ clientId: '', apiKey: '' }]);

  const { notifySuccess, notifyError } = useNotify();

  async function loadSecretClientIds(ns: string, name: string): Promise<string[]> {
    try {
      const sec = await getSecret(ns, name);
      const keys = Object.keys(sec?.data ?? {});
      return keys;
    } catch {
      return [];
    }
  }

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const result = await detectApiKeyAuthConfig(namespace, host);
      setHttpRouteName(result.httpRoute?.metadata?.name ?? null);
      setPolicyName(result.securityPolicy?.metadata?.name ?? null);
      const sn = result.secretNames?.[0] ?? null;
      setSecretName(sn);
      setHeaderName(result.headerName || 'x-api-key');
      if (sn) {
        const ids = await loadSecretClientIds(namespace, sn);
        setExistingClientIds(ids);
      } else {
        setExistingClientIds([]);
      }
      if (sn) setFormSecretName(sn);
      if (result.headerName) setFormHeaderName(result.headerName);
    } catch (e) {
      setError((e as Error)?.message || 'Failed to detect API Key config');
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namespace, host]);

  const configured = !!(httpRouteName && secretName);

  function setClientId(index: number, value: string) {
    setClients(prev => {
      const next = [...prev];
      next[index] = { ...next[index], clientId: value };
      return next;
    });
  }
  function setApiKey(index: number, value: string) {
    setClients(prev => {
      const next = [...prev];
      next[index] = { ...next[index], apiKey: value };
      return next;
    });
  }
  function addRow() {
    setClients(prev => [...prev, { clientId: '', apiKey: '' }]);
  }
  function removeRow(index: number) {
    setClients(prev => prev.filter((_, i) => i !== index));
  }

  function validateClients(list: ClientEntry[]): string | null {
    if (!list.length) return '少なくとも1つのクライアントを追加してください';
    for (const c of list) {
      if (!c.clientId) return 'Client ID は必須です';
      if (!c.apiKey) return 'API Key は必須です';
    }
    return null;
  }

  async function handleEnableSave() {
    if (!httpRouteName) return;
    const errMsg = !formSecretName
      ? 'Secret名を入力してください'
      : !formHeaderName
      ? 'ヘッダー名を入力してください'
      : validateClients(clients);
    if (errMsg) {
      setValidationErrors([errMsg]);
      return;
    }
    setValidationErrors([]);
    try {
      setLoading(true);
      const kv: Record<string, string> = {};
      for (const c of clients) kv[c.clientId] = c.apiKey;
      await upsertOpaqueKeyValueSecret(namespace, formSecretName, kv);
      const spName = `${httpRouteName}-apikey-auth`;
      await createApiKeySecurityPolicy({
        namespace,
        policyName: spName,
        httpRouteName,
        secretName: formSecretName,
        headerName: formHeaderName,
      });
      notifySuccess('API Key認証を有効化しました');
      setOpenEnable(false);
      setValidationErrors([]);
      await refresh();
      onChanged?.();
      setClients([{ clientId: '', apiKey: '' }]);
    } catch (e) {
      const detail = (e as Error)?.message?.trim();
      notifyError(
        detail
          ? `API Key認証の有効化に失敗しました: ${detail}`
          : 'API Key認証の有効化に失敗しました'
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleEditSave() {
    if (!policyName || !secretName) return;
    const errMsg = validateClients(clients);
    if (errMsg) {
      setValidationErrors([errMsg]);
      return;
    }
    setValidationErrors([]);
    try {
      setLoading(true);
      const kv: Record<string, string> = {};
      for (const c of clients) kv[c.clientId] = c.apiKey;
      await upsertOpaqueKeyValueSecret(namespace, secretName, kv);
      await updateApiKeySecurityPolicyExtractFrom({
        namespace,
        policyName,
        headerName: formHeaderName || headerName || 'x-api-key',
      });
      notifySuccess('API Key認証の設定を更新しました');
      setOpenEdit(false);
      setValidationErrors([]);
      await refresh();
      onChanged?.();
      setClients([{ clientId: '', apiKey: '' }]);
    } catch (e) {
      const detail = (e as Error)?.message?.trim();
      notifyError(
        detail ? `API Key認証の更新に失敗しました: ${detail}` : 'API Key認証の更新に失敗しました'
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={2}>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography variant="subtitle1" gutterBottom>
            API Key Authentication
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
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="subtitle2">Host:</Typography>
            <Typography variant="body2">{host || '-'}</Typography>
          </Stack>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="subtitle2">HTTPRoute:</Typography>
            <Typography variant="body2">{httpRouteName || '-'}</Typography>
          </Stack>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="subtitle2">Secret:</Typography>
            <Typography variant="body2">{secretName || '-'}</Typography>
          </Stack>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="subtitle2">Header:</Typography>
            <Typography variant="body2">{headerName || '-'}</Typography>
          </Stack>
          {!!existingClientIds.length && (
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="subtitle2">Registered Clients:</Typography>
              <Typography variant="body2">{existingClientIds.join(', ')}</Typography>
            </Stack>
          )}
          {configured && (
            <Typography variant="body2" color="text.secondary">
              既存のAPIキー値はセキュリティ上表示しません。必要に応じて再設定してください。
            </Typography>
          )}
        </Stack>
        <Box>
          {!configured ? (
            <Button
              variant="contained"
              disabled={!httpRouteName || loading}
              onClick={() => {
                setFormSecretName(secretName || 'apikey-secret');
                setFormHeaderName(headerName || 'x-api-key');
                setClients([{ clientId: '', apiKey: '' }]);
                setValidationErrors([]);
                setOpenEnable(true);
              }}
            >
              API Key認証を有効化
            </Button>
          ) : (
            <Button
              variant="outlined"
              onClick={() => {
                setFormSecretName(secretName || 'apikey-secret');
                setFormHeaderName(headerName || 'x-api-key');
                setClients([{ clientId: '', apiKey: '' }]);
                setValidationErrors([]);
                setOpenEdit(true);
              }}
            >
              編集
            </Button>
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
        <DialogTitle>API Key認証を有効化</DialogTitle>
        <DialogContent>
          <Stack spacing={2} mt={1}>
            <ValidationAlert errors={validationErrors} sx={{ mb: 1 }} />
            <TextField
              label="Secret名"
              value={formSecretName}
              onChange={e => setFormSecretName(e.target.value)}
              size="small"
              fullWidth
              helperText="クライアントID→API Keyのマップを格納するSecret名"
            />
            <TextField
              label="抽出ヘッダー名"
              value={formHeaderName}
              onChange={e => setFormHeaderName(e.target.value)}
              size="small"
              fullWidth
              helperText="例: x-api-key"
            />
            <Typography variant="subtitle2">クライアント一覧</Typography>
            <Stack spacing={1}>
              {clients.map((c, idx) => (
                <Stack key={idx} direction="row" spacing={1} alignItems="center">
                  <TextField
                    label="Client ID"
                    value={c.clientId}
                    onChange={e => setClientId(idx, e.target.value)}
                    size="small"
                    sx={{ flex: 1 }}
                  />
                  <TextField
                    label="API Key"
                    value={c.apiKey}
                    onChange={e => setApiKey(idx, e.target.value)}
                    size="small"
                    sx={{ flex: 1 }}
                  />
                  <IconButton aria-label="remove" onClick={() => removeRow(idx)} size="small">
                    <Typography variant="caption">削除</Typography>
                  </IconButton>
                </Stack>
              ))}
              <Box>
                <Button onClick={addRow} size="small">
                  行を追加
                </Button>
              </Box>
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
            キャンセル
          </Button>
          <Button variant="contained" onClick={handleEnableSave}>
            作成
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
        <DialogTitle>API Key認証の編集</DialogTitle>
        <DialogContent>
          <Stack spacing={2} mt={1}>
            <ValidationAlert errors={validationErrors} sx={{ mb: 1 }} />
            <TextField label="Secret名" value={secretName || ''} size="small" fullWidth disabled />
            <TextField
              label="抽出ヘッダー名"
              value={formHeaderName}
              onChange={e => setFormHeaderName(e.target.value)}
              size="small"
              fullWidth
            />
            <Typography variant="subtitle2">クライアント一覧（上書き保存）</Typography>
            <Stack spacing={1}>
              {clients.map((c, idx) => (
                <Stack key={idx} direction="row" spacing={1} alignItems="center">
                  <TextField
                    label="Client ID"
                    value={c.clientId}
                    onChange={e => setClientId(idx, e.target.value)}
                    size="small"
                    sx={{ flex: 1 }}
                  />
                  <TextField
                    label="API Key"
                    value={c.apiKey}
                    onChange={e => setApiKey(idx, e.target.value)}
                    size="small"
                    sx={{ flex: 1 }}
                  />
                  <IconButton aria-label="remove" onClick={() => removeRow(idx)} size="small">
                    <Typography variant="caption">削除</Typography>
                  </IconButton>
                </Stack>
              ))}
              <Box>
                <Button onClick={addRow} size="small">
                  行を追加
                </Button>
              </Box>
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
            キャンセル
          </Button>
          <Button variant="contained" onClick={handleEditSave}>
            保存
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
