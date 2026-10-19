import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import './checkbox.css';

export type CheckboxProps = Omit<ComponentPropsWithoutRef<'input'>, 'type'>;

/** A themed native checkbox; its surrounding label remains the click target. */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox({ className = '', ...props }, ref) {
  return <input {...props} ref={ref} type="checkbox" className={`wfc-checkbox ${className}`.trim()} />;
});
