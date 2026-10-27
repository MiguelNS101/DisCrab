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
      title="DisCrab"
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 512 512"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`w-full h-full drop-shadow-[0_4px_14px_rgba(244,63,94,0.32)] ${
          animated ? 'transition-transform duration-300 hover:scale-105' : ''
        }`}
      >
        <defs>
          <linearGradient id="dcBgGrad" x1="0" y1="0" x2="512" y2="512" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="var(--sc-bg-primary, #090D1A)" />
            <stop offset="55%" stopColor="var(--sc-bg-surface, #131B36)" />
            <stop offset="100%" stopColor="#1E1B4B" />
          </linearGradient>
          <linearGradient id="dcBorderGrad" x1="0" y1="0" x2="512" y2="512" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FF5E62" />
            <stop offset="50%" stopColor="var(--sc-accent, #22D3EE)" />
            <stop offset="100%" stopColor="var(--sc-accent-secondary, #6366F1)" />
          </linearGradient>
          <linearGradient id="dcCrabBodyGrad" x1="140" y1="210" x2="372" y2="430" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FF6B6B" />
            <stop offset="55%" stopColor="#F43F5E" />
            <stop offset="100%" stopColor="#BE123C" />
          </linearGradient>
          <linearGradient id="dcClawGrad" x1="60" y1="130" x2="180" y2="270" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FF8080" />
            <stop offset="100%" stopColor="#E11D48" />
          </linearGradient>
          <linearGradient id="dcHatGrad" x1="130" y1="70" x2="380" y2="230" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#1E293B" />
            <stop offset="100%" stopColor="#090D16" />
          </linearGradient>
          <linearGradient id="dcGoldGrad" x1="130" y1="160" x2="380" y2="210" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FDE047" />
            <stop offset="100%" stopColor="#F59E0B" />
          </linearGradient>
          <radialGradient id="dcCenterGlow" cx="50%" cy="54%" r="46%">
            <stop offset="0%" stopColor="#F43F5E" stopOpacity="0.32" />
            <stop offset="60%" stopColor="#6366F1" stopOpacity="0.14" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Fundo arredondado DisCrab */}
        <rect
          x="24"
          y="24"
          width="464"
          height="464"
          rx="116"
          fill="url(#dcBgGrad)"
          stroke="url(#dcBorderGrad)"
          strokeWidth="16"
        />
        <rect x="38" y="38" width="436" height="436" rx="102" fill="url(#dcCenterGlow)" />

        {/* Perninhas do Caranguejo (Esquerda) */}
        <path d="M148 332C108 328 82 346 68 372" stroke="#E11D48" strokeWidth="18" strokeLinecap="round" />
        <path d="M152 364C112 368 88 390 78 416" stroke="#E11D48" strokeWidth="18" strokeLinecap="round" />
        <path d="M168 392C136 404 118 426 112 448" stroke="#BE123C" strokeWidth="16" strokeLinecap="round" />

        {/* Perninhas do Caranguejo (Direita) */}
        <path d="M364 332C404 328 430 346 444 372" stroke="#E11D48" strokeWidth="18" strokeLinecap="round" />
        <path d="M360 364C400 368 424 390 434 416" stroke="#E11D48" strokeWidth="18" strokeLinecap="round" />
        <path d="M344 392C376 404 394 426 400 448" stroke="#BE123C" strokeWidth="16" strokeLinecap="round" />

        {/* Braços das Pinças */}
        <path d="M166 278C132 254 114 226 114 198" stroke="#E11D48" strokeWidth="20" strokeLinecap="round" />
        <path d="M346 278C380 254 398 226 398 198" stroke="#E11D48" strokeWidth="20" strokeLinecap="round" />

        {/* Pinça Esquerda */}
        <path
          d="M114 204C78 204 58 172 72 138C82 114 110 112 122 134C112 150 114 166 128 164C138 144 156 146 158 168C160 192 140 204 114 204Z"
          fill="url(#dcClawGrad)"
          stroke="#FFE4E6"
          strokeWidth="4"
          strokeLinejoin="round"
        />

        {/* Pinça Direita */}
        <path
          d="M398 204C434 204 454 172 440 138C430 114 402 112 390 134C400 150 398 166 384 164C374 144 356 146 354 168C352 192 372 204 398 204Z"
          fill="url(#dcClawGrad)"
          stroke="#FFE4E6"
          strokeWidth="4"
          strokeLinejoin="round"
        />

        {/* Corpo Principal Redondinho do Caranguejo */}
        <ellipse cx="256" cy="332" rx="124" ry="94" fill="url(#dcCrabBodyGrad)" stroke="#FDA4AF" strokeWidth="6" />

        {/* Brilho suave no casco */}
        <ellipse
          cx="222"
          cy="284"
          rx="48"
          ry="20"
          transform="rotate(-12 222 284)"
          fill="#FFE4E6"
          fillOpacity="0.28"
        />

        {/* Bochechas Fofas */}
        <ellipse cx="176" cy="348" rx="18" ry="11" fill="#FB7185" fillOpacity="0.85" />
        <ellipse cx="336" cy="348" rx="18" ry="11" fill="#FB7185" fillOpacity="0.85" />

        {/* Tira do Tapa-Olho Pirata */}
        <path d="M150 278C210 296 310 318 370 296" stroke="#090D16" strokeWidth="12" strokeLinecap="round" />

        {/* Olho Esquerdo Brilhante Kawaii */}
        <circle cx="204" cy="314" r="24" fill="#090D16" />
        <circle cx="204" cy="314" r="24" stroke="#FFE4E6" strokeWidth="4" />
        <circle cx="196" cy="305" r="8" fill="#FFFFFF" />
        <circle cx="213" cy="322" r="4" fill="#22D3EE" />

        {/* Tapa-Olho Pirata (Olho Direito) */}
        <path
          d="M282 292H334V314C334 330 321 342 308 342C295 342 282 330 282 314V292Z"
          fill="#090D16"
          stroke="#F59E0B"
          strokeWidth="6"
          strokeLinejoin="round"
        />
        <path
          d="M294 304L322 328M322 304L294 328"
          stroke="#F43F5E"
          strokeWidth="4"
          strokeLinecap="round"
          opacity="0.85"
        />

        {/* Sorriso Bonitinho */}
        <path d="M234 352C242 368 270 368 278 352" stroke="#FFFFFF" strokeWidth="8" strokeLinecap="round" />

        {/* Chapéu de Pirata Tricorne no Topo */}
        <path
          d="M126 226C148 134 206 86 256 86C306 86 364 134 386 226C330 206 182 206 126 226Z"
          fill="url(#dcHatGrad)"
          stroke="url(#dcGoldGrad)"
          strokeWidth="8"
          strokeLinejoin="round"
        />
        {/* Aba do Chapéu de Pirata */}
        <path
          d="M104 228C158 194 354 194 408 228C392 252 340 258 256 258C172 258 120 252 104 228Z"
          fill="#0F172A"
          stroke="url(#dcGoldGrad)"
          strokeWidth="8"
          strokeLinejoin="round"
        />

        {/* Caveirinha Pirata Fofa no Chapéu */}
        <path
          d="M232 180L280 144M280 180L232 144"
          stroke="#FDE047"
          strokeWidth="5"
          strokeLinecap="round"
        />
        <circle cx="256" cy="158" r="16" fill="#FFFFFF" />
        <circle cx="250" cy="156" r="3.5" fill="#090D16" />
        <circle cx="262" cy="156" r="3.5" fill="#090D16" />
        <rect x="249" y="168" width="14" height="8" rx="3" fill="#FFFFFF" />
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
