import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Button,
} from '@mui/material';
import CreateKnativeServiceDialog from './CreateKnativeServiceDialog';

type Props = {
  clusters: string[];
  onClose: () => void;
};

export default function CreateKnativeServiceDialogWithClusterSelector({
  clusters,
  onClose,
}: Props) {
  const [pendingCluster, setPendingCluster] = React.useState<string>('');
  const [selectedCluster, setSelectedCluster] = React.useState<string>(() =>
    clusters.length === 1 ? clusters[0] : ''
  );

  React.useEffect(() => {
    if (clusters.length === 1) {
      setSelectedCluster(clusters[0]);
      setPendingCluster('');
      return;
    }

    // When the available clusters list changes and there are multiple clusters,
    // reset selection so the user explicitly chooses again.
    setSelectedCluster('');
    setPendingCluster('');
  }, [clusters]);

  const handleCloseAll = () => {
    setPendingCluster('');
    setSelectedCluster('');
    onClose();
  };

  const handleNextFromCluster = () => {
    if (!pendingCluster) return;
    setSelectedCluster(pendingCluster);
  };

  if (clusters.length === 0) {
    return null;
  }

  if (selectedCluster) {
    return <CreateKnativeServiceDialog cluster={selectedCluster} onClose={handleCloseAll} />;
  }

  return (
    <Dialog open onClose={handleCloseAll} fullWidth maxWidth="xs">
      <DialogTitle>Select cluster for new KService</DialogTitle>
      <DialogContent dividers>
        <FormControl fullWidth size="small">
          <InputLabel id="create-cluster-select-label">Cluster</InputLabel>
          <Select
            labelId="create-cluster-select-label"
            label="Cluster"
            value={pendingCluster}
            onChange={e => setPendingCluster(e.target.value)}
          >
            {clusters.map(cluster => (
              <MenuItem key={cluster} value={cluster}>
                {cluster}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleCloseAll}>Cancel</Button>
        <Button variant="contained" disabled={!pendingCluster} onClick={handleNextFromCluster}>
          Next
        </Button>
      </DialogActions>
    </Dialog>
  );
}
