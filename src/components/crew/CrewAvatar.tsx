import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg'
import type { CrewShape } from '../../lib/crew'

// Same blob faces as the Claude Crew Mac app (~/dev/claude-crew/public/app.js).
function Shape({ shape }: { shape: CrewShape }) {
  switch (shape) {
    case 'round':
      return <Circle cx={50} cy={50} r={40} />
    case 'triangle':
      return (
        <Path
          d="M30 12 C20 8 12 16 12 28 L14 78 C14 90 24 94 34 88 L84 60 C94 54 94 44 84 38 Z"
          transform="rotate(-8 50 50)"
        />
      )
    case 'cloud':
      return (
        <Path d="M18 62 C6 58 8 38 22 38 C20 20 42 12 52 26 C62 12 88 18 84 40 C96 46 94 70 80 74 C76 90 44 92 34 82 C24 86 14 76 18 62 Z" />
      )
    default:
      return <Rect x={12} y={14} width={76} height={70} rx={26} transform="rotate(-12 50 50)" />
  }
}

export default function CrewAvatar({ color, shape, size = 44 }: { color: string; shape: CrewShape; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <G fill={color}>
        <Shape shape={shape} />
      </G>
      <Ellipse cx={41} cy={46} rx={5.5} ry={10} fill="#141414" transform="rotate(-22 41 46)" />
      <Ellipse cx={59} cy={42} rx={5.5} ry={10} fill="#141414" transform="rotate(-22 59 42)" />
    </Svg>
  )
}
