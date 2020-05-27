import io from 'socket.io-client';
import axios from 'axios';
import yargs from 'yargs';
import winston from 'winston';
import moment from 'moment';
import micromatch from 'micromatch';
import { v4 as uuidV4 } from 'uuid';
require('dotenv').config();

import { ForwardEvent, ForwardResponse } from './event';

const glogger = winston.createLogger({
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [new winston.transports.Console()],
});

const argv = yargs
  .option('dump-response', {
    default: false,
    type: 'boolean',
  })
  .option('dump-request', {
    default: false,
    type: 'boolean',
  })
  .option('endpoint', {
    default: 'http://localhost:7000',
    type: 'string',
    requiresArg: true,
  })
  .option('pattern', {
    array: true,
    type: 'string',
    requiresArg: true,
  })
  .option('target', {
    default: 'http://localhost:3010',
    array: true,
    type: 'string',
    requiresArg: true,
  })
  .option('bearer', {
    default: process.env.BEARER_TOKEN,
    type: 'string',
    requiresArg: true,
  })
  .parse();

if (argv.target?.length == 1 && (!argv.pattern || argv.pattern.length == 0)) {
  argv.pattern = ['**'];
}

if (!argv.pattern || argv.target.length != argv.pattern.length) {
  throw new Error(`number of pattern(${argv.pattern?.length}) and target(${argv.target.length}) does not match`);
}

async function getIDToken(): Promise<string | undefined> {
  if (argv.bearer) {
    return argv.bearer;
  } else if (process.env.REFRESH_TOKEN) {
    glogger.info(`retrieve id_token using refresh_token: ${process.env.REFRESH_TOKEN}`);
    const resp = await axios.post('https://www.googleapis.com/oauth2/v4/token', {
      client_id: process.env.CLIENT_ID!,
      client_secret: process.env.CLIENT_SECRET!,
      refresh_token: process.env.REFRESH_TOKEN,
      grant_type: 'refresh_token',
      audience: process.env.IAP_CLIENT_ID!,
    });
    return resp.data.id_token;
  }
  return;
}

function chooseTarget(url: string): string | undefined {
  const i = argv.pattern!.findIndex((e) => {
    return micromatch.isMatch(url, e);
  });

  if (i < 0) {
    return undefined;
  }

  return argv.target[i];
}

async function run() {
  const extraHeaders: any = {};
  const bearer = await getIDToken();
  if (bearer) {
    glogger.info(`bearer: ${bearer}`);
    extraHeaders.Authorization = `Bearer ${bearer}`;
  }

  const clientID = uuidV4();
  const sock = io.connect(argv.endpoint, {
    forceNew: true,
    // @ts-ignore
    extraHeaders: extraHeaders,
  });

  sock
    .on('connect_timeout', (mes: any) => {
      const logger = glogger.child({ sockID: sock.id });
      logger.error(`connect_timeout: id=${sock.id}`, { event: mes });
    })
    .on('connect_error', (mes: any) => {
      const logger = glogger.child({ sockID: sock.id });
      logger.error(`connect_error: id=${sock.id}`, { event: mes });
    })
    .on('error', (mes: any) => {
      const logger = glogger.child({ sockID: sock.id });
      logger.error(`error: id=${sock.id}`, { event: mes });
    })
    .on('disconnect', (mes: any) => {
      const logger = glogger.child({ sockID: sock.id });
      logger.error(`disconnect: id=${sock.id}`, { event: mes });
    })
    .on('connect', () => {
      const logger = glogger.child({ sockID: sock.id });
      logger.info(`connected: id=${sock.id}, ${argv.endpoint}`);
    })
    .on('initRequest', (mes: any) => {
      const logger = glogger.child({ sockID: sock.id });
      logger.info(`initRequest: id=${sock.id}`, { event: mes });
      sock.emit('initResponse', {
        clientID: clientID,
      });
    })
    .on('forwardRequest', (mes: ForwardEvent) => {
      const logger = glogger.child({ reqID: mes.forwardID, sockID: sock.id });
      //logger.info("forwardRequest:", {event: mes});

      const reqBody = mes.request.body ? Buffer.from(mes.request.body, 'base64') : undefined;

      const baseURL = chooseTarget(mes.request.url);
      if (!baseURL) {
        logger.error(`no pattern matched: ${mes.request.url}`);
        const forwardRes: ForwardResponse = {
          forwardID: mes.forwardID,
          response: {
            header: {},
            statusText: 'Bad Gateway',
            statusCode: 504,
          },
        };
        sock.emit(mes.forwardID, forwardRes);
        return;
      }
      const targetURL = new URL(mes.request.url, baseURL);

      const meta: any = {};
      if (argv['dump-request']) {
        meta.request = mes;
      }

      logger.info(`${mes.request.method} ${targetURL}`, meta);
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
          if (argv['dump-response']) {
            meta.response = { headers: res.headers };
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
          logger.error(`axios: ${err}`, { error: err });

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
}

run().catch((err) => {
  throw err;
});
