import InboxOutlined from '@mui/icons-material/InboxOutlined'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { Link as RouterLink } from 'react-router-dom'

/**
 * "Nothing here yet", saying what to do next:
 *   <EmptyState title="No projects yet" action={{ label: 'Create your first project', onClick }}>
 *     Projects you create or are assigned to show up here.
 *   </EmptyState>
 * action: { label, onClick } for a button or { label, to } for a link styled as one.
 * `compact` for the empty state inside a tab or under filters.
 */
export default function EmptyState({ icon: Icon = InboxOutlined, title, children, action, compact = false }) {
  return (
    <Paper variant="outlined" sx={{
      px: 3, py: compact ? 3 : 5, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 1,
      borderStyle: 'dashed', bgcolor: 'transparent',
    }}>
      <Box aria-hidden="true" sx={{
        width: 48, height: 48, borderRadius: '50%', display: 'grid', placeItems: 'center', mb: 1,
        bgcolor: 'action.hover', color: 'primary.main',
      }}>
        <Icon />
      </Box>
      <Typography component="p" variant="subtitle1" sx={{ fontWeight: 700 }}>{title}</Typography>
      {children && <Typography color="text.secondary" sx={{ maxWidth: 480 }}>{children}</Typography>}
      {action && (
        <Button variant="contained" sx={{ mt: 1.5 }} onClick={action.onClick}
          {...(action.to ? { component: RouterLink, to: action.to } : {})}>
          {action.label}
        </Button>
      )}
    </Paper>
  )
}
