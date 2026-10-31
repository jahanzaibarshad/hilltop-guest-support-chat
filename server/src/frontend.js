import express from 'express';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const frontendDirectory = fileURLToPath(new URL('../../client/dist/', import.meta.url));

export function serveFrontend(app, directory = frontendDirectory) {
  if (!existsSync(join(directory, 'index.html')))
    throw new Error('Frontend build missing. Run npm run build from the project root.');
  // Only the compiled public bundle is exposed; never serve the repository root.
  app.use(express.static(directory, { dotfiles: 'ignore', redirect: false, maxAge: 0 }));
}
