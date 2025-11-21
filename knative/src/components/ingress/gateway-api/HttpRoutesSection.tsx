import React from 'react';
import { Chip, Paper, Stack, Typography } from '@mui/material';
import type { HTTPRoute } from '../../../api/envoy';
import { Link as HeadlampLink } from '@kinvolk/headlamp-plugin/lib/CommonComponents';

type HttpRoutesSectionProps = {
  title: string;
  namespace: string;
  routes: HTTPRoute[] | null;
  serviceName?: string;
  networkTemplates?: { domainTemplate: string; tagTemplate: string };
};

function buildTagHostnameRegex(
  domainTemplate: string,
  tagTemplate: string,
  serviceName: string,
  namespace: string
): RegExp {
  // Replace tokens in tag template to produce Name part
  let namePattern = tagTemplate;
  // Escape regex special chars outside tokens
  namePattern = namePattern.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  // Unescape token braces to process replacements
  namePattern = namePattern
    .replace(/\\{{2}\.Tag\\}{2}/g, '(?<tag>[a-z0-9-]+)')
    .replace(/\\{{2}\.Name\\}{2}/g, serviceName.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'));
  // Any other templated variables -> permissive
  namePattern = namePattern.replace(/\\{{2}[^}]+\\}{2}/g, '.*?');

  // Build full hostname pattern from domain template
  let pattern = domainTemplate;
  pattern = pattern.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  pattern = pattern
    .replace(/\\{{2}\.Name\\}{2}/g, namePattern)
    .replace(/\\{{2}\.Namespace\\}{2}/g, namespace.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'))
    .replace(/\\{{2}\.Domain\\}{2}/g, '.+');
  // Any other templated variables -> permissive
  pattern = pattern.replace(/\\{{2}[^}]+\\}{2}/g, '.*?');
  return new RegExp(`^${pattern}$`);
}

function isTagRoute(
  r: HTTPRoute,
  serviceName: string | undefined,
  namespace: string,
  templates?: { domainTemplate: string; tagTemplate: string }
): boolean {
  if (!serviceName || !templates) return false;
  const hostnames = r.spec?.hostnames ?? [];
  if (hostnames.length === 0) return false;
  const re = buildTagHostnameRegex(
    templates.domainTemplate,
    templates.tagTemplate,
    serviceName,
    namespace
  );
  return hostnames.some(h => re.test(h));
}

export default function HttpRoutesSection({
  title,
  namespace,
  routes,
  serviceName,
  networkTemplates,
}: HttpRoutesSectionProps) {
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={1}>
        <Typography variant="subtitle1" gutterBottom>
          {title}
        </Typography>
        {routes && routes.length > 0 ? (
          <Stack spacing={0.5}>
            {routes.map(r => (
              <Stack key={r.metadata.name} direction="row" spacing={1} alignItems="center">
                <HeadlampLink
                  routeName="/plugins/envoy-gateway/httproutes/:namespace/:name"
                  params={{ namespace, name: r.metadata.name }}
                >
                  {r.metadata.name}
                </HeadlampLink>
                {/* badges */}
                <Stack direction="row" spacing={0.5} alignItems="center">
                  {r.metadata.labels?.['serving.knative.dev/domainMappingUID'] && (
                    <Chip label="DomainMapping" size="small" color="info" />
                  )}
                  {isTagRoute(r, serviceName, namespace, networkTemplates) && (
                    <Chip label="tag" size="small" color="default" />
                  )}
                </Stack>
                <Typography variant="caption" color="text.secondary">
                  {(r.spec?.hostnames ?? []).join(', ')}
                </Typography>
              </Stack>
            ))}
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary">
            -
          </Typography>
        )}
      </Stack>
    </Paper>
  );
}

