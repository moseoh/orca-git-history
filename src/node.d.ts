// The few Node built-ins the worker uses. The worker runs in Orca's Node plugin host, so these
// resolve at runtime; this file only types them, so the plugin needs no @types/node.
declare module 'node:child_process' {
  export type ExecFileOptions = {
    cwd?: string
    env?: Record<string, string | undefined>
    maxBuffer?: number
    timeout?: number
    encoding?: 'utf8'
  }
  export type ExecFileError = Error & { code?: number | string; stderr?: string }
  export function execFile(
    file: string,
    args: readonly string[],
    options: ExecFileOptions,
    callback: (error: ExecFileError | null, stdout: string, stderr: string) => void
  ): unknown
}

declare module 'node:fs' {
  export function mkdirSync(path: string): void
  export function mkdtempSync(prefix: string): string
  export function writeFileSync(path: string, data: string): void
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void
}

declare module 'node:os' {
  export function tmpdir(): string
}

declare module 'node:path' {
  export function join(...parts: string[]): string
}

declare const process: { env: Record<string, string | undefined> }
