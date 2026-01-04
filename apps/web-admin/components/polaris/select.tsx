export type PolarisSelectProps = JSX.IntrinsicElements['polaris-select'] & {
  label?: string;
  value?: string;
};

export function PolarisSelect(props: PolarisSelectProps) {
  return <polaris-select {...props} />;
}
