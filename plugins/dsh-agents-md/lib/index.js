/**
 * dsh-agents-md — Host half.
 *
 * The plugin owns three exact Web routes under `/agents-md/`; the browser half
 * is a settings page that calls them. The routes only exist where a Web server
 * does, which is why `webServer` is a hard dependency.
 *
 * `workspaceRegistry` and `connection` are looked up lazily at request time:
 * they exist in the Web profile, but a lazy lookup keeps the route registration
 * independent of activation order.
 *
 * @module dsh-agents-md
 */
import { createHandler, ROUTE_FILE, ROUTE_SAVE, ROUTE_STATE } from './handler.js';
import { resolveHomes } from './paths.js';

/** Stable Cordis plugin name. */
export const name = 'agents-md';

/** The entry serves the Web settings page, so it waits for the Web server. */
export const inject = ['webServer'];

/**
 * Register the three endpoints used by the settings page.
 * @param ctx - plugin context carrying `webServer`.
 */
export function apply(ctx) {
  const homes = resolveHomes(process.env);
  const handler = createHandler({
    homes,
    registry: () => ctx.get('workspaceRegistry', false),
    connection: () => ctx.get('connection', false),
    logger: ctx.logger,
  });
  for (const route of [ROUTE_STATE, ROUTE_FILE, ROUTE_SAVE]) {
    ctx.effect(
      () => ctx.webServer.register({ kind: 'exact', path: route, handler }),
      `${name}: ${route}`,
    );
  }
}
