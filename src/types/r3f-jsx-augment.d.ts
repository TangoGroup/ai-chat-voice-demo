import type { ThreeElements } from "@react-three/fiber";

declare global {
  namespace JSX {
    // Merge react-three-fiber's element map into JSX.IntrinsicElements
    // This preserves strong types and avoids 'any'.
    interface IntrinsicElements extends ThreeElements {
      // Redeclare at least one known element to avoid empty-interface lint error
      group: ThreeElements['group'];
    }
  }
}

export {};


