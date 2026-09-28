import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import type { AppRouterClient } from "../../api";
import { authHeaders } from "./session-token";

const link = new RPCLink({
  url: `${window.location.origin}/api/rpc`,
  // Cookies cover the same-origin, top-level case. The bearer token covers the
  // iframe / blocked-third-party-cookie case — see lib/session-token.ts.
  headers: () => authHeaders(),
});

/** Direct typed client: await client.ping() */
export const client: AppRouterClient = createORPCClient(link);

/** TanStack Query helpers: useQuery(orpc.ping.queryOptions()) */
export const orpc = createTanstackQueryUtils(client);
