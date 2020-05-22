import io from 'socket.io-client';
import axios from 'axios';
import yargs from 'yargs';
import winston from 'winston';
import moment from 'moment';
import { v4 as uuidV4 } from 'uuid';

import { ForwardEvent, ForwardResponse } from './event';

const glogger = winston.createLogger({
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [new winston.transports.Console()],
});

const argv = yargs
  .option('dump-response', {
    default: false,
    type: "boolean",
  })
  .option('endpoint', {
    default: 'http://localhost:7000',
    type: 'string',
  })
  .option('target', {
    default: 'http://localhost:3010',
    type: 'string',
  })
  .option('bearer', {
    default: process.env.BEARER_TOKEN,
    type: 'string',
  })
  .parse();

const extraHeaders: any = {};
if (argv.bearer) {
  extraHeaders.Authorization = `Bearer ${argv.bearer}`;
}

const channelID = uuidV4();
const sock = io.connect(argv.endpoint, {
  forceNew: true,
  // @ts-ignore
  extraHeaders: extraHeaders,
});

sock
  .on("connect_timeout", (mes: any) => {
    glogger.error("connect_timeout", { event: mes });
  })
  .on("connect_error", (mes: any) => {
    glogger.error("connect_error", { event: mes });
  })
  .on("error", (mes: any) => {
    glogger.error("error", { event: mes });
  })
  .on('connect', () => {
    glogger.info(`connected: ${argv.endpoint}`);
  })
  .on('initRequest', (mes: any) => {
    glogger.info('initRequest:', {event: mes});
    sock.emit('initResponse', {
      ch: channelID,
    });
  })
  .on('forwardRequest', (mes: ForwardEvent) => {
    const logger = glogger.child({reqID: mes.forwardID});
    logger.info("forwardRequest:", {event: mes});

    const reqBody = mes.request.body ? Buffer.from(mes.request.body, 'base64') : undefined;

    const baseURL = argv.target;
    const targetURL = new URL(mes.request.url, baseURL);

    logger.info(`${mes.request.method} ${targetURL}`);
    const from = moment();
    axios(targetURL.toString(), {
      headers: mes.request.header,
      // @ts-ignore
      method: mes.request.method,
      responseType: 'arraybuffer',
      data: reqBody,
      validateStatus: (status) => {
        // any status should be proxied.
        return true;
      },
    })
      .then((res) => {
        const meta: any = {};
        if (argv["dump-response"]) {
          meta.response = {headers: res.headers};
        }
        const dur = moment.duration(moment().diff(from));
        logger.info(`${mes.request.method} ${targetURL}, status=${res.status}, dur=${dur.as('seconds')}sec`, meta);

        const resBody = res.data.length ? Buffer.from(res.data).toString('base64') : undefined;
        const forwardRes: ForwardResponse = {
          forwardID: mes.forwardID,
          response: {
            header: {},
            body: resBody,
            statusText: res.statusText,
            statusCode: res.status,
          },
        };
        const h = forwardRes.response.header;
        for (const [k, v] of Object.entries(res.headers)) {
          // @ts-ignore
          h[k] = v;
        }

        sock.emit(mes.forwardID, forwardRes);
      })
      .catch((err) => {
        logger.error("axios: ", {error : err});

        const forwardRes: ForwardResponse = {
          forwardID: mes.forwardID,
          response: {
            header: {},
            statusText: 'Internal Server Error',
            statusCode: 500,
          },
        };
        sock.emit(mes.forwardID, forwardRes);
      });
  });
