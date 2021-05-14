import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import logger from 'morgan';
import slashes from 'connect-slashes';

import routes from './routes.js';

const app = express();

// View engine setup
app.set('views', path.join(fileURLToPath(import.meta.url), '../views'));
app.set('view engine', 'pug');

app.use(logger('dev'));
app.use(express.static(path.join(fileURLToPath(import.meta.url), '../../public')));
app.use(slashes());

app.use('/', routes);

// Error handlers

// 404 error handler
app.use((request, response) => {
  const error = {
    message: 'Not Found',
    status: 404
  };
  response.status(404);
  if (request.xhr) {
    response.send({
      message: error.message,
      error
    });
  } else {
    response.render('error', {
      message: error.message,
      error
    });
  }
});

// Development error handler: will print stacktrace
if (process.env.NODE_ENV === 'development') {
  app.use((error, request, response) => {
    response.status(error.status || 500);
    response.render('error', {
      message: error.message,
      error
    });
  });
}

// Production error handler: no stacktraces leaked to user
app.use((error, request, response) => {
  response.status(error.status || 500);
  response.render('error', {
    message: error.message,
    error: {}
  });
});

app.set('port', process.env.PORT || 3000);

const server = app.listen(app.get('port'), () => {
  console.log(`Express server listening on port ${server.address().port}`);
});
