import express from 'express';
import winston from 'winston';
import http from 'http';
import yargs from 'yargs';
import { v4 as uuidV4 } from 'uuid';
import axios from 'axios';
require('dotenv').config();
const { exec } = require('child_process');

const app = express();
const server = http.createServer(app);

const glogger = winston.createLogger({
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [new winston.transports.Console()],
});

const argv = yargs
  .option('port', {
    default: 13010,
    type: 'number',
  })
  .parse();

const redirectURI = `http://localhost:${argv.port}`;

const browseURL = new URL('https://accounts.google.com/o/oauth2/v2/auth');
browseURL.searchParams.set('client_id', process.env.CLIENT_ID!);
browseURL.searchParams.set('response_type', 'code');
browseURL.searchParams.set('scope', 'openid email');
browseURL.searchParams.set('access_type', 'offline');
browseURL.searchParams.set('redirect_uri', redirectURI);

const child = exec(`chrome '${browseURL.toString()}'`);

app.all(/^\/$/, async (req, res) => {
  const reqID = uuidV4();
  const logger = glogger.child({ reqID: reqID });

  const code = req.query.code;

  const resp = await axios.post('https://www.googleapis.com/oauth2/v4/token', {
    client_id: process.env.CLIENT_ID!,
    client_secret: process.env.CLIENT_SECRET!,
    code: code!.toString(),
    redirect_uri: redirectURI,
    grant_type: 'authorization_code',
  });

  logger.info('resp', { data: resp.data });
  res.send(`refresh_token: ${resp.data.refresh_token}`);

  process.kill(process.pid, 'SIGTERM');
});

server.listen(argv.port, () => {
  glogger.info(`Port: ${argv.port}`);
});

process.on('SIGTERM', () => {
  glogger.info('received: SIGTERM');
  server.close(() => {
    glogger.info('closed');
    process.exit(0);
  });
});
