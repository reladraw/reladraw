/** A problem in the source, reported in the vocabulary of the source. */
export class SourceError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(message);
    this.name = 'SourceError';
  }

  /** `12: two placements for "server"` — the form the command-line tool prints. */
  format(file?: string): string {
    const where = file ? `${file}:${this.line}` : `line ${this.line}`;
    return `${where}: ${this.message}`;
  }
}
