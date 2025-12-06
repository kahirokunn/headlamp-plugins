import { KubeObject, type KubeObjectInterface } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
import type { Condition } from './common';

export interface DomainMappingResource extends KubeObjectInterface {
  spec: {
    ref: {
      apiVersion?: string;
      kind?: string;
      name: string;
      namespace?: string;
    };
  };
  status?: {
    url?: string;
    address?: {
      url?: string;
    };
    conditions?: Condition[];
  };
}

export class KnativeDomainMapping extends KubeObject<DomainMappingResource> {
  static kind = 'DomainMapping';
  static apiName = 'domainmappings';
  static apiVersion = 'serving.knative.dev/v1beta1';
  static isNamespaced = true;

  get metadata() {
    return this.jsonData.metadata;
  }

  get spec() {
    return this.jsonData.spec;
  }

  get status() {
    return this.jsonData.status;
  }

  get host(): string | undefined {
    return this.metadata?.name;
  }

  get readyUrl(): string | undefined {
    const isReady =
      this.status?.conditions?.find((c: Condition) => c.type === 'Ready')?.status === 'True';
    const url = this.status?.url || this.status?.address?.url;
    return isReady && url ? url : undefined;
  }
}
