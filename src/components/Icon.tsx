import type { SVGProps } from 'react';

const PATHS: Record<string, string> = {
  rss: 'M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16M5 19a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z',
  plus: 'M12 5v14M5 12h14',
  refresh: 'M20 11a8 8 0 1 0-2.3 6M20 5v6h-6',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm10 2-4.35-4.35',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8.4-3a8.4 8.4 0 0 0-.14-1.4l2.09-1.63-2-3.46-2.54 1.02a8 8 0 0 0-2.43-1.4L15 2h-4l-.38 2.63a8 8 0 0 0-2.43 1.4L5.65 5.01l-2 3.46L5.74 10.6a8.5 8.5 0 0 0 0 2.8l-2.09 1.63 2 3.46 2.54-1.02a8 8 0 0 0 2.43 1.4L11 22h4l.38-2.63a8 8 0 0 0 2.43-1.4l2.54 1.02 2-3.46-2.09-1.63c.09-.46.14-.93.14-1.4Z',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0-15v2m0 16v2M4.2 4.2l1.4 1.4m12.8 12.8 1.4 1.4M2 12h2m16 0h2M4.2 19.8l1.4-1.4M17.4 5.6l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z',
  check: 'M4 12.5 9 17.5 20 6.5',
  back: 'M15 5l-7 7 7 7',
  external: 'M14 4h6v6M20 4 10 14M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5m4-5v5',
  download: 'M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5M4 19h16',
  upload: 'M12 16V4m0 0 4.5 4.5M12 4 7.5 8.5M4 19h16',
  sort: 'M7 4v16m0 0-3-3m3 3 3-3M17 20V4m0 0-3 3m3-3 3 3',
  close: 'M6 6l12 12M18 6 6 18',
  inbox: 'M3 13h5l1.5 3h5L16 13h5M4 13 6 5h12l2 8v6H4v-6Z',
  play: 'M8 5.5v13l11-6.5-11-6.5Z',
  // lucide “music-2”: two note heads joined by a beam, for audio embeds.
  music: 'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm12-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  eye: 'M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Zm10 2.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  eyeOff: 'M4 4l16 16M9.9 5.7A9.9 9.9 0 0 1 12 5.5c6.4 0 10 6.5 10 6.5a17 17 0 0 1-3.4 4.1M6.5 8A16.6 16.6 0 0 0 2 12s3.6 6.5 10 6.5c1.2 0 2.3-.2 3.3-.6M10.5 10.6a2.5 2.5 0 0 0 3.4 3.4',
  bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0',
  bellOff: 'M8.7 3A6 6 0 0 1 18 8c0 2.5.6 4.4 1.3 5.8M6.3 6.3C6.1 6.8 6 7.4 6 8c0 7-3 9-3 9h12M10.3 21a1.94 1.94 0 0 0 3.4 0M2 2l20 20',
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  list: 'M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01',
  magazine: 'M4 5h16v14H4zM8 5v14M12 9h4M12 13h4M12 16h4',
  compact: 'M4 6h16M4 10h16M4 14h16M4 18h16',
  star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z',
  starFilled: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z',
  sliders: 'M4 6h10M18 6h2M4 12h2M10 12h10M4 18h10M18 18h2M14 4v4M8 10v4M14 16v4',
  filter: 'M4 5h16l-6.5 7.5V19l-3 2v-8.5L4 5Z',
  link: 'M10 13a5 5 0 0 0 7.07 0l2.12-2.12a5 5 0 0 0-7.07-7.07L10.7 5.23M14 11a5 5 0 0 0-7.07 0L4.8 13.12a5 5 0 0 0 7.07 7.07l1.42-1.42',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13h.01M11 12h1v4h1',
  clock: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  chevronRight: 'M9 6l6 6-6 6',
  menu: 'M4 7h16M4 12h16M4 17h16',
  chevronDown: 'M6 9l6 6 6-6',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z',
  book: 'M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5v-15ZM4 20.5A2.5 2.5 0 0 1 6.5 18H19v3H6.5A2.5 2.5 0 0 1 4 20.5Z',
  panelLeft: 'M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5Zm5-1v16',
  // folderPlus/collapse/expand: from gtd/icons/ (lucide folder-plus,
  // chevrons-down-up, chevrons-up-down) -- kept pixel-identical to those
  // reference SVGs rather than hand-approximated.
  folderPlus: 'M12 10v6m-3-3h6m5 7a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z',
  collapse: 'm7 20 5-5 5 5M7 4l5 5 5-5',
  expand: 'm7 15 5 5 5-5M7 9l5-5 5 5',
  locate: 'M12 2v3M12 19v3M2 12h3M19 12h3M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
  pencil:
    'M21.174 6.812a1 1 0 0 0-3.986-3.986L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .622.622l4.353-1.32a2 2 0 0 0 .83-.497zM15 5l4 4',
  copy: 'M8 8V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-3M5 8h11a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z',
  more: 'M5.5 12a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm8 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm8 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z',
};

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: keyof typeof PATHS;
  size?: number;
}

export function Icon({ name, size = 18, ...rest }: IconProps) {
  const filled = name === 'play' || name === 'more' || name === 'starFilled';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
