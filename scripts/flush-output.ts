type WriteOutput = (output: string, onFlushed: () => void) => unknown;
type ExitProcess = (code: number) => void;

export function flushOutputAndExit(
  output: string,
  exitCode = 0,
  write: WriteOutput = (value, onFlushed) => process.stdout.write(value, onFlushed),
  exit: ExitProcess = (code) => process.exit(code),
) {
  write(output, () => exit(exitCode));
}
