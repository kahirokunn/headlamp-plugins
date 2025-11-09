import React from 'react';
import {
  Autocomplete,
  Box,
  Chip,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import type { KnativeRevision, KnativeService, TrafficTarget } from '../types/knative';
import { getAge, updateTraffic } from '../api/knative';
import { useNotify } from './common/notifications/useNotify';

type Props = {
  namespace: string;
  name: string;
  service: KnativeService;
  revisions: KnativeRevision[];
  onSaved?: () => void;
};

export default function TrafficSplittingSection({
  namespace,
  name,
  service,
  revisions,
  onSaved,
}: Props) {
  // Ported the original UI logic as-is
  const [revPercents, setRevPercents] = React.useState<Record<string, number>>({});
  const [revTags, setRevTags] = React.useState<Record<string, string[]>>({});
  const [latestPercent, setLatestPercent] = React.useState<number>(0);
  const [latestTags, setLatestTags] = React.useState<string[]>([]);
  const [savingTraffic, setSavingTraffic] = React.useState(false);
  const { notifySuccess, notifyError } = useNotify();

  React.useEffect(() => {
    if (!service || !revisions) return;
    const trafficEntries = (service.spec?.traffic || service.status?.traffic || []) as NonNullable<
      KnativeService['status']
    >['traffic'];
    const byRev = new Map<string, { percent: number; tags: Set<string> }>();
    let latestPercentTotal = 0;
    const latestTagsSet = new Set<string>();
    (trafficEntries || []).forEach(t => {
      if (t.latestRevision) {
        latestPercentTotal += Number(t.percent || 0);
        if (t.tag) {
          latestTagsSet.add(t.tag);
        }
        return;
      }
      const target = (t as any).revisionName;
      if (!target) return;
      const info = byRev.get(target) || { percent: 0, tags: new Set<string>() };
      info.percent += Number(t.percent || 0);
      if (t.tag) {
        info.tags.add(t.tag);
      }
      byRev.set(target, info);
    });
    const nextPercents: Record<string, number> = {};
    const nextTags: Record<string, string[]> = {};
    for (const r of revisions) {
      const revName = r.metadata.name;
      const info = byRev.get(revName);
      nextPercents[revName] = info?.percent ?? 0;
      nextTags[revName] = info ? Array.from(info.tags) : [];
    }
    setRevPercents(nextPercents);
    setRevTags(nextTags);
    setLatestPercent(latestPercentTotal);
    setLatestTags(Array.from(latestTagsSet));
  }, [service, revisions]);

  const totalTraffic = React.useMemo(() => {
    const revisionTotal = Object.values(revPercents).reduce((acc, v) => acc + (Number(v) || 0), 0);
    return revisionTotal + (Number(latestPercent) || 0);
  }, [revPercents, latestPercent]);

  const allTags = React.useMemo(() => {
    const tags: string[] = [];
    Object.values(revTags).forEach(list => {
      list.forEach(tag => {
        const trimmed = tag.trim();
        if (trimmed) tags.push(trimmed);
      });
    });
    latestTags.forEach(tag => {
      const trimmed = tag.trim();
      if (trimmed) tags.push(trimmed);
    });
    return tags;
  }, [revTags, latestTags]);

  const hasDuplicateTags = React.useMemo(() => {
    const seen = new Set<string>();
    for (const tag of allTags) {
      if (seen.has(tag)) return true;
      seen.add(tag);
    }
    return false;
  }, [allTags]);

  const latestReadyRevisionName = service?.status?.latestReadyRevisionName;
  const latestReadyRevision = React.useMemo(() => {
    if (!latestReadyRevisionName || !revisions) return undefined;
    return revisions.find(r => r.metadata.name === latestReadyRevisionName);
  }, [revisions, latestReadyRevisionName]);

  const trafficValidationError = React.useMemo(() => {
    if (!revisions?.length) return 'No revisions available';
    for (const key of Object.keys(revPercents)) {
      const val = Number(revPercents[key]);
      if (Number.isNaN(val) || val < 0 || val > 100) {
        return 'Traffic percentages must be between 0 and 100';
      }
    }
    const latestVal = Number(latestPercent);
    if (Number.isNaN(latestVal) || latestVal < 0 || latestVal > 100) {
      return 'Latest revision percent must be between 0 and 100';
    }
    if (totalTraffic !== 100) {
      return 'Total traffic must equal 100%';
    }
    if (hasDuplicateTags) {
      return 'Tags must be unique';
    }
    return null;
  }, [revPercents, totalTraffic, latestPercent, hasDuplicateTags, revisions]);

  const isTrafficValid = !trafficValidationError;

  async function onSaveTraffic() {
    if (!service || !revisions) return;
    if (!isTrafficValid) return;
    setSavingTraffic(true);
    try {
      const traffic: TrafficTarget[] = [];
      const revisionNames = Array.from(
        new Set([...Object.keys(revPercents), ...Object.keys(revTags)])
      );
      revisionNames.forEach(revisionName => {
        const numericPercent = Number(revPercents[revisionName] ?? 0) || 0;
        const tags = revTags[revisionName] || [];
        const uniqueTags = Array.from(
          new Set(tags.map(tag => tag.trim()).filter(tag => tag.length > 0))
        );
        if (numericPercent > 0) {
          traffic.push({
            revisionName,
            percent: numericPercent,
          });
        }
        uniqueTags.forEach(tag => {
          traffic.push({
            revisionName,
            percent: 0,
            tag,
          });
        });
      });
      const trimmedLatestTags = Array.from(
        new Set(latestTags.map(tag => tag.trim()).filter(tag => tag.length > 0))
      );
      const latestPercentValue = Number(latestPercent) || 0;
      if (latestPercentValue > 0) {
        traffic.push({
          latestRevision: true,
          percent: latestPercentValue,
        });
      }
      trimmedLatestTags.forEach(tag => {
        traffic.push({
          latestRevision: true,
          percent: 0,
          tag,
        });
      });
      await updateTraffic(namespace, name, traffic);
      notifySuccess('Traffic updated');
      onSaved?.();
    } catch (err) {
      const detail = (err as Error)?.message?.trim();
      notifyError(detail ? `Failed to update traffic: ${detail}` : 'Failed to update traffic');
    } finally {
      setSavingTraffic(false);
    }
  }

  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle1" gutterBottom>
          Traffic Splitting
        </Typography>
        <TableContainer>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Ready</TableCell>
                <TableCell>Age</TableCell>
                <TableCell>Traffic</TableCell>
                <TableCell>Tags</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(() => {
                const sorted = [...revisions].sort((a, b) => {
                  const at = new Date(a.metadata.creationTimestamp || 0).getTime();
                  const bt = new Date(b.metadata.creationTimestamp || 0).getTime();
                  return at - bt;
                });
                const latestReadyCondition = latestReadyRevision?.status?.conditions?.find(
                  c => c.type === 'Ready'
                );
                const rows = sorted.map(r => {
                  const readyCond = r.status?.conditions?.find(c => c.type === 'Ready');
                  const ready = readyCond?.status === 'True';
                  const isLatest = latestReadyRevisionName === r.metadata.name;
                  return (
                    <TableRow key={r.metadata.name} hover>
                      <TableCell>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Typography variant="body2">{r.metadata.name}</Typography>
                          {isLatest && (
                            <Chip
                              label="Latest Ready"
                              color="info"
                              size="small"
                              variant="outlined"
                            />
                          )}
                        </Stack>
                      </TableCell>
                      <TableCell>
                        {ready ? (
                          <Chip label="Ready" color="success" size="small" />
                        ) : (
                          <Chip
                            label={readyCond?.status || 'Unknown'}
                            color="warning"
                            size="small"
                          />
                        )}
                      </TableCell>
                      <TableCell>{getAge(r.metadata.creationTimestamp)}</TableCell>
                      <TableCell>
                        <TextField
                          type="number"
                          size="small"
                          inputProps={{ min: 0, max: 100, step: 1, inputMode: 'numeric' }}
                          onFocus={e => {
                            try {
                              (e.target as HTMLInputElement).select();
                            } catch {
                              // noop
                            }
                          }}
                          value={revPercents[r.metadata.name] ?? 0}
                          onChange={e =>
                            setRevPercents(prev => ({
                              ...prev,
                              [r.metadata.name]: Number(e.target.value),
                            }))
                          }
                          sx={{ width: 100 }}
                        />
                      </TableCell>
                      <TableCell>
                        <Autocomplete<string, true, false, true>
                          multiple
                          freeSolo
                          size="small"
                          value={revTags[r.metadata.name] || []}
                          options={[]}
                          filterSelectedOptions
                          onChange={(_, newValue) => {
                            const unique = Array.from(
                              new Set((newValue as string[]).map(v => v.trim()).filter(Boolean))
                            );
                            setRevTags(prev => ({
                              ...prev,
                              [r.metadata.name]: unique,
                            }));
                          }}
                          renderTags={(value, getTagProps) =>
                            value.map((option, index) => (
                              <Chip
                                {...getTagProps({ index })}
                                key={`${option}-${index}`}
                                label={option}
                                size="small"
                              />
                            ))
                          }
                          renderInput={params => <TextField {...params} placeholder="Add tag" />}
                          sx={{ minWidth: 220 }}
                        />
                      </TableCell>
                    </TableRow>
                  );
                });
                rows.push(
                  <TableRow key="latest-revision" hover={Boolean(latestReadyRevisionName)}>
                    <TableCell>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Typography variant="body2">Latest Ready</Typography>
                        {latestReadyRevisionName ? (
                          <Chip
                            label={latestReadyRevisionName}
                            size="small"
                            variant="outlined"
                            color="info"
                          />
                        ) : (
                          <Chip
                            label="Unavailable"
                            color="warning"
                            size="small"
                            variant="outlined"
                          />
                        )}
                      </Stack>
                    </TableCell>
                    <TableCell>
                      {latestReadyRevision ? (
                        latestReadyCondition?.status === 'True' ? (
                          <Chip label="Ready" color="success" size="small" />
                        ) : (
                          <Chip
                            label={latestReadyCondition?.status || 'Unknown'}
                            color="warning"
                            size="small"
                          />
                        )
                      ) : (
                        <Chip label="Unknown" color="warning" size="small" />
                      )}
                    </TableCell>
                    <TableCell>
                      {latestReadyRevision
                        ? getAge(latestReadyRevision.metadata.creationTimestamp)
                        : '-'}
                    </TableCell>
                    <TableCell>
                      <TextField
                        type="number"
                        size="small"
                        inputProps={{ min: 0, max: 100, step: 1, inputMode: 'numeric' }}
                        onFocus={e => {
                          try {
                            (e.target as HTMLInputElement).select();
                          } catch {
                            // noop
                          }
                        }}
                        value={latestPercent}
                        onChange={e => {
                          const numeric = Number(e.target.value);
                          setLatestPercent(Number.isNaN(numeric) ? 0 : numeric);
                        }}
                        sx={{ width: 100 }}
                      />
                    </TableCell>
                    <TableCell>
                      <Autocomplete<string, true, false, true>
                        multiple
                        freeSolo
                        size="small"
                        value={latestTags}
                        options={[]}
                        filterSelectedOptions
                        onChange={(_, newValue) => {
                          const unique = Array.from(
                            new Set((newValue as string[]).map(v => v.trim()).filter(Boolean))
                          );
                          setLatestTags(unique);
                        }}
                        renderTags={(value, getTagProps) =>
                          value.map((option, index) => (
                            <Chip
                              {...getTagProps({ index })}
                              key={`${option}-${index}`}
                              label={option}
                              size="small"
                            />
                          ))
                        }
                        renderInput={params => <TextField {...params} placeholder="Add tag" />}
                        sx={{ minWidth: 220 }}
                      />
                    </TableCell>
                  </TableRow>
                );
                return rows;
              })()}
            </TableBody>
          </Table>
        </TableContainer>
        <Box
          mt={2}
          display="flex"
          justifyContent="space-between"
          alignItems="center"
          flexWrap="wrap"
          gap={1}
        >
          <Box display="flex" flexDirection="column">
            <Typography variant="body2" color={isTrafficValid ? 'text.secondary' : 'error'}>
              Total: {totalTraffic}% (must equal 100%)
            </Typography>
            {!isTrafficValid && trafficValidationError && (
              <Typography variant="caption" color="error">
                {trafficValidationError}
              </Typography>
            )}
          </Box>
          <Chip
            component="button"
            onClick={onSaveTraffic as any}
            disabled={!isTrafficValid || savingTraffic}
            color="primary"
            label={savingTraffic ? 'Saving…' : 'Save'}
            role="button"
            aria-label="Save traffic"
            clickable
          />
        </Box>
      </Paper>
    </Stack>
  );
}
