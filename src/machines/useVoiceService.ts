import { useEffect, useMemo, useRef, useState } from "react";
import { createActor, type ActorRef, type SnapshotFrom, type EventFromLogic } from "xstate";
import { createVoiceMachine, type VoiceContext, type VoiceEvents } from "@/machines/voiceMachine";

export type ControlState = "ready" | "listening_idle" | "capturing" | "processing" | "playing" | "error";
export type VadState = "off" | "on";

export interface VoiceSnapshot {
  value: { control: ControlState; vad: VadState };
  context: VoiceContext;
}

export function useVoiceService(deps: Parameters<typeof createVoiceMachine>[0]) {
  const machine = useMemo(() => createVoiceMachine(deps), [deps]);
  type Snap = SnapshotFrom<typeof machine>;
  type Ev = EventFromLogic<typeof machine>;
  const actorRef = useRef<ActorRef<Snap, Ev> | null>(null);
  const initialContext = (machine.config as any).context as VoiceContext;
  const [snapshot, setSnapshot] = useState<VoiceSnapshot>({ value: { control: "ready", vad: "off" }, context: initialContext });

  useEffect(() => {
    const actor = createActor(machine);
    actorRef.current = actor as unknown as ActorRef<Snap, Ev>;
    const sub = actor.subscribe((state) => {
      setSnapshot({ value: state.value as { control: ControlState; vad: VadState }, context: state.context as VoiceContext });
    });
    actor.start();
    return () => {
      sub.unsubscribe();
      actor.stop();
      actorRef.current = null;
    };
  }, [machine]);

  const send = (event: VoiceEvents) => {
    const a = actorRef.current;
    if (a) a.send(event);
  };

  return [snapshot, send] as const;
}


