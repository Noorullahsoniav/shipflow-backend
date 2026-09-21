// Netlify Function wrapper: runs the Express app via serverless-http.
// netlify.toml rewrites /api/* -> /.netlify/functions/api/* (status 200);
// we map the path back to /api/* so the Express routes match.
// The app is built once per warm function instance and reused.
import serverless from "serverless-http";
import { createApp } from "../../server.js";

const FUNCTION_PREFIX = "/.netlify/functions/api";

let handlerPromise: Promise<any> | null = null;

function getHandler(): Promise<any> {
  if (!handlerPromise) {
    // Tell server.ts it is running inside a serverless function (skip static
    // frontend serving + app.listen()). server.ts reads this at call time.
    process.env.SERVERLESS = "1";
    handlerPromise = createApp().then((app) => serverless(app));
  }
  return handlerPromise;
}

export const handler = async (event: any, context: any) => {
  // Netlify functions receive API Gateway payload v2.0 (rawPath) or v1 (path).
  // Map the function's own prefix back to /api/* so Express routes match.
  const incoming =
    typeof event.rawPath === "string"
      ? event.rawPath
      : typeof event.path === "string"
        ? event.path
        : "/";
  let path = incoming;
  if (path.startsWith(FUNCTION_PREFIX)) {
    const rest = path.slice(FUNCTION_PREFIX.length);
    path = "/api" + (rest.startsWith("/") ? rest : "/" + rest);
  }
  const handler = await getHandler();
  return handler({ ...event, path, rawPath: path }, context);
};
