import Typography from '@mui/material/Typography'
import DashboardSection from './DashboardSection'

/**
 * A number card. `count(data)` returns { value, note? }: value is a number or a
 * word such as "Hidden" (never a made-up 0), note is one line of context.
 */
export default function StatCard({ id, title, result, count }) {
  return (
    <DashboardSection id={id} title={title} result={result} headingLevel="h3">
      {(data) => {
        const { value, note } = count(data)
        return (
          <>
            <Typography component="p" variant="h4" sx={{ fontWeight: 700, lineHeight: 1.2 }}>{value}</Typography>
            {note && <Typography variant="body2" color="text.secondary">{note}</Typography>}
          </>
        )
      }}
    </DashboardSection>
  )
}
