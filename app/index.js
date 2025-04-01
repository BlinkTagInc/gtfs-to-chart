import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import logger from 'morgan';
import slashes from 'connect-slashes';

import routes from './routes.js';

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// View engine setup
app.set('views', path.join(__dirname, './views'));
app.set('view engine', 'pug');

// Middleware
app.use(logger('dev'));
app.use(express.static(path.join(__dirname, '../public')));
app.use(slashes());

// Routes
app.use('/', routes);

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
