// Type declarations for modules without @types
declare module 'xterm' {
  export class Terminal {
    constructor(options?: any);
    open(element: HTMLElement): void;
    write(data: string): void;
    writeln(data: string): void;
    clear(): void;
    dispose(): void;
    focus(): void;
    resize(columns: number, rows: number): void;
    onData(callback: (data: string) => void): void;
    onTitleChange(callback: (title: string) => void): void;
    options: any;
    element: HTMLElement;
    textarea: HTMLTextAreaElement;
    rows: number;
    cols: number;
    buffers: any;
  }
}

declare module 'xterm-addon-fit' {
  export class FitAddon {
    constructor();
    activate(terminal: any): void;
    fit(): void;
    dispose(): void;
  }
}

declare module 'xterm-addon-web-links' {
  export class WebLinksAddon {
    constructor(handler?: any, options?: any);
    activate(terminal: any): void;
    dispose(): void;
  }
}

declare module 'xterm/css/xterm.css';
