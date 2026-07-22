import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-lg border border-line bg-raised px-3.5 py-1 text-sm text-ink shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-ink placeholder:text-faint focus-visible:border-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/30 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
