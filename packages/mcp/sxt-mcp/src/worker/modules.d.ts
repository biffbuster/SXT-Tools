declare module "cloudflare:node" {
  export function httpServerHandler(options: { port: number }): ExportedHandler;
  type ExportedHandler = { fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> };
}
declare module "*.md" {
  const text: string;
  export default text;
}
