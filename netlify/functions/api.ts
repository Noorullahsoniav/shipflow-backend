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
    handlerPromise = createApp().then((app) => serverless(app));
  }
  return handlerPromise;
}

export const handler = async (event: any, context: any) => {
  let path = typeof event.path === "string" ? event.path : "/";
  if (path.startsWith(FUNCTION_PREFIX)) {
    const rest = path.slice(FUNCTION_PREFIX.length);
    path = "/api" + (rest.startsWith("/") ? rest : "/" + rest);
  }
  const handler = await getHandler();
  return handler({ ...event, path }, context);
};
