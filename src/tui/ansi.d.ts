declare module 'slice-ansi' {
  export default function sliceAnsi(input: string, beginSlice: number, endSlice?: number): string;
}

declare module 'wrap-ansi' {
  export interface WrapAnsiOptions {
    hard?: boolean;
    trim?: boolean;
    wordWrap?: boolean;
  }
  export default function wrapAnsi(input: string, columns: number, options?: WrapAnsiOptions): string;
}
