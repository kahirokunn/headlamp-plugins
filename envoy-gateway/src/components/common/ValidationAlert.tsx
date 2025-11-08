import React from 'react';
import { Alert, AlertProps, List, ListItem, ListItemText } from '@mui/material';

export function ValidationAlert({
  errors,
  ...props
}: {
  errors?: string[] | null;
} & AlertProps) {
  if (!errors || errors.length === 0) return null;
  return (
    <Alert severity="error" {...props}>
      <List dense disablePadding>
        {errors.map((e, i) => (
          <ListItem key={i} disableGutters dense>
            <ListItemText primaryTypographyProps={{ variant: 'body2' }} primary={e} />
          </ListItem>
        ))}
      </List>
    </Alert>
  );
}
