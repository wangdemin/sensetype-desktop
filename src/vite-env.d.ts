/// <reference types="vite/client" />
/// <reference types="vite-plugin-svgr/client" />

declare module '*.module.scss' {
  const classes: Record<string, string>;
  export default classes;
}

declare module '*.svg?react' {
  import * as React from 'react';
  const ReactComponent: React.FC<React.SVGProps<SVGSVGElement> & { title?: string }>;
  export default ReactComponent;
}

interface Window {
  sensetype: {
    db: {
      get: (key: string) => any;
      put: (data: any) => any;
      addData: (data: any) => any;
    };
    showMainWindow?: () => void;
    isMacOs?: () => boolean;

    stopRecorder?: () => void;
    closeRecorderWindow?: () => void;
    closeTipWindow?: () => void;
  };
  initvoice: () => void;
}
