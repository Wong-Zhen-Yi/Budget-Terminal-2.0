import type { ButtonHTMLAttributes } from 'react'

type Variant = 'default' | 'accent' | 'danger' | 'toggle'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  /** For `toggle`, whether the button reads as pressed. */
  active?: boolean
}

const base =
  'no-drag inline-flex h-8 items-center justify-center border px-2 text-2xs whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-40'

const variants: Record<Variant, (active: boolean) => string> = {
  default: () =>
    'border-border-strong bg-surface-raised text-text hover:bg-surface-hover hover:border-accent-dim',
  accent: () => 'border-accent bg-accent-dim text-text hover:bg-accent',
  // Green and amber stay reserved for gains and warnings; red marks destructive actions only.
  danger: () => 'border-down bg-down-bg text-down hover:bg-down hover:text-bg',
  toggle: (active) =>
    active
      ? 'border-accent bg-accent-dim text-text'
      : 'border-border-strong bg-surface-raised text-text-muted hover:bg-surface-hover hover:text-text',
}

export function Button({
  variant = 'default',
  active = false,
  className = '',
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      aria-pressed={variant === 'toggle' ? active : undefined}
      className={`${base} ${variants[variant](active)} ${className}`}
      {...rest}
    />
  )
}
