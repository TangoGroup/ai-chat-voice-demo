"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

type GlassButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  size?: "sm" | "md" | "lg";
};

export const GlassButton = React.forwardRef<HTMLButtonElement, GlassButtonProps>(
  ({ className, active = false, size = "md", children, ...props }, ref) => {
    const dims = size === "sm" ? "h-12 w-12" : size === "lg" ? "h-20 w-20" : "h-16 w-16";
    return (
      <button
        ref={ref}
        className={cn(
          "relative inline-flex items-center justify-center rounded-full transition-all",
          dims,
          // Liquid glass effect
          "backdrop-blur-md bg-white/10 dark:bg-white/5 border border-white/20 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2),0_8px_32px_rgba(0,0,0,0.25)]",
          active ? "ring-2 ring-primary/60" : "hover:scale-[1.03]",
          className
        )}
        {...props}
      >
        {/* Inner subtle gradient sheen */}
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 rounded-full",
            "bg-[radial-gradient(120%_120%_at_50%_0%,rgba(255,255,255,0.35)_0%,rgba(255,255,255,0.08)_40%,transparent_60%)]"
          )}
        />
        {/* Content */}
        <span className="relative z-10 text-foreground">{children}</span>
      </button>
    );
  }
);
GlassButton.displayName = "GlassButton";


