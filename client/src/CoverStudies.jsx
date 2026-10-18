import React from 'react';
export default function CoverStudies() {
  return (
    <svg
      className="cover-studies"
      viewBox="0 0 1376 768"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <filter id="study-pencil" x="-15%" y="-15%" width="130%" height="130%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency=".035 .19"
            numOctaves="3"
            seed="6"
            result="grain"
          />
          <feDisplacementMap in="SourceGraphic" in2="grain" scale="1.8" result="ink" />
          <feGaussianBlur in="ink" stdDeviation=".6" result="wash" />
          <feMerge>
            <feMergeNode in="wash" />
            <feMergeNode in="ink" />
          </feMerge>
        </filter>
        <linearGradient id="feather-wash">
          <stop stopColor="#e0e3d4" />
          <stop offset="1" stopColor="#88918a" />
        </linearGradient>
      </defs>
      <g
        fill="none"
        stroke="#666a5d"
        strokeWidth=".95"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity=".58"
        filter="url(#study-pencil)"
      >
        <g transform="translate(275 472)">
          <path d="M0 48L41-15 100 50Z M41-15L30 49M-2 49h103" />
          <path d="M10 38l6 10M31 39v10M38-9l6 4M76 39l-4 9" />
          <text x="41" y="-22" stroke="none" fill="#656c56" fontSize="9" fontFamily="serif">
            A
          </text>
        </g>
        <g transform="translate(430 456)">
          <path d="M-25 24C-50-29-8-61 17-9L32 20M-26 12L19-23M-22-7l42 6M0-35L1 30" />
          <path d="M-31 1l7 3m43-27 2 7M-4-28l8-4" />
          <text x="-4" y="-38" stroke="none" fill="#515a46" fontSize="8" fontFamily="serif">
            N
          </text>
        </g>
        <g transform="translate(190 549)">
          <path d="M-28 0h56M0-7v57M-26 4l-8 39q7 10 16 0l-8-39M26 4l-8 39q7 10 16 0l-8-39M-6 48q6 9 12 0" />
          <ellipse cx="-26" cy="44" rx="8" ry="3" />
          <ellipse cx="26" cy="44" rx="8" ry="3" />
        </g>
        <g transform="translate(334 667)">
          <ellipse cy="29" rx="44" ry="8" />
          <path d="M-11 29L-36-42 56 5Z M-11 29L25-29M-22-9l45-13M20-11l38-2M5-25l48-4M32 6l25 10" />
          <path d="M48-16l11 2-8 5M48-33l11 4-8 4" />
          <circle cx="25" cy="-29" r="2" />
        </g>
        <g transform="translate(704 503)">
          <circle r="26" />
          <ellipse rx="14" ry="26" />
          <path d="M-26 0h52M-21-13q21 8 42 0M-21 13q21-8 42 0M-18-22q-20 32 7 51M0 27v13M-17 43h34" />
          <path d="M-8-19l8 6 6-5 9 13-9 5 3 9-11 12-5-9-11-2 7-14-4-7Z" strokeWidth=".8" />
          <ellipse cy="43" rx="16" ry="3" />
        </g>
        <g transform="translate(602 612)">
          <path d="M-7-22h15M-5-20v18l-14 28q-3 8 19 8t20-8L6-2v-18M-14 19q15-4 28 0" />
          <path d="M-9 28q10 4 22 0" />
          <path d="M25-23l12 16 22 5M35-6l-5 21" />
          <ellipse cx="24" cy="-27" rx="5" ry="8" transform="rotate(-30 24 -27)" />
          <ellipse cx="37" cy="-6" rx="8" ry="10" transform="rotate(-30 37 -6)" />
          <ellipse cx="62" cy="1" rx="7" ry="7" />
          <ellipse cx="29" cy="17" rx="5" ry="6" />
        </g>
        <g transform="translate(746 674) rotate(28)">
          <path d="M0 40Q-36-7 5-45Q39-10 0 40Z" fill="url(#feather-wash)" />
          <path d="M0 47L5-44M2 20l-16-18M3 6l21-24M3-9l-12-14M4-21l16-16M1 30l15-15" />
          <path d="M-2 41l-2 16" strokeWidth="2" />
        </g>
      </g>
    </svg>
  );
}
