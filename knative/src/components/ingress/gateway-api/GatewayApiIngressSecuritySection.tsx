import React from 'react';
import { Box, Button, FormControlLabel, Stack, Switch, TextField, Typography } from '@mui/material';
import { formatIngressClass } from '../../../config/ingress';

type GatewayApiIngressSecuritySectionProps = {
  ingressClass: string | null;
  enableBasicAuth: boolean;
  setEnableBasicAuth: (value: boolean) => void;
  basicAuthUsername: string;
  setBasicAuthUsername: (value: string) => void;
  basicAuthPassword: string;
  setBasicAuthPassword: (value: string) => void;
  enableIpAccessControl: boolean;
  setEnableIpAccessControl: (value: boolean) => void;
  ipAllowCidrs: string[];
  handleChangeAllowCidr: (index: number, value: string) => void;
  handleAddAllowCidrRow: () => void;
  handleRemoveAllowCidr: (index: number) => void;
  ipDenyCidrs: string[];
  handleChangeDenyCidr: (index: number, value: string) => void;
  handleAddDenyCidrRow: () => void;
  handleRemoveDenyCidr: (index: number) => void;
};

export default function GatewayApiIngressSecuritySection({
  ingressClass,
  enableBasicAuth,
  setEnableBasicAuth,
  basicAuthUsername,
  setBasicAuthUsername,
  basicAuthPassword,
  setBasicAuthPassword,
  enableIpAccessControl,
  setEnableIpAccessControl,
  ipAllowCidrs,
  handleChangeAllowCidr,
  handleAddAllowCidrRow,
  handleRemoveAllowCidr,
  ipDenyCidrs,
  handleChangeDenyCidr,
  handleAddDenyCidrRow,
  handleRemoveDenyCidr,
}: GatewayApiIngressSecuritySectionProps) {
  return (
    <Box>
      <Typography variant="subtitle1" gutterBottom>
        Security (Envoy Gateway)
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Ingress class: {formatIngressClass(ingressClass)}
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
  );
}
