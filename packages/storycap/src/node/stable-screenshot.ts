/**
 *
 * Checks whether the last `count` buffers exist and are byte-identical.
 *
 **/
export function areLastBuffersEqual(buffers: Buffer[], count: number) {
  if (count < 2 || buffers.length < count) return false;
  const last = buffers.slice(-count);
  return last.every(buffer => buffer.equals(last[0]));
}
