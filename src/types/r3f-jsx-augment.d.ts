import type { ThreeElements } from "@react-three/fiber";

declare global {
  namespace JSX {
    // Merge react-three-fiber's element map into JSX.IntrinsicElements
    // This preserves strong types and avoids 'any'.
    interface IntrinsicElements extends ThreeElements {}
  }
}

export {};


