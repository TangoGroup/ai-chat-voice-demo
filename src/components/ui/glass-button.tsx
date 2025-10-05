"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

type GlassButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  size?: "sm" | "md" | "lg";
  diameter?: number; // px override
  blurClassName?: string; // allow custom blur strength
};

export const GlassButton = React.forwardRef<HTMLButtonElement, GlassButtonProps>(
  ({ className, active = false, size = "md", diameter, blurClassName = "backdrop-blur-xl", children, ...props }, ref) => {
    const dimsPx = typeof diameter === "number" && diameter > 0 ? Math.floor(diameter) : undefined;
    const sizeClass = !dimsPx ? (size === "sm" ? "h-12 w-12" : size === "lg" ? "h-24 w-24" : "h-20 w-20") : undefined;
    return (
      <button
        ref={ref}
        className={cn(
          "relative inline-flex items-center justify-center rounded-full transition-transform",
          sizeClass,
          // Frosted glass: 70% overlay + heavy backdrop blur
          blurClassName,
          "bg-white/70 dark:bg-white/60 border border-white/30 shadow-[0_8px_24px_rgba(0,0,0,0.18)]",
          active ? "ring-2 ring-primary/60" : "hover:scale-[1.03]",
          className
        )}
        style={dimsPx ? { width: dimsPx, height: dimsPx } : undefined}
        {...props}
      >
        {/* Subtle inner highlight */}
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 rounded-full",
            "bg-[radial-gradient(120%_120%_at_50%_0%,rgba(255,255,255,0.45)_0%,rgba(255,255,255,0.12)_40%,transparent_60%)]"
          )}
        />
        <span className="relative z-10 text-foreground">{children}</span>
      </button>
    );
  }
);
GlassButton.displayName = "GlassButton";


