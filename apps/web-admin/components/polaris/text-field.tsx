export type PolarisTextFieldProps = JSX.IntrinsicElements['polaris-text-field'] & {
  label?: string;
  value?: string;
  placeholder?: string;
};

export function PolarisTextField(props: PolarisTextFieldProps) {
  return <polaris-text-field {...props} />;
}
