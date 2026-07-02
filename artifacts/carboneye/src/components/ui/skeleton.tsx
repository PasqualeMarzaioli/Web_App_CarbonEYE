/**
 * artifacts/carboneye/src/components/ui/skeleton.tsx — Skeleton UI component (shadcn/ui) for the CarbonEYE design system.
 */
import { cn } from "@/lib/utils"

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-primary/10", className)}
      {...props}
    />
  )
}

export { Skeleton }
