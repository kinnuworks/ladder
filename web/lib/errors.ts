import type { ErrorReason } from "./x402";

/** A refusal with an HTTP status, safe to show to the caller. */
export class RelayError extends Error {
  constructor(
    message: string,
    public status: number,
    public reason?: ErrorReason,
  ) {
    super(message);
  }
}
