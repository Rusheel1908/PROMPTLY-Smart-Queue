/** The one source of "now" for queue logic, so tests can move time forward instead of waiting. */
const realNow = () => Date.now();
let source = realNow;

export const now = () => source();

/** Tests only: replace the time source. Call with no argument to restore the real clock. */
export const setNow = (fn: () => number = realNow) => { source = fn; };
