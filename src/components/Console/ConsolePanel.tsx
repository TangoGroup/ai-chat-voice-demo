"use client";

import { forwardRef, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

export interface ConsolePanelProps {
  title?: string;
  logs: readonly string[];
  canRecord: boolean;
  isRecording: boolean;
  onClear: () => void;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
  /**
   * If true, hide the overlay. If false, keep overlay but clicking on it closes the sheet.
   */
  hideOverlay?: boolean;
  hud?: { state: string; mic: number; tts: number; eff: number } | null;
  /**
   * Optional callback to manually trigger TTS with entered text.
   */
  onSpeak?: (text: string) => void;
  /**
   * Enable user speech to interrupt AI speaking/processing.
   */
  interactiveEnabled?: boolean;
  onToggleInteractive?: (enabled: boolean) => void;
}

const ConsolePanel = forwardRef<HTMLDivElement, ConsolePanelProps>(function ConsolePanel(
  { title = "Voice Chat Console", logs, canRecord, isRecording, onClear, textareaRef, hideOverlay = true, hud = null, onSpeak, interactiveEnabled = false, onToggleInteractive },
  _ref
) {
  useEffect(() => {
    if (textareaRef?.current) {
      textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
    }
  }, [logs.length, textareaRef]);

  const [manualText, setManualText] = useState<string>("");

  const canSpeak = typeof onSpeak === "function" && manualText.trim().length > 0;

  return (
    <div className="fixed bottom-4 right-4 z-50" ref={_ref}>
      <Sheet>
        <SheetTrigger asChild>
          <Button variant="default">Console</Button>
        </SheetTrigger>
        <SheetContent side="right" showOverlay={!hideOverlay}>
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
          </SheetHeader>
          <div className="p-4 flex items-center gap-3">
            <div className="text-sm text-muted-foreground">
              {canRecord ? (isRecording ? "Recording…" : "Idle") : "Recording unsupported"}
            </div>
            <div className="flex-1" />
            <Button type="button" variant="secondary" onClick={onClear} disabled={logs.length === 0}>
              Clear
            </Button>
          </div>
          {/* Interrupt toggle */}
          <div className="px-4 pb-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={!!interactiveEnabled}
                onChange={(e) => onToggleInteractive?.(e.target.checked)}
                aria-label="Interactive conversation"
              />
              <span>Interactive conversation</span>
            </label>
            <div className="text-[11px] text-muted-foreground mt-1">Allow interrupting while AI is speaking</div>
          </div>
          {/* Manual TTS input */}
          {onSpeak && (
            <div className="px-4 pb-2">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  aria-label="Text to speak"
                  placeholder="Type text to speak…"
                  value={manualText}
                  onChange={(e) => setManualText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && canSpeak) {
                      onSpeak(manualText.trim());
                      setManualText("");
                    }
                  }}
                  className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 flex h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50"
                />
                <Button
                  type="button"
                  onClick={() => {
                    if (!canSpeak) return;
                    onSpeak(manualText.trim());
                    setManualText("");
                  }}
                  disabled={!canSpeak}
                  className="shrink-0"
                >
                  Speak
                </Button>
              </div>
            </div>
          )}
          {hud && (
            <div className="px-4 pb-2">
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">HUD</span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-foreground/80">{hud.state}</span>
              </div>
              <div className="space-y-2">
                <div>
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>mic</span>
                    <span>{(hud.mic * 100).toFixed(1)}%</span>
                  </div>
                  <div className="h-2 w-full rounded bg-muted">
                    <div
                      className="h-2 rounded bg-primary"
                      style={{
                        width: `${Math.max(0, Math.min(100, hud.mic * 100)).toFixed(1)}%`,
                        minWidth: hud.mic > 0 ? 2 : undefined,
                      }}
                    />
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>tts</span>
                    <span>{(hud.tts * 100).toFixed(1)}%</span>
                  </div>
                  <div className="h-2 w-full rounded bg-muted">
                    <div
                      className="h-2 rounded bg-emerald-500"
                      style={{
                        width: `${Math.max(0, Math.min(100, hud.tts * 100)).toFixed(1)}%`,
                        minWidth: hud.tts > 0 ? 2 : undefined,
                      }}
                    />
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>effective</span>
                    <span>{(hud.eff * 100).toFixed(1)}%</span>
                  </div>
                  <div className="h-2 w-full rounded bg-muted">
                    <div
                      className="h-2 rounded bg-blue-500"
                      style={{
                        width: `${Math.max(0, Math.min(100, hud.eff * 100)).toFixed(1)}%`,
                        minWidth: hud.eff > 0 ? 2 : undefined,
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
          <div className="p-4 pt-0">
            <Textarea
              ref={textareaRef}
              readOnly
              value={logs.join("\n")}
              placeholder="Logs will appear here…"
              className="h-[36dvh] font-mono text-xs"
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
});

export default ConsolePanel;


