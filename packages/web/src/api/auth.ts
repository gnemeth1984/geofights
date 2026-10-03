import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins";
import { expo } from "@better-auth/expo";
import { db } from "./database";
import { normalizeSiteUrl } from "./lib/site-url";

export const auth = betterAuth({
  basePath: "/api/auth",
  baseURL: normalizeSiteUrl(process.env.WEBSITE_URL),
  database: drizzleAdapter(db, { provider: "sqlite" }),
  emailAndPassword: { enabled: true, autoSignIn: true },
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: (request) => {
    const origin = request?.headers.get("origin");
    return origin ? [origin] : ["*"];
  },
  plugins: [bearer(), expo()],
});
