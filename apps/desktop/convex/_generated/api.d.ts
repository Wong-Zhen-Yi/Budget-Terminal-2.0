/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as authCore from "../authCore.js";
import type * as authMaintenance from "../authMaintenance.js";
import type * as crons from "../crons.js";
import type * as githubAdapter from "../githubAdapter.js";
import type * as http from "../http.js";
import type * as legacyAuthTables from "../legacyAuthTables.js";
import type * as sync from "../sync.js";
import type * as syncLimits from "../syncLimits.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  authCore: typeof authCore;
  authMaintenance: typeof authMaintenance;
  crons: typeof crons;
  githubAdapter: typeof githubAdapter;
  http: typeof http;
  legacyAuthTables: typeof legacyAuthTables;
  sync: typeof sync;
  syncLimits: typeof syncLimits;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  auth: import("@convex-dev/auth/_generated/component.js").ComponentApi<"auth">;
  authGithub: import("@convex-dev/auth/components/github/_generated/component.js").ComponentApi<"authGithub">;
};
