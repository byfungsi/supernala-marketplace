/** A missing OpenAPI operationId uses a method/path identity without altering upstream source bytes. */
export function pluginOpenApiOperationIdentity(
  method: string,
  path: string,
  operationId: unknown,
): string | null {
  if (operationId === undefined) return `http:${method.toUpperCase()}:${path}`;
  return typeof operationId === "string" && operationId.length > 0 ? operationId : null;
}
