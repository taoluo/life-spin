/**
 * Ambient globals the vendored sources expect from their host.
 *
 * Upstream declares these in `client/client.ts` and `client/plugos/worker_runtime.ts`
 * — UI files we deliberately did not vendor, because we are not running their
 * client. Without the declarations their code does not type-check here, and
 * editing it is exactly what `vendor:check` exists to prevent. So the declarations
 * live at the seam, like every other adaptation.
 *
 * `client` stays optional: there is no SilverBullet client here, and every use in
 * the vendored code already guards for that with `?.`.
 */
declare global {
  function syscall(name: string, ...args: any[]): Promise<any>;
  // eslint-disable-next-line no-var
  var client: { config?: unknown } | undefined;
}

export {};
