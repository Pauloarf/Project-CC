/**
 * Taken from https://github.com/nodejs/undici/tree/23e62c4c0ac992be4fcd5a95151f9edeb76d03cd/types/connector.d.ts
 */

import { TLSSocket, ConnectionOptions } from "tls";
import { IpcNetConnectOpts, Socket, TcpNetConnectOpts } from "net";

export default buildConnector;
declare function buildConnector (options?: buildConnector.BuildOptions): buildConnector.connector

declare namespace buildConnector {
  export type BuildOptions = (ConnectionOptions | TcpNetConnectOpts | IpcNetConnectOpts) & {
    maxCachedSessions?: number | null;
    socketPath?: string | null;
    timeout?: number | null;
    port?: number;
    keepAlive?: boolean | null;
    keepAliveInitialDelay?: number | null;
  }

  export interface Options {
    hostname: string
    host?: string
    protocol: string
    port: string
    servername?: string
    localAddress?: string | null
    httpSocket?: Socket
  }

  export type Callback = (...args: CallbackArgs) => void
  type CallbackArgs = [null, Socket | TLSSocket] | [Error, null]

  export interface connector {
    (options: buildConnector.Options, callback: buildConnector.Callback): void
  }
}