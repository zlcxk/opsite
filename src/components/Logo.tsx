import { useState } from 'react';
import { initials } from '../lib/format';

interface LogoProps {
  name: string;
  logoUrl: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

export function Logo({ name, logoUrl, size = 'md', className = '' }: LogoProps) {
  const [failed, setFailed] = useState(false);
  const sizeClass = size === 'md' ? '' : size;
  const showImage = Boolean(logoUrl) && !failed;

  return (
    <span className={`logo-tile ${sizeClass} ${className}`.trim()} title={name} aria-hidden="true">
      {showImage ? (
        <img src={logoUrl!} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        initials(name)
      )}
    </span>
  );
}
