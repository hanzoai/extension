import React from 'react';

type Classy = { className?: string; children?: React.ReactNode };

function cx(base: string, extra?: string): string {
  return extra ? `${base} ${extra}` : base;
}

export function Button(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className, children, ...rest } = props;
  return (
    <button {...rest} className={cx('hanzo-ui-btn', className)}>
      {children}
    </button>
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className, children, ...rest } = props;
  return (
    <textarea {...rest} className={cx('hanzo-ui-textarea', className)}>
      {children}
    </textarea>
  );
}

export function Card({ className, children }: Classy) {
  return <div className={cx('hanzo-ui-card', className)}>{children}</div>;
}

export function CardHeader({ className, children }: Classy) {
  return <div className={cx('hanzo-ui-card-header', className)}>{children}</div>;
}

export function CardTitle({ className, children }: Classy) {
  return <h3 className={cx('hanzo-ui-card-title', className)}>{children}</h3>;
}

export function CardDescription({ className, children }: Classy) {
  return <p className={cx('hanzo-ui-card-description', className)}>{children}</p>;
}

export function CardContent({ className, children }: Classy) {
  return <div className={cx('hanzo-ui-card-content', className)}>{children}</div>;
}
