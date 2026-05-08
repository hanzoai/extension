/**
 * Local @hanzo/gui primitives shim for the extension.
 *
 * This is the canonical surface the extension's React components import via
 * `@hanzo/gui`. It deliberately does NOT pull in the upstream tamagui-based
 * `@hanzo/gui` package because:
 *
 *   1. content-script + background bundles target the smallest possible
 *      payload — RNW + tamagui's runtime is far too heavy for a script
 *      injected into every page;
 *   2. Hanzo brand is strict monochrome (see ~/work/hanzo/brand/brand.json,
 *      primaryColor #FFFFFF), so no color tokens travel with primitives
 *      anyway — pure structural elements styled by sibling CSS;
 *   3. The full tamagui adoption ships in a future feature branch with the
 *      compiler + RNW peer dep wired correctly.
 *
 * The build aliases `@hanzo/gui` → this file. When the tamagui adoption
 * lands, swap the alias target to the published `@hanzo/gui` package.
 *
 * Each primitive renders a plain DOM element with a stable, monochrome
 * class hook. All visuals come from sidebar.css / popup.css using the
 * brand token scale (white luminance ladder, no chromatic accents).
 */
import React from 'react';

type Classy = { className?: string; children?: React.ReactNode };

function cx(base: string, extra?: string): string {
  return extra ? `${base} ${extra}` : base;
}

export function Button(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className, children, ...rest } = props;
  return (
    <button {...rest} className={cx('hanzo-gui-btn', className)}>
      {children}
    </button>
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className, children, ...rest } = props;
  return (
    <textarea {...rest} className={cx('hanzo-gui-textarea', className)}>
      {children}
    </textarea>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className, ...rest } = props;
  return <input {...rest} className={cx('hanzo-gui-input', className)} />;
}

export function Card({ className, children }: Classy) {
  return <div className={cx('hanzo-gui-card', className)}>{children}</div>;
}

export function CardHeader({ className, children }: Classy) {
  return <div className={cx('hanzo-gui-card-header', className)}>{children}</div>;
}

export function CardTitle({ className, children }: Classy) {
  return <h3 className={cx('hanzo-gui-card-title', className)}>{children}</h3>;
}

export function CardDescription({ className, children }: Classy) {
  return <p className={cx('hanzo-gui-card-description', className)}>{children}</p>;
}

export function CardContent({ className, children }: Classy) {
  return <div className={cx('hanzo-gui-card-content', className)}>{children}</div>;
}

/* Layout primitives — mirror the names used by the upstream Tamagui-based
   @hanzo/gui (XStack/YStack) so call-sites can be ported without churn
   when the full adoption lands. Pure flexbox under the hood. */
type Stack = Classy & React.HTMLAttributes<HTMLDivElement> & {
  gap?: number | string;
};

export function XStack({ className, gap, style, children, ...rest }: Stack) {
  const merged: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'row',
    gap,
    ...style,
  };
  return (
    <div {...rest} style={merged} className={cx('hanzo-gui-xstack', className)}>
      {children}
    </div>
  );
}

export function YStack({ className, gap, style, children, ...rest }: Stack) {
  const merged: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap,
    ...style,
  };
  return (
    <div {...rest} style={merged} className={cx('hanzo-gui-ystack', className)}>
      {children}
    </div>
  );
}

export function Text({ className, children, ...rest }: Classy & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span {...rest} className={cx('hanzo-gui-text', className)}>
      {children}
    </span>
  );
}
