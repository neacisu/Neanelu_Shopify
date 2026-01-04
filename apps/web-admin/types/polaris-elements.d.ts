import type * as React from 'react';

type PolarisElementProps = React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> &
  Record<string, unknown>;

declare global {
  namespace React {
    namespace JSX {
      interface IntrinsicElements {
        'polaris-button': PolarisElementProps;
        'polaris-badge': PolarisElementProps;
        'polaris-card': PolarisElementProps;
        'polaris-text-field': PolarisElementProps;
        'polaris-select': PolarisElementProps;
        'polaris-data-table': PolarisElementProps;
        'polaris-progress-bar': PolarisElementProps;
        'polaris-modal': PolarisElementProps;
        'polaris-tabs': PolarisElementProps;
        'polaris-skeleton': PolarisElementProps;
        'polaris-tooltip': PolarisElementProps;
        'polaris-toast': PolarisElementProps;
      }
    }
  }

  // Some tooling still references the global JSX namespace.
  namespace JSX {
    interface IntrinsicElements {
      'polaris-button': PolarisElementProps;
      'polaris-badge': PolarisElementProps;
      'polaris-card': PolarisElementProps;
      'polaris-text-field': PolarisElementProps;
      'polaris-select': PolarisElementProps;
      'polaris-data-table': PolarisElementProps;
      'polaris-progress-bar': PolarisElementProps;
      'polaris-modal': PolarisElementProps;
      'polaris-tabs': PolarisElementProps;
      'polaris-skeleton': PolarisElementProps;
      'polaris-tooltip': PolarisElementProps;
      'polaris-toast': PolarisElementProps;
    }
  }
}

export {};
