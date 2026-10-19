import { forwardRef, type ComponentPropsWithoutRef } from 'react';

export type ButtonProps = ComponentPropsWithoutRef<'button'> & {
  kind?: 'primary' | 'ghost' | 'danger' | 'default' | 'plain';
  small?: boolean;
  busy?: boolean;
  /** Compatibility alias for existing kit callers; data-testid takes precedence. */
  testid?: string;
  'data-testid'?: string;
};

/** Native button behavior with shared variants, or existing consumer styles in plain mode. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({
  kind = 'plain',
  small = false,
  busy = false,
  disabled,
  type = 'button',
  className = '',
  testid,
  'data-testid': dataTestId,
  'aria-busy': ariaBusy,
  children,
  ...props
}, ref) {
  const classes = [kind === 'plain' ? '' : `btn ${kind}${small ? ' small' : ''}`, className].filter(Boolean).join(' ');
  return (
    <button
      {...props}
      ref={ref}
      type={type}
      className={classes || undefined}
      disabled={disabled || busy}
      aria-busy={busy || ariaBusy}
      data-testid={dataTestId ?? testid}
    >
      {busy ? <span className="wfc-spin" aria-hidden="true" /> : null}
      {children}
    </button>
  );
});
