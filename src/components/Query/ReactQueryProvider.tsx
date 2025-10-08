"use client";

import { type PropsWithChildren, useRef } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export default function ReactQueryProvider({ children }: PropsWithChildren) {
  const clientRef = useRef<QueryClient | null>(null);
  if (!clientRef.current) clientRef.current = new QueryClient();
  return (
    <QueryClientProvider client={clientRef.current}>
      {children}
    </QueryClientProvider>
  );
}


