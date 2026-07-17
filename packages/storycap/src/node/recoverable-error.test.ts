import { describe, expect, it } from '@jest/globals';
import { isRecoverableNavigationContextError } from './recoverable-error';

describe(isRecoverableNavigationContextError, () => {
  it('matches execution context destroyed errors', () => {
    expect(isRecoverableNavigationContextError(new Error('Execution context was destroyed, most likely because of a navigation.'))).toBe(true);
  });

  it('matches context id lookup failures', () => {
    expect(isRecoverableNavigationContextError(new Error('Protocol error (Runtime.callFunctionOn): Cannot find context with specified id'))).toBe(true);
  });

  it('ignores unrelated errors', () => {
    expect(isRecoverableNavigationContextError(new Error('No element found for selector: .foo'))).toBe(false);
    expect(isRecoverableNavigationContextError('Execution context was destroyed')).toBe(false);
  });
});
