import { KubeObject, type KubeObjectInterface } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';

interface EnvoySecurityPolicySpec {
  targetRefs?: {
    group?: string;
    kind?: string;
    name?: string;
  }[];
  basicAuth?: {
    users?: {
      name?: string;
    };
  } | null;
  authorization?: {
    rules?: unknown[];
  } | null;
}

interface EnvoySecurityPolicy extends KubeObjectInterface {
  spec: EnvoySecurityPolicySpec;
}

export class SecurityPolicy extends KubeObject<EnvoySecurityPolicy> {
  static kind = 'SecurityPolicy';
  static apiName = 'securitypolicies';
  static apiVersion = 'gateway.envoyproxy.io/v1alpha1';
  static isNamespaced = true;

  get spec(): EnvoySecurityPolicy['spec'] {
    return this.jsonData.spec;
  }
}
