import { KubeObject, type KubeObjectInterface } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';

interface EnvoyBackendTrafficPolicySpec {
  targetRefs?: Array<{
    group?: string;
    kind?: string;
    name?: string;
  }>;
  retry?: {
    numRetries?: number;
    perRetry?: {
      backOff?: {
        baseInterval?: string;
        maxInterval?: string;
      };
      timeout?: string;
    };
    retryOn?: {
      httpStatusCodes?: number[];
      triggers?: string[];
    };
  };
}

export interface EnvoyBackendTrafficPolicy extends KubeObjectInterface {
  spec?: EnvoyBackendTrafficPolicySpec;
}

export class BackendTrafficPolicy extends KubeObject<EnvoyBackendTrafficPolicy> {
  static kind = 'BackendTrafficPolicy';
  static apiName = 'backendtrafficpolicies';
  static apiVersion = 'gateway.envoyproxy.io/v1alpha1';
  static isNamespaced = true;

  static getBaseObject(): EnvoyBackendTrafficPolicy {
    const baseObject = super.getBaseObject() as EnvoyBackendTrafficPolicy;

    baseObject.spec = {
      targetRefs: [],
    };

    return baseObject;
  }

  get spec(): EnvoyBackendTrafficPolicy['spec'] {
    return this.jsonData.spec;
  }
}
