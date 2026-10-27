import React from 'react';

interface AppIconProps {
  size?: number;
  className?: string;
  showLiveDot?: boolean;
  animated?: boolean;
}

export const AppIcon: React.FC<AppIconProps> = ({
  size = 40,
  className = '',
  showLiveDot = true,
  animated = false,
}) => {
  return (
    <div
      className={`relative inline-flex items-center justify-center shrink-0 select-none ${className}`}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 512 512"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full drop-shadow-[0_4px_14px_rgba(6,182,212,0.28)]"
      >
        <defs>
          <linearGradient
            id="scIconBgGrad"
            x1="0"
            y1="0"
            x2="512"
            y2="512"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="var(--sc-bg-primary, #060B16)" />
            <stop offset="55%" stopColor="var(--sc-bg-surface, #0F172A)" />
            <stop offset="100%" stopColor="#1E1B4B" />
          </linearGradient>
          <linearGradient
            id="scIconBorderGrad"
            x1="0"
            y1="0"
            x2="512"
            y2="512"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="var(--sc-accent, #22D3EE)" />
            <stop offset="50%" stopColor="var(--sc-accent, #06B6D4)" />
            <stop offset="100%" stopColor="var(--sc-accent-secondary, #6366F1)" />
          </linearGradient>
          <linearGradient
            id="scIconPlayGrad"
            x1="180"
            y1="160"
            x2="340"
            y2="320"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#67E8F9" />
            <stop offset="50%" stopColor="var(--sc-accent, #22D3EE)" />
            <stop offset="100%" stopColor="var(--sc-accent-secondary, #818CF8)" />
          </linearGradient>
          <radialGradient id="scIconCenterGlow" cx="50%" cy="48%" r="48%">
            <stop offset="0%" stopColor="var(--sc-accent, #06B6D4)" stopOpacity="0.38" />
            <stop offset="60%" stopColor="var(--sc-accent-secondary, #6366F1)" stopOpacity="0.14" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Squircle Principal */}
        <rect
          x="24"
          y="24"
          width="464"
          height="464"
          rx="112"
          fill="url(#scIconBgGrad)"
          stroke="url(#scIconBorderGrad)"
          strokeWidth="16"
        />
        <rect x="38" y="38" width="436" height="436" rx="98" fill="url(#scIconCenterGlow)" />

        {/* Moldura de Transmissão / Monitor */}
        <rect
          x="96"
          y="122"
          width="320"
          height="236"
          rx="44"
          fill="#090F1E"
          fillOpacity="0.82"
          stroke="url(#scIconBorderGrad)"
          strokeWidth="14"
        />

        {/* Ondas de Áudio WASAPI & Sinal P2P */}
        <path
          d="M156 196C140 218 140 262 156 284"
          stroke="#10B981"
          strokeWidth="13"
          strokeLinecap="round"
          className={animated ? 'animate-pulse' : ''}
        />
        <path
          d="M128 176C104 212 104 268 128 304"
          stroke="var(--sc-accent, #22D3EE)"
          strokeWidth="11"
          strokeLinecap="round"
          opacity="0.7"
        />
        <path
          d="M356 196C372 218 372 262 356 284"
          stroke="#10B981"
          strokeWidth="13"
          strokeLinecap="round"
          className={animated ? 'animate-pulse' : ''}
        />
        <path
          d="M384 176C408 212 408 268 384 304"
          stroke="var(--sc-accent, #22D3EE)"
          strokeWidth="11"
          strokeLinecap="round"
          opacity="0.7"
        />

        {/* Prisma Play / Stream Central */}
        <path
          d="M218 184.5C218 175.8 227.5 170.4 235 174.9L316.5 224.4C323.7 228.8 323.7 239.2 316.5 243.6L235 293.1C227.5 297.6 218 292.2 218 283.5V184.5Z"
          fill="url(#scIconPlayGrad)"
        />

        {/* Barra Inferior LED */}
        <rect x="176" y="394" width="160" height="22" rx="11" fill="#10B981" />
      </svg>

      {showLiveDot && (
        <span
          className="absolute -top-0.5 -right-0.5 rounded-full bg-emerald-500 border-2 border-neutral-950 shadow-sm"
          style={{
            width: Math.max(8, Math.round(size * 0.24)),
            height: Math.max(8, Math.round(size * 0.24)),
          }}
        />
      )}
    </div>
  );
};
