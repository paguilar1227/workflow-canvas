import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import './native-controls.css';

export type TextareaProps = ComponentPropsWithoutRef<'textarea'>;

/** A native multiline input, including the caller's rows and resize treatment. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ className = '', ...props }, ref) {
  return <textarea {...props} ref={ref} className={`wfc-textarea ${className}`.trim()} />;
});
