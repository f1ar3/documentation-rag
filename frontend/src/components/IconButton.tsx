import type { ComponentProps } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

type Props = Omit<ComponentProps<typeof Button>, 'aria-label'> & {
  label: string
  side?: 'top' | 'right' | 'bottom' | 'left'
}

/** Icon-only button: the label is both its accessible name and its tooltip. */
export function IconButton({ label, side = 'bottom', variant = 'ghost', size = 'icon', ...props }: Props) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button variant={variant} size={size} aria-label={label} {...props} />}
      />
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  )
}
