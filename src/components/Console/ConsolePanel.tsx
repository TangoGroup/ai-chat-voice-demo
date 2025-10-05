"use client";

import { forwardRef, useEffect } from "react";
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
}

const ConsolePanel = forwardRef<HTMLDivElement, ConsolePanelProps>(function ConsolePanel(
  { title = "Voice Chat Console", logs, canRecord, isRecording, onClear, textareaRef, hideOverlay = true },
  _ref
) {
  useEffect(() => {
    if (textareaRef?.current) {
      textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
    }
  }, [logs.length, textareaRef]);

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


