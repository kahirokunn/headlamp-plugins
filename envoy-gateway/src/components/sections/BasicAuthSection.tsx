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
  createSecurityPolicyForHTTPRoute,
  detectBasicAuthConfig,
  upsertBasicAuthSecret,
} from '../../api/envoy';

export default function BasicAuthSection({
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
  const [usernames, setUsernames] = React.useState<string[]>([]);
  const [validationErrors, setValidationErrors] = React.useState<string[]>([]);

  const [openEnable, setOpenEnable] = React.useState(false);
  const [openEdit, setOpenEdit] = React.useState(false);

  // Form states
  const [formUsername, setFormUsername] = React.useState('');
  const [formPassword, setFormPassword] = React.useState('');
  const [formSecretName, setFormSecretName] = React.useState('basic-auth');

  const { notifySuccess, notifyError } = useNotify();

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const result = await detectBasicAuthConfig(namespace, host);
      setHttpRouteName(result.httpRoute?.metadata?.name ?? null);
      setPolicyName(result.securityPolicy?.metadata?.name ?? null);
      setSecretName(result.secretName);
      setUsernames(result.usernames);
      if (result.secretName) setFormSecretName(result.secretName);
      if (result.usernames?.length) setFormUsername(result.usernames[0]);
    } catch (e) {
      setError((e as Error)?.message || 'Failed to detect Basic Auth config');
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namespace, host]);

  const configured = !!(httpRouteName && secretName);

  async function handleEnableSave() {
    if (!httpRouteName) return;
    if (!formUsername || !formPassword || !formSecretName) {
      setValidationErrors(['ユーザー名・パスワード・Secret名を入力してください']);
      return;
    }
    setValidationErrors([]);
    try {
      setLoading(true);
      await upsertBasicAuthSecret(namespace, formSecretName, formUsername, formPassword);
      const spName = `${httpRouteName}-basic-auth`;
      await createSecurityPolicyForHTTPRoute({
        namespace,
        policyName: spName,
        httpRouteName,
        secretName: formSecretName,
      });
      notifySuccess('Basic認証を有効化しました');
      setOpenEnable(false);
      setValidationErrors([]);
      await refresh();
      onChanged?.();
      setFormPassword('');
    } catch (e) {
      const detail = (e as Error)?.message?.trim();
      notifyError(
        detail ? `Basic認証の有効化に失敗しました: ${detail}` : 'Basic認証の有効化に失敗しました'
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleEditSave() {
    if (!secretName) return;
    if (!formUsername || !formPassword) {
      setValidationErrors(['ユーザー名と新しいパスワードを入力してください']);
      return;
    }
    setValidationErrors([]);
    try {
      setLoading(true);
      await upsertBasicAuthSecret(namespace, secretName, formUsername, formPassword);
      notifySuccess('Basic認証の資格情報を更新しました');
      setOpenEdit(false);
      setValidationErrors([]);
      await refresh();
      onChanged?.();
      setFormPassword('');
    } catch (e) {
      const detail = (e as Error)?.message?.trim();
      notifyError(
        detail ? `Basic認証の更新に失敗しました: ${detail}` : 'Basic認証の更新に失敗しました'
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
            <Typography variant="subtitle2">Usernames:</Typography>
            <Typography variant="body2">{usernames.length ? usernames.join(', ') : '-'}</Typography>
          </Stack>
          {configured && (
            <Typography variant="body2" color="text.secondary">
              パスワードはハッシュで保存されているため表示できません。変更は「編集」から行えます。
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
                setFormSecretName(secretName || 'basic-auth');
                setValidationErrors([]);
                setOpenEnable(true);
              }}
            >
              Basic認証を有効化
            </Button>
          ) : (
            <Button
              variant="outlined"
              onClick={() => {
                setFormUsername(usernames[0] || '');
                setFormPassword('');
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
        maxWidth="sm"
      >
        <DialogTitle>Basic認証を有効化</DialogTitle>
        <DialogContent>
          <Stack spacing={2} mt={1}>
            <ValidationAlert errors={validationErrors} sx={{ mb: 1 }} />
            <TextField
              label="Secret名"
              value={formSecretName}
              onChange={e => setFormSecretName(e.target.value)}
              size="small"
              fullWidth
              helperText="認証情報(.htpasswd)を格納するSecret名"
            />
            <TextField
              label="ユーザー名"
              value={formUsername}
              onChange={e => setFormUsername(e.target.value)}
              size="small"
              fullWidth
            />
            <TextField
              label="パスワード"
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
        maxWidth="sm"
      >
        <DialogTitle>Basic認証の編集</DialogTitle>
        <DialogContent>
          <Stack spacing={2} mt={1}>
            <ValidationAlert errors={validationErrors} sx={{ mb: 1 }} />
            <TextField label="Secret名" value={secretName || ''} size="small" fullWidth disabled />
            <TextField
              label="ユーザー名"
              value={formUsername}
              onChange={e => setFormUsername(e.target.value)}
              size="small"
              fullWidth
            />
            <TextField
              label="新しいパスワード"
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
