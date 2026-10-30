/** JSON content returned privately to the authorized caller, never logged. */
export type SlackJson =
  | null
  | boolean
  | number
  | string
  | SlackJson[]
  | { [key: string]: SlackJson };

/** Safe Slack failure categories; provider error bodies never cross this interface. */
export type SlackApiFailure = {
  readonly _tag: "Failure";
  readonly reason: string;
  readonly dispatch?: "not-dispatched" | "read-only" | "unknown" | "response-received";
  readonly httpStatus?: number;
  readonly retryAfterSeconds?: number;
};

/** Build the fixed Slack tool adapter; expected failures are values and writes are never retried. */
export function createSlackApiToolHandler(input: {
  readonly accessToken?: string | undefined;
  readonly fetch?: typeof globalThis.fetch;
}): (
  name: string,
  args: unknown,
) => Promise<
  | { readonly _tag: "Success"; readonly value: { readonly [key: string]: SlackJson } }
  | SlackApiFailure
>;
