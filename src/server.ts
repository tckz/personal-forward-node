require('dotenv').config();
const tracer = require('@google-cloud/trace-agent').start({
  samplingRate: 0,
});
import { serializeTraceContext } from '@google-cloud/trace-agent/build/src/util';
import express from 'express';
import socketio from 'socket.io';
import http from 'http';
import yargs from 'yargs';
import bodyParser from 'body-parser';
import { v4 as uuidV4 } from 'uuid';
import winston from 'winston';
import moment from 'moment';
import { default as oauth2, OAuth2Client } from 'google-auth-library';
import * as authorization from 'auth-header';

import { ForwardEvent, ForwardResponse } from './event';

const app = express();
const server = http.createServer(app);
const io = socketio(server);
const PORT = process.env.PORT || 7000;

const channels: NodeJS.Dict<socketio.Socket> = {};

const glogger = winston.createLogger({
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [new winston.transports.Console()],
});

const argv = yargs
  .option('timeout-sec', {
    default: 120,
    type: 'number',
  })
  .parse();

const newIDTokenVerifier = (clientID: string) => (token: string): Promise<oauth2.LoginTicket> => {
  const client = new OAuth2Client(clientID);

  return client.verifyIdToken({
    idToken: token,
    audience: clientID,
  });
};

app.use(
  bodyParser.raw({
    type: '*/*',
    inflate: false,
    limit: '10mb',
  })
);

app.all(/^\/.*$/, async (req, res) => {
  const from = moment();

  const traceID = tracer.getCurrentContextId();
  const reqID = uuidV4();

  let tid: string | undefined;
  if (traceID) {
    tid = `projects/${process.env.GOOGLE_CLOUD_PROJECT}/traces/${traceID}`;
  }

  const logger = glogger.child({ reqID, 'logging.googleapis.com/trace': tid });

  const sock = channels['default'];
  if (!sock) {
    logger.info('not exist');
    res.sendStatus(502);
    return;
  }

  const body = req.body.length ? Buffer.from(req.body).toString('base64') : undefined;

  const ev: ForwardEvent = {
    forwardID: reqID,
    created: new Date(),
    traceID: serializeTraceContext(tracer.getCurrentRootSpan().getTraceContext()).toString('base64'),
    request: {
      header: {},
      method: req.method,
      url: req.originalUrl,
      body: body,
    },
  };
  const h = ev.request.header;
  for (const [k, v] of Object.entries(req.headers)) {
    h[k] = v;
  }

  const p = new Promise((resolve, reject) => {
    const tid = setTimeout(() => {
      clearTimeout(tid);
      reject('timeout');
    }, 1000 * argv['timeout-sec']);

    sock
      .on(ev.forwardID, (mes: ForwardResponse) => {
        const body = mes.response.body;
        // omit body for logging.
        delete mes.response.body;
        logger.info(`response: id=${mes.forwardID}`, { event: mes });

        for (const [k, v] of Object.entries(mes.response.header)) {
          res.set(k, v);
        }
        res.status(mes.response.statusCode);
        res.statusMessage = mes.response.statusText;

        if (body) {
          res.send(Buffer.from(body, 'base64'));
        }
        res.end();

        clearTimeout(tid);
        resolve(res);
      })
      .on('error', (err) => {
        clearTimeout(tid);
        reject(err);
      });
  });

  sock.emit('forwardRequest', ev);

  p.catch((err) => {
    logger.error('error occurred in waiting response', { error: err });
  }).then(() => {
    sock.off(ev.forwardID, () => {});
  });

  await p;
  const dur = moment.duration(moment().diff(from));
  logger.info(`done: ${req.url}, status=${res.statusCode}, dur=${dur.as('seconds')}sec`);
});

io.use(async (socket, next) => {
  const logger = glogger.child({ sockID: socket.id });

  // @ts-ignore
  const authorized = !!socket.authorized;

  const iapClientID = process.env.IAP_CLIENT_ID;
  if (authorized || !iapClientID || socket.handshake.headers['x-goog-iap-jwt-assertion']) {
    return next();
  }

  logger.info('authenticate client', { headers: socket.handshake.headers });
  const authz = socket.handshake.headers.authorization;
  if (!authz) {
    return next(new Error('Authorization header required'));
  }
  const res = authorization.parse(authz);
  if (res.scheme != 'Bearer') {
    return next(new Error('Authorization Bearer required'));
  }
  if (!res.token || typeof res.token != 'string') {
    return next(new Error('Authorization Bearer token required'));
  }

  const ticket = await newIDTokenVerifier(iapClientID)(res.token);
  logger.info(`id_token verified, email=${ticket.getPayload()?.email}`, { ticket: ticket });

  // @ts-ignore
  socket.authorized = true;

  return next();
});

io.on('connection', (sock: socketio.Socket) => {
  const logger = glogger.child({ sockID: sock.id });
  logger.info(`connection: id=${sock.id}`);
  tracer.wrapEmitter(sock);
  sock
    .on('initResponse', (msg) => {
      logger.info(`initResponse: id=${sock.id}`, { event: msg });
      const prev = channels['default'];
      if (prev) {
        prev.disconnect();
      }
      channels['default'] = sock;
    })
    .on('disconnect', () => {
      logger.info(`disconnect: id=${sock.id}`);
      for (const [k, v] of Object.entries(channels)) {
        if (sock.id == v?.id) {
          delete channels[k];
          break;
        }
      }
    })
    .emit('initRequest', {});
});

glogger.info('startup', { env: process.env });

server.listen(PORT, () => {
  glogger.info(`Port: ${PORT}`);
});
