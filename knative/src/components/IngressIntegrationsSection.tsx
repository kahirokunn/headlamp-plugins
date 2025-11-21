import GatewayApiIngressSection from './ingress/gateway-api/GatewayApiIngressSection';

type IngressIntegrationsSectionProps = {
  namespace: string;
  serviceName: string;
  ingressClass: string | null;
  ingressClassLoaded: boolean;
};

/**
 * Renders ingress-specific integration sections based on the configured ingress class.
 *
 * To add support for additional ingress providers (e.g., Contour, Istio):
 * 1. Create a new component (e.g., ContourIngressSection.tsx, IstioIngressSection.tsx)
 * 2. Import it in this file
 * 3. Add a case in the switch statement below to handle the new ingress class value
 */
export default function IngressIntegrationsSection({
  namespace,
  serviceName,
  ingressClass,
  ingressClassLoaded,
}: IngressIntegrationsSectionProps) {
  // Only render when ingress class is loaded
  if (!ingressClassLoaded) {
    return null;
  }

  switch (ingressClass) {
    case 'gateway-api.ingress.networking.knative.dev':
      return <GatewayApiIngressSection namespace={namespace} serviceName={serviceName} />;

    // Future: Add other ingress providers here
    // case 'contour.ingress.networking.knative.dev':
    //   return <ContourIngressSection namespace={namespace} serviceName={serviceName} />;
    // case 'istio.ingress.networking.knative.dev':
    //   return <IstioIngressSection namespace={namespace} serviceName={serviceName} />;

    default:
      // No matching ingress provider found
      return null;
  }
}
