declare module 'protoo-client' {
  export class WebSocketTransport {
    constructor(url: string, options?: any);
  }

  export class Peer {
    constructor(transport: WebSocketTransport);

    on(event: string, listener: (...args: any[]) => void): void;
    request(method: string, data?: any): Promise<any>;
    notify(method: string, data?: any): void;
    close(): void;
  }

  export interface Notification {
    method: string;
    data: any;
  }
}
