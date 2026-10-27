import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import * as React from "react";

import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[background-color,border-color,color,box-shadow,transform,filter] duration-150 ease-[var(--ease-out)] active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-[linear-gradient(180deg,var(--accent-hi),var(--accent))] text-on-accent shadow-[0_1px_2px_rgb(65_65_168/0.22),inset_0_1px_0_rgb(255_255_255/0.14)] hover:brightness-[1.06] hover:shadow-[0_4px_12px_-4px_rgb(91_91_214/0.45),inset_0_1px_0_rgb(255_255_255/0.14)]",
        secondary: "border border-line bg-surface text-ink shadow-[var(--shadow-card)] hover:border-line-strong hover:bg-surface-muted",
        ghost: "text-ink-soft hover:bg-surface-muted hover:text-ink",
        subtle: "bg-accent-soft text-accent-strong hover:bg-accent-soft-hover",
        danger: "bg-danger text-on-accent hover:brightness-110",
        "danger-outline": "border border-danger-line bg-surface text-danger hover:bg-danger-soft",
        link: "h-auto px-0 text-accent underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 px-3 text-[13px]",
        md: "h-9 px-3.5",
        lg: "h-10 px-4",
        icon: "size-9",
        "icon-sm": "size-8",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
  /** Shown as a tooltip when the button is disabled, explaining why. */
  disabledReason?: string;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, disabled, disabledReason, children, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    if (disabled && disabledReason && !asChild) {
      return (
        <Tooltip content={disabledReason}>
          <span tabIndex={0} className="inline-flex rounded-md focus-visible:outline-2 focus-visible:outline-accent" aria-label={disabledReason}>
            <Button ref={ref} className={className} variant={variant} size={size} disabled {...props}>
              {children}
            </Button>
          </span>
        </Tooltip>
      );
    }
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={asChild ? undefined : disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {asChild ? (
          children
        ) : (
          <>
            {loading && <Loader2 className="animate-spin" aria-hidden />}
            {children}
          </>
        )}
      </Comp>
    );
  },
);
Button.displayName = "Button";

export { buttonVariants };
