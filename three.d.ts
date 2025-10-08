import { ThreeElements } from '@react-three/fiber'

declare global {
  namespace React {
    namespace JSX {
        interface IntrinsicElements extends ThreeElements {
        }
    }
  }
}

// Ambient shims for optional AI SDK usage to avoid type resolution errors when building
declare module "ai" {
  export function streamText(args: unknown): Promise<{ textStream: AsyncIterable<string> }>;
  export function generateText(args: unknown): Promise<{ text: string }>;
}
declare module "@ai-sdk/openai" {
  export function createOpenAI(args: unknown): (model: string) => unknown;
}