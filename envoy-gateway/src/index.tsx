/*
 * Copyright 2025 The Kubernetes Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Stack } from '@mui/material';
import {
  registerDetailsViewSection,
  type DetailsViewSectionProps,
} from '@kinvolk/headlamp-plugin/lib';
import { SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { BasicAuthSection } from './components/sections/BasicAuthSection';
import { IpAccessSection } from './components/sections/IpAccessSection';
import { RetrySection } from './components/sections/RetrySection';
import { KubeHTTPRoute } from '@kinvolk/headlamp-plugin/lib/lib/k8s/httpRoute';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';

function isHTTPRoute(resource: KubeObject): resource is KubeObject<KubeHTTPRoute> {
  const jsonData = resource?.jsonData ?? {};
  return (
    jsonData.kind === 'HTTPRoute' && jsonData.apiVersion?.startsWith('gateway.networking.k8s.io')
  );
}

registerDetailsViewSection(({ resource }: DetailsViewSectionProps) => {
  if (!isHTTPRoute(resource)) {
    return null;
  }
  const route = resource.jsonData;

  const status = route.status as { parents?: Array<{ controllerName?: string }> };

  const host = route.spec?.hostnames?.[0];
  const cluster = resource.cluster;

  const hasEnvoyGatewayController =
    status?.parents?.some(
      parent => parent.controllerName === 'gateway.envoyproxy.io/gatewayclass-controller'
    ) ?? false;

  if (!host || !cluster || !hasEnvoyGatewayController) {
    return null;
  }

  return (
    <SectionBox title="Envoy Gateway">
      <Stack spacing={2}>
        <BasicAuthSection cluster={cluster} httpRoute={route} />
        <RetrySection cluster={cluster} httpRoute={route} />
        <IpAccessSection cluster={cluster} httpRoute={route} />
      </Stack>
    </SectionBox>
  );
});
