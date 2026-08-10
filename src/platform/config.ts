/** Hostnames this server is reached by. Adding one here updates both the
 *  backend CORS allowlist and Vite's allowedHosts. */
export const HOSTNAMES = ['localhost', 'samarkand.hopto.org', 'torment-nexus.local'] as const;

/** Ports this project owns. */
export const PORTS = {
  httpRedirect: 5172,
  vite: 5173,
  api: 5174,
} as const;

/** Ports owned by sibling projects on this machine, recorded so collisions are
 *  visible in one place. Not read at runtime.
 *
 *  KNOWN COLLISIONS: cult-game hardcodes 5174 (this project's api) and would
 *  default Vite to 5173; cosmic's frontend is configured for 5177, which is
 *  chitty's redirect port. Neither is running. Fixing those projects is out of
 *  scope here. */
export const NEIGHBOUR_PORTS = {
  chittyVite: 5175,
  chittyApi: 5176,
  chittyRedirect: 5177,
  roguelikeApi: 3001,
} as const;

/** Link targets for experiments that run as their own services. These are
 *  static: the gallery does no health checking, so a link is simply dead while
 *  its service is stopped. Both projects must be started on these ports for the
 *  links to resolve. */
export const EXTERNAL_URLS = {
  roguelike: 'https://samarkand.hopto.org:5178',
  cultGame: 'https://samarkand.hopto.org:5179',
} as const;

/** Origins accepted by the backend's CORS middleware. Generated across schemes
 *  and ports rather than hand-maintained. */
export function corsOrigins(): string[] {
  const origins: string[] = [];
  for (const host of HOSTNAMES) {
    for (const scheme of ['http', 'https']) {
      origins.push(`${scheme}://${host}`);
      origins.push(`${scheme}://${host}:${PORTS.vite}`);
      origins.push(`${scheme}://${host}:${PORTS.api}`);
    }
  }
  return origins;
}
