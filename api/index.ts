// Vercel serverless entry point: wraps the Express app via serverless-http.
// Vercel sets process.env.VERCEL=1, so server.ts exports createApp() without
// calling app.listen() — the app is built once per warm function instance.
import serverless from "serverless-http";
import { createApp } from "../server.js";

let handler: any = null;

export default async function (req: any, res: any) {
  if (!handler) {
    const app = await createApp();
    handler = serverless(app);
  }
  return handler(req, res);
}
