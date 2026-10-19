/**
 * Resolve optional upstream packages for the real-upstream suites.
 *
 * These suites exercise the installed DSH packages instead of a fake, which is
 * the point of having them; they still start no server and touch no
 * `$DSH_HOME`. A checkout without a linked installation skips them, so the
 * rest of the suite stays runnable with nothing but Node.
 * @param {string} specifier - bare package specifier to import.
 * @returns the module namespace, or `undefined` when it is not installed.
 */
export async function optionalImport(specifier) {
  try {
    return await import(specifier);
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND' || error?.code === 'ERR_UNSUPPORTED_DIR_IMPORT') return undefined;
    throw error;
  }
}

/**
 * Message shown when a real-upstream suite is skipped.
 * @param {string} specifier - package that could not be imported.
 * @returns the skip reason.
 */
export function missingReason(specifier) {
  return `${specifier} is not resolvable here; link the installed DSH packages into this package (see test/README.md) to run the real-upstream suites`;
}
