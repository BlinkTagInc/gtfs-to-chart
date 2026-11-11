import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

/** Serve generated files on localhost; no database or runtime templates required. */
export async function serve(directory: string, port: number) {
  const root = await realpath(directory);
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(
        new URL(request.url ?? '/', 'http://localhost').pathname,
      );
      let filename = path.resolve(root, `.${pathname}`);
      if ((await stat(filename)).isDirectory()) {
        if (!pathname.endsWith('/')) {
          response
            .writeHead(301, {
              Location: `${new URL(request.url ?? '/', 'http://localhost').pathname}/`,
            })
            .end();
          return;
        }
        filename = path.join(filename, 'index.html');
      }
      filename = await realpath(filename);
      const relative = path.relative(root, filename);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        response.writeHead(403).end('Forbidden');
        return;
      }
      const content = await readFile(filename);
      const types: Record<string, string> = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
      };
      response.writeHead(200, {
        'Content-Type':
          types[path.extname(filename)] ?? 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(content);
    } catch {
      response.writeHead(404).end('Not found');
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return server;
}
