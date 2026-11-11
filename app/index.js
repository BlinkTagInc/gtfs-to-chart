import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import slashes from 'connect-slashes';

import { readFileSync } from 'node:fs';
import { createRouter } from './routes.js';
import { createGtfs } from '../lib/gtfs.js';
import { setDefaultConfig } from '../lib/utils.js';

const config = setDefaultConfig(
  JSON.parse(readFileSync(new URL('../config.json', import.meta.url))),
);
Object.assign(config, {
  skipImport: true,
  noHead: false,
  assetPath: '/',
  isLocal: true,
});
const gtfs = createGtfs(config);
try {
  const inspection = await gtfs.schema.validate();
  if (!inspection.compatible) {
    throw new Error(
      'Incompatible or missing v5 database schema; import the original feeds into a fresh database first',
    );
  }
  // Fail at startup if the database has not been imported.
  for (const agency of config.agencies) {
    const rows = await gtfs.schedule.agency
      .where({ source_id: agency.sourceId })
      .all();
    if (rows.length === 0) {
      throw new Error(`No imported data for ${agency.sourceId}`);
    }
  }
} catch (error) {
  await gtfs.close();
  throw error;
}

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// View engine setup
app.set('views', path.join(__dirname, './views'));
app.set('view engine', 'pug');

// Logging middleware
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// Middleware
app.use(express.static(path.join(__dirname, '../public')));
app.use(slashes());

// Routes
app.use('/', createRouter(gtfs, config));

// Error handlers
app.use((request, response) => {
  const error = {
    message: 'Not Found',
    status: 404,
  };
  response.status(404);
  if (request.xhr) {
    response.json({
      message: error.message,
      error,
    });
  } else {
    response.render('error', {
      message: error.message,
      error,
    });
  }
});

// Development error handler: will print stacktrace
if (process.env.NODE_ENV === 'development') {
  app.use((error, request, response, next) => {
    response.status(error.status || 500);
    response.render('error', {
      message: error.message,
      error,
    });
  });
}

// Production error handler: no stacktraces leaked to user
app.use((error, request, response, next) => {
  response.status(error.status || 500);
  response.render('error', {
    message: error.message,
    error: {},
  });
});

const port = process.env.PORT || 3000;
app.set('port', port);

const server = app.listen(port, () => {
  console.log(`Express server listening on port ${server.address().port}`);
});

server.on('error', async (error) => {
  await gtfs.close();
  console.error(error);
  process.exitCode = 1;
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    server.close(async () => {
      await gtfs.close();
    });
  });
}
