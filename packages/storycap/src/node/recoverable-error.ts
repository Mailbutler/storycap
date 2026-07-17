export function isRecoverableNavigationContextError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes('Execution context was destroyed') ||
    error.message.includes('Cannot find context with specified id')
  );
}
