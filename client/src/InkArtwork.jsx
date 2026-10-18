import React from 'react';

// All cover artwork is vector geometry; no screenshot or raster assets.
export default function InkArtwork() {
  const leaves = [
    [-18, -105, -65],
    [-12, -150, 45],
    [-4, -207, -48],
    [4, -258, 50],
    [18, -303, -60],
    [28, -354, 40],
    [37, -396, -38],
  ];
  const bamboo = (x, y, s, angle) => (
    <g transform={`translate(${x} ${y}) rotate(${angle}) scale(${s})`}>
      <path d="M0 0 Q-26 -180 46 -440" fill="none" stroke="#343a32" strokeWidth="3" />
      {[75, 125, 180, 235, 290, 345, 395].map((n) => (
        <path key={n} d={`M${n / 10 - 18} ${-n} l12 -2`} stroke="#22291f" strokeWidth="2" />
      ))}
      {leaves.map(([a, b, r], i) => (
        <g key={i} transform={`translate(${a} ${b}) rotate(${r})`}>
          <path
            d="M0 0 Q28 -26 80 -28 Q43 -8 0 0 M8 0 Q37 3 59 28 Q28 17 8 0 M-1 0 Q7 -29 9 -59 Q-5 -27 -1 0"
            fill="#343c30"
          />
          <path d="M0 0 L84 -30" stroke="#434a3c" fill="none" />
        </g>
      ))}
    </g>
  );
  return (
    <svg
      className="cover-vector"
      viewBox="0 0 1440 800"
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
    >
      <defs>
        <filter id="paper-grain">
          <feTurbulence type="fractalNoise" baseFrequency=".65" numOctaves="3" seed="8" />
          <feColorMatrix type="saturate" values="0" />
          <feComponentTransfer>
            <feFuncA type="linear" slope=".045" />
          </feComponentTransfer>
          <feBlend in="SourceGraphic" mode="multiply" />
        </filter>
        <filter id="ink-wash">
          <feGaussianBlur stdDeviation="8" />
        </filter>
        <linearGradient id="mountain-wash" x2="0" y2="1">
          <stop stopColor="#777d70" stopOpacity=".24" />
          <stop offset="1" stopColor="#777d70" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="1440" height="800" fill="#fafaf3" filter="url(#paper-grain)" />
      <g filter="url(#ink-wash)" fill="url(#mountain-wash)">
        <path d="M80 570L175 434 218 469 302 398 358 472 437 415 497 490 553 453 629 551 716 519 795 611H80Z" />
        <path d="M212 637L345 515 401 558 459 497 520 588 588 541 698 620 786 582 880 697H212Z" />
        <path
          d="M1030 287q0-35 37-20q28-52 60-8q57-20 61 19q-19 27-70 13q-60 25-88-4Z"
          fill="#969c90"
          opacity=".19"
        />
      </g>
      <g stroke="#a0a694" strokeWidth="1" opacity=".35">
        <path d="M185 653q170-12 370 0M240 669q240-12 430 0M124 699q330-17 610 0M270 726q190-10 355 0" />
      </g>
      <g opacity=".86">
        {bamboo(42, 810, 1.25, -10)}
        {bamboo(100, 820, 1.02, 11)}
        {bamboo(-15, 815, 0.95, -24)}
        {bamboo(174, 825, 0.75, 24)}
      </g>
      <g fill="none" stroke="#535b4c" opacity=".72" strokeWidth="1.2">
        <path d="M283 496l90-96 52 120Z M373 400l-8 110" />
        <path d="M420 472q-7-90 45-60q33 28 18 88M425 461l52-34" />
        <ellipse cx="351" cy="690" rx="45" ry="10" />
        <path d="M351 690l-45-100 105 76Z M351 690l30-104" />
        <circle cx="703" cy="544" r="24" />
        <ellipse cx="703" cy="544" rx="11" ry="24" />
        <path d="M679 544h48M703 568v14m-19 2h38M618 636l-10 35q-8 18 14 21q25 0 18-20l-12-36v-19h-10Z M655 624l22-17 20 20-23 18Z" />
        <circle cx="655" cy="624" r="5" />
        <circle cx="677" cy="607" r="5" />
        <circle cx="697" cy="627" r="5" />
      </g>
      <g transform="translate(452 617)" fill="#30392d">
        <path d="M-38 8q45 8 83 0l-13 9h-54Z" />
        <path d="M-12 8l9-20 26 3 7 18Z" opacity=".75" />
        <path d="M-23 8v-19l7-5 4 3-6 7 2 14Z" />
        <circle cx="-16" cy="-19" r="3" />
      </g>
      <g fill="none" stroke="#444b3d" strokeLinecap="round">
        <path d="M1460 472Q1380 493 1304 592T1133 700" strokeWidth="7" />
        <path
          d="M1331 568q-6-53-43-82m7 120q-50-8-74-32m-40 104q-4-26-30-36m152-50q55-4 90-37"
          strokeWidth="3"
        />
      </g>
      {[
        [1290, 489],
        [1307, 530],
        [1327, 561],
        [1260, 581],
        [1222, 574],
        [1190, 663],
        [1156, 642],
        [1389, 552],
        [1356, 573],
      ].map(([x, y], i) => (
        <g
          key={i}
          transform={`translate(${x} ${y})`}
          fill="#d7b9b1"
          stroke="#706d5e"
          strokeWidth=".8"
        >
          {[0, 72, 144, 216, 288].map((r) => (
            <ellipse key={r} transform={`rotate(${r})`} cx="0" cy="-5" rx="4" ry="6" />
          ))}
          <circle r="2" fill="#7a6357" />
        </g>
      ))}
      <g transform="translate(754 701) rotate(25)" stroke="#59634b" fill="#b9beac">
        <path d="M0 26Q-34-7 5-51Q36-13 0 26Z" />
        <path d="M0 30l5-79M3-30l-12-5M2-16l18-13M1-5l-16-9M0 8l14-12" fill="none" />
      </g>
    </svg>
  );
}
