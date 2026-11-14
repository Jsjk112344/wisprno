// Fixed map geometry and icons from the design (node positions, edge paths, pass-count badge positions).
import type { SVGProps } from 'react';
import type { EdgeId, NodeId } from '../../src/loop/story.ts';

export const NODES: Record<NodeId, [number, number]> = {
  details: [125, 150], tactic: [125, 350], caller: [340, 250], agent: [620, 250], identity: [620, 125],
  approval: [850, 150], payout: [1080, 150], other: [850, 350], record: [1080, 350],
};

export const EDGES: Record<EdgeId, { d: string; x: number; y: number }> = {
  'details-caller': { d: 'M215 150 C240 150 225 239 250 239', x: 229, y: 187 },
  'tactic-caller': { d: 'M215 350 C240 350 225 261 250 261', x: 229, y: 313 },
  'caller-agent': { d: 'M430 239 L530 239', x: 480, y: 221 },
  'agent-caller': { d: 'M530 261 L430 261', x: 480, y: 281 },
  'agent-identity': { d: 'M608 212 L608 163', x: 591, y: 188 },
  'identity-agent': { d: 'M632 163 L632 212', x: 649, y: 188 },
  'agent-approval': { d: 'M710 239 C736 239 734 150 760 150', x: 736, y: 191 },
  'approval-agent': { d: 'M760 171 C750 171 740 261 710 261', x: 759, y: 224 },
  'approval-payout': { d: 'M940 150 L990 150', x: 965, y: 131 },
  'payout-record': { d: 'M1080 188 L1080 312', x: 1099, y: 250 },
  'agent-other': { d: 'M620 288 C620 350 698 350 760 350', x: 702, y: 332 },
  'other-record': { d: 'M940 350 L990 350', x: 965, y: 331 },
  feedback: { d: 'M580 288 C580 476 125 476 125 388', x: 384, y: 433 },
  leak: { d: 'M530 226 C494 183 466 183 430 226', x: 480, y: 180 },
};

const ICON_PATHS: Record<string, string> = {
  play: 'M7 4l12 8-12 8z', pause: 'M8 5v14M16 5v14', arrow: 'M5 12h14M13 6l6 6-6 6', close: 'M6 6l12 12M6 18L18 6',
  volume: 'M3 9h4l5-5v16l-5-5H3zM16 8c3 2 3 6 0 8M19 5c5 4 5 10 0 14', mute: 'M3 9h4l5-5v16l-5-5H3zM16 9l6 6M22 9l-6 6',
  branch: 'M6 3v14a3 3 0 1 0 3 3M6 9h9a3 3 0 0 0 3-3V3M3 3h6M15 3h6', chart: 'M4 4v16h17M8 15v-4M13 15V7M18 15V5',
  phone: 'M7 3l4 5-3 3c2 3 3 4 6 6l3-3 4 4c-2 6-7 4-12-1S2 5 7 3', reset: 'M4 9a8 8 0 1 1 0 7M4 3v6h6',
  check: 'M5 12l4 4L19 6', download: 'M12 3v12M7 10l5 5 5-5M4 16v5h16v-5', chevron: 'M9 5l7 7-7 7',
  layers: 'M12 3l10 6-10 6L2 9zM2 14l10 6 10-6', plus: 'M12 3v18M3 12h18', down: 'M6 9l6 6 6-6',
};

export function Icon({ name, size = 18, ...rest }: { name: string; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" {...rest}>
      <path d={ICON_PATHS[name] ?? ICON_PATHS.plus} />
    </svg>
  );
}

// Lucide icons (ISC licence) used by the design for the nine nodes, inlined.
type Shape = ['path', { d: string }] | ['circle', Record<string, string>] | ['rect', Record<string, string>]
  | ['ellipse', Record<string, string>] | ['line', Record<string, string>] | ['polygon', { points: string }];
const NODE_ICONS: Record<NodeId, Shape[]> = {
  details: [['path', { d: 'M16 2v2' }], ['path', { d: 'M17.915 22a6 6 0 0 0-12 0' }], ['path', { d: 'M8 2v2' }],
    ['circle', { cx: '12', cy: '12', r: '4' }], ['rect', { x: '3', y: '4', width: '18', height: '18', rx: '2' }]],
  tactic: [['rect', { width: '8', height: '8', x: '3', y: '3', rx: '2' }], ['path', { d: 'M7 11v4a2 2 0 0 0 2 2h4' }],
    ['rect', { width: '8', height: '8', x: '13', y: '13', rx: '2' }]],
  caller: [['circle', { cx: '12', cy: '8', r: '5' }], ['path', { d: 'M20 21a8 8 0 0 0-16 0' }]],
  agent: [['path', { d: 'M2 10v3' }], ['path', { d: 'M6 6v11' }], ['path', { d: 'M10 3v18' }], ['path', { d: 'M14 8v7' }],
    ['path', { d: 'M18 5v13' }], ['path', { d: 'M22 10v3' }]],
  identity: [['path', { d: 'M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z' }],
    ['path', { d: 'm9 12 2 2 4-4' }]],
  approval: [['path', { d: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z' }],
    ['path', { d: 'm9 12 2 2 4-4' }]],
  payout: [['line', { x1: '3', x2: '21', y1: '22', y2: '22' }], ['line', { x1: '6', x2: '6', y1: '18', y2: '11' }],
    ['line', { x1: '10', x2: '10', y1: '18', y2: '11' }], ['line', { x1: '14', x2: '14', y1: '18', y2: '11' }],
    ['line', { x1: '18', x2: '18', y1: '18', y2: '11' }], ['polygon', { points: '12 2 20 7 4 7' }]],
  other: [['rect', { width: '7', height: '7', x: '14', y: '3', rx: '1' }],
    ['path', { d: 'M10 21V8a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1H3' }]],
  record: [['ellipse', { cx: '12', cy: '5', rx: '9', ry: '3' }], ['path', { d: 'M3 5V19A9 3 0 0 0 21 19V5' }],
    ['path', { d: 'M3 12A9 3 0 0 0 21 12' }]],
};

export function NodeIcon({ node }: { node: NodeId }) {
  return (
    <svg x={-78} y={-20} width={40} height={40} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.45}
      strokeLinecap="round" strokeLinejoin="round" className={`lucide refined-icon`}>
      {NODE_ICONS[node].map(([tag, attrs], i) => {
        const Tag = tag;
        return <Tag key={i} {...(attrs as Record<string, string>)} />;
      })}
    </svg>
  );
}
