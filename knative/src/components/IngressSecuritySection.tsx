import React from 'react';
import { Alert, Box, Typography } from '@mui/material';
import { INGRESS_CLASS_GATEWAY_API, formatIngressClass } from '../config/ingress';
import GatewayApiIngressSecuritySection from './ingress/gateway-api/GatewayApiIngressSecuritySection';

type IngressSecuritySectionProps = {
  ingressClass: string | null;
  ingressClassLoaded: boolean;
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

export default function IngressSecuritySection(props: IngressSecuritySectionProps) {
  const { ingressClassLoaded, ingressClass } = props;

  if (!ingressClassLoaded) {
    return (
      <Box>
        <Typography variant="subtitle1" gutterBottom>
          Security
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Detecting ingress configuration...
        </Typography>
      </Box>
    );
  }

  switch (ingressClass) {
    case INGRESS_CLASS_GATEWAY_API:
      return <GatewayApiIngressSecuritySection {...props} />;

    default:
      return (
        <Box>
          <Typography variant="subtitle1" gutterBottom>
            Security (Envoy Gateway)
          </Typography>
          <Alert severity="warning" variant="filled">
            Envoy Gateway-based security features are available only when Knative "config-network"
            ConfigMap ingress.class
            {ingressClass == null
              ? ' is not set.'
              : ` is set to "${ingressClass}", not "${INGRESS_CLASS_GATEWAY_API}".`}{' '}
            These settings are disabled for the current configuration.
          </Alert>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Ingress class: {formatIngressClass(ingressClass)}
          </Typography>
        </Box>
      );
  }
}
