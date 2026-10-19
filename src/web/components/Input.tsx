import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import './native-controls.css';

export type InputProps = ComponentPropsWithoutRef<'input'>;

/** A native input: callers retain its type, validation, events, attributes and ref. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ className = '', ...props }, ref) {
  return <input {...props} ref={ref} className={`wfc-input ${className}`.trim()} />;
});
