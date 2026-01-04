export type PolarisProgressBarProps = JSX.IntrinsicElements['polaris-progress-bar'] & {
  progress?: number;
};

export function PolarisProgressBar(props: PolarisProgressBarProps) {
  return <polaris-progress-bar {...props} />;
}
