export class CoreValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoreValidationError";
  }
}

export class UpstreamUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "UpstreamUnavailableError";
  }
}
