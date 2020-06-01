export interface ForwardEvent {
  forwardID: string;
  request: {
    method: string;
    url: string;
    header: NodeJS.Dict<string | string[]>;
    // base64 encoded
    body?: string;
  };
  // base64 encoded
  traceID?: string;
  created: Date;
}

export interface ForwardResponse {
  forwardID: string;
  response: {
    statusCode: number;
    statusText: string;
    // base64 encoded
    body?: string;
    header: NodeJS.Dict<string | string[]>;
  };
}
