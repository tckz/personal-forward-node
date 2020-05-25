import express from 'express';
import socketio from 'socket.io';
import http from 'http';
import yargs from 'yargs';
import bodyParser from 'body-parser';
import { v4 as uuidV4 } from 'uuid';
import winston from 'winston';
import moment from 'moment';

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
    type: "number",
  })
  .parse();

app.use(
  bodyParser.raw({
    type: '*/*',
    inflate: false,
    limit: '10mb',
  })
);

app.all(/^\/.*$/, async (req, res) => {
  const from = moment();
  const reqID = uuidV4();

  const logger = glogger.child({reqID: reqID});

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
    }, 1000 * argv["timeout-sec"]);

    sock
      .on(ev.forwardID, (mes: ForwardResponse) => {
        logger.info(`response: id=${mes.forwardID}`, { event: mes });

        for (const [k, v] of Object.entries(mes.response.header)) {
          res.set(k, v);
        }
        res.status(mes.response.statusCode);
        res.statusMessage = mes.response.statusText;

        if (mes.response.body) {
          res.send(Buffer.from(mes.response.body, 'base64'));
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
    logger.error("error occurred in waiting response", {error: err});
  }).then(() => {
    sock.off(ev.forwardID, () => {});
  });

  await p;
  const dur = moment.duration(moment().diff(from));
  logger.info(`done: ${req.url}, status=${res.status}, dur=${dur.as('seconds')}sec`);
});

io.on('connection', (sock: socketio.Socket) => {
  const logger = glogger.child({sockID: sock.id})
  logger.info(`connection: id=${sock.id}`, {headers: sock.handshake.headers});
  sock
    .on('initResponse', (msg) => {
      logger.info(`initResponse: id=${sock.id}`, { event: msg });
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

server.listen(PORT, () => {
  glogger.info(`Port: ${PORT}`);
});
