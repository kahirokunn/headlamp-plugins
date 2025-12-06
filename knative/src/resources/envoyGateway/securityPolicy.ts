import { KubeObject, type KubeObjectInterface } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';

export interface SecurityPolicyResource extends KubeObjectInterface {
  spec: {
    targetRefs: Array<{
      group?: string;
      kind: string;
      name: string;
    }>;
    basicAuth?: {
      users?: {
        name?: string;
      };
    };
    apiKeyAuth?: {
      credentialRefs?: Array<{
        group?: string;
        kind?: string;
        name?: string;
      }>;
      extractFrom?: Array<{
        headers?: string[];
        queryParameters?: string[];
        cookies?: string[];
      }>;
    };
    jwt?: unknown;
    authorization?: {
      rules?: Array<{
        name?: string;
        principal?: {
          clientCIDRs?: string[];
        };
        action?: string;
      }>;
    };
  };
}

export class SecurityPolicy extends KubeObject<SecurityPolicyResource> {
  static kind = 'SecurityPolicy';
  static apiName = 'securitypolicies';
  static apiVersion = 'gateway.envoyproxy.io/v1alpha1';
  static isNamespaced = true;

  get metadata() {
    return this.jsonData.metadata;
  }

  get spec() {
    return this.jsonData.spec;
  }
}
