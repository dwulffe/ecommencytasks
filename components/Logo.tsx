export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Open ring with a break at the top-right, echoing the brand mark */}
      <path
        d="M46 12.5A26 26 0 1 0 56 32"
        stroke="#a7d7b8"
        strokeWidth="4"
        strokeLinecap="round"
      />
      {/* Growth bars */}
      <rect x="22" y="36" width="5" height="9" rx="2" fill="#a7d7b8" />
      <rect x="30" y="30" width="5" height="15" rx="2" fill="#a7d7b8" />
      <rect x="38" y="24" width="5" height="21" rx="2" fill="#a7d7b8" />
      {/* Arrow to the top-right */}
      <path
        d="M40 24l14-8-3 8"
        stroke="#a7d7b8"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path d="M54 16l-2.5 8.5" stroke="#a7d7b8" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}
