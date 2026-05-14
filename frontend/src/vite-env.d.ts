/// <reference types="vite/client" />

declare module '*.module.css' {
  const classes: { readonly [key: string]: string }
  export default classes
}

declare module 'ansi-to-html' {
  class Convert {
    constructor(opts?: { fg?: string; bg?: string; newline?: boolean; escapeXML?: boolean })
    toHtml(text: string): string
  }
  export default Convert
}

declare module 'reconnecting-websocket' {
  export default class ReconnectingWebSocket {
    constructor(url: string, protocols?: string | string[], options?: any)
    send(data: string): void
    close(code?: number, reason?: string): void
    onopen: ((event: Event) => void) | null
    onclose: ((event: CloseEvent) => void) | null
    onmessage: ((event: MessageEvent) => void) | null
    onerror: ((event: Event) => void) | null
    readyState: number
    static readonly CONNECTING: 0
    static readonly OPEN: 1
    static readonly CLOSING: 2
    static readonly CLOSED: 3
  }
}
