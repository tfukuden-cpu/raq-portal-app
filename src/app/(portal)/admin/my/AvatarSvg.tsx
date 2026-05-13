/**
 * Tomodachi Collection-style SVG avatar renderer
 * Pure rendering component – no client hooks, safe to use anywhere.
 */
import type { AvatarConfig } from "./avatar-types";
import { BG_HEX, SKIN_COLORS, HAIR_COLOR_OPTIONS } from "./avatar-types";

interface AvatarSvgProps {
  config: AvatarConfig;
  size?: number;
}

// ── Hair (back layer – rendered BEFORE the face) ──────────────────────────────

function HairBack({ style, color }: { style: number; color: string }) {
  switch (style) {
    case 1: // Medium – back goes to mid-neck
      return (
        <path
          d="M 20,52 Q 18,18 50,16 Q 82,18 80,52 L 80,74 Q 50,82 20,74 Z"
          fill={color}
        />
      );
    case 2: // Long – back goes below face
      return (
        <path
          d="M 20,52 Q 18,18 50,16 Q 82,18 80,52 L 84,97 Q 50,102 16,97 Z"
          fill={color}
        />
      );
    case 3: // Ponytail – short back + side ponytail
      return (
        <>
          <path
            d="M 20,52 Q 18,18 50,16 Q 82,18 80,52 L 80,66 Q 50,74 20,66 Z"
            fill={color}
          />
          {/* Ponytail to the right */}
          <path
            d="M 76,38 Q 96,22 91,46 Q 100,34 95,56 Q 87,48 78,53 Q 83,43 76,38 Z"
            fill={color}
          />
        </>
      );
    default: // Short (0) and Spiky (4) have no back layer
      return null;
  }
}

// ── Hair cap (shared fringe shape) ───────────────────────────────────────────

function HairCap({ color }: { color: string }) {
  return (
    <path
      d="M 23,46 Q 22,20 50,18 Q 78,20 77,46 Q 68,32 50,31 Q 32,32 23,46 Z"
      fill={color}
    />
  );
}

// ── Hair (front layer – rendered AFTER the face) ──────────────────────────────

function HairFront({ style, color }: { style: number; color: string }) {
  switch (style) {
    case 0: // Short – cap only
      return <HairCap color={color} />;

    case 1: // Medium – cap + side wings covering ears
      return (
        <>
          <path d="M 18,54 Q 16,30 23,46 Q 20,62 18,54 Z" fill={color} />
          <path d="M 82,54 Q 84,30 77,46 Q 80,62 82,54 Z" fill={color} />
          <HairCap color={color} />
        </>
      );

    case 2: // Long – cap + longer side strands
      return (
        <>
          <path d="M 15,54 Q 13,26 23,46 Q 17,72 15,54 Z" fill={color} />
          <path d="M 85,54 Q 87,26 77,46 Q 83,72 85,54 Z" fill={color} />
          <HairCap color={color} />
        </>
      );

    case 3: // Ponytail – slimmer fringe, hair swept to one side
      return (
        <path
          d="M 24,44 Q 23,20 50,18 Q 78,20 76,44 Q 67,31 50,30 Q 33,31 24,44 Z"
          fill={color}
        />
      );

    case 4: // Spiky – base cap + 4 spikes
      return (
        <>
          {/* Base */}
          <path
            d="M 26,48 Q 24,22 50,20 Q 76,22 74,48 Q 66,34 50,33 Q 34,34 26,48 Z"
            fill={color}
          />
          {/* Spikes */}
          <polygon points="28,38 22,8 38,32"  fill={color} />
          <polygon points="42,29 43,5  53,28"  fill={color} />
          <polygon points="55,28 60,5  67,32"  fill={color} />
          <polygon points="68,34 77,10 75,40"  fill={color} />
        </>
      );

    default:
      return null;
  }
}

// ── Eyes ──────────────────────────────────────────────────────────────────────

function Eyes({ style }: { style: number }) {
  const C = "#2C1810"; // eye dark color
  switch (style) {
    case 0: // Normal
      return (
        <>
          <ellipse cx="38" cy="48" rx="5"   ry="5.5" fill={C} />
          <ellipse cx="62" cy="48" rx="5"   ry="5.5" fill={C} />
          <circle  cx="40" cy="46" r="1.8"  fill="white" />
          <circle  cx="64" cy="46" r="1.8"  fill="white" />
        </>
      );
    case 1: // Happy – squinting upward-arc eyes (◡ shape)
      return (
        <>
          <path d="M 33,50 Q 38,43 43,50" stroke={C} strokeWidth="2.8" fill="none" strokeLinecap="round" />
          <path d="M 57,50 Q 62,43 67,50" stroke={C} strokeWidth="2.8" fill="none" strokeLinecap="round" />
        </>
      );
    case 2: // Big – extra large with double highlight
      return (
        <>
          <ellipse cx="38" cy="48" rx="7"   ry="7.5" fill={C} />
          <ellipse cx="62" cy="48" rx="7"   ry="7.5" fill={C} />
          <circle  cx="41" cy="45" r="2.8"  fill="white" />
          <circle  cx="65" cy="45" r="2.8"  fill="white" />
          <circle  cx="42" cy="44" r="1.2"  fill="white" opacity="0.7" />
          <circle  cx="66" cy="44" r="1.2"  fill="white" opacity="0.7" />
        </>
      );
    case 3: // Wink – left eye open, right eye closed (∩)
      return (
        <>
          <ellipse cx="38" cy="48" rx="5" ry="5.5" fill={C} />
          <circle  cx="40" cy="46" r="1.8" fill="white" />
          {/* Winking right eye */}
          <path d="M 57,48 Q 62,43 67,48" stroke={C} strokeWidth="2.5" fill="none" strokeLinecap="round" />
          {/* Small lash lines */}
          <line x1="62" y1="50" x2="60" y2="52.5" stroke={C} strokeWidth="1.5" strokeLinecap="round" />
          <line x1="62" y1="50" x2="64" y2="52.5" stroke={C} strokeWidth="1.5" strokeLinecap="round" />
        </>
      );
    case 4: // Star – 5-pointed star eyes (golden)
      return (
        <>
          {/* Left star at (38, 48) r≈5.5 */}
          <polygon
            points="38,42.5 39.6,46.3 43.8,46.3 40.5,48.8 41.8,53 38,50.7 34.2,53 35.5,48.8 32.2,46.3 36.4,46.3"
            fill="#FFD700"
          />
          {/* Right star at (62, 48) */}
          <polygon
            points="62,42.5 63.6,46.3 67.8,46.3 64.5,48.8 65.8,53 62,50.7 58.2,53 59.5,48.8 56.2,46.3 60.4,46.3"
            fill="#FFD700"
          />
        </>
      );
    default:
      return null;
  }
}

// ── Mouth ─────────────────────────────────────────────────────────────────────

function Mouth({ style }: { style: number }) {
  const C = "#2C1810";
  switch (style) {
    case 0: // Smile
      return (
        <path
          d="M 40,65 Q 50,73 60,65"
          stroke={C} strokeWidth="2.5" fill="none" strokeLinecap="round"
        />
      );
    case 1: // Big Smile with teeth
      return (
        <>
          {/* Mouth interior */}
          <path d="M 36,63 Q 50,78 64,63 Q 50,68 36,63 Z" fill="#CC3030" />
          {/* Teeth */}
          <path d="M 37,63 Q 50,68 63,63 Q 50,66 37,63 Z" fill="white" />
          {/* Outline */}
          <path
            d="M 36,63 Q 50,78 64,63"
            stroke={C} strokeWidth="2" fill="none" strokeLinecap="round"
          />
        </>
      );
    case 2: // Neutral
      return (
        <line
          x1="42" y1="68" x2="58" y2="68"
          stroke={C} strokeWidth="2.5" strokeLinecap="round"
        />
      );
    case 3: // Surprised – open O mouth
      return (
        <>
          <ellipse cx="50" cy="68" rx="6"   ry="6.5" fill={C} />
          <ellipse cx="50" cy="68" rx="4"   ry="4.5" fill="#FF8080" />
        </>
      );
    default:
      return null;
  }
}

// ── Main SVG component ────────────────────────────────────────────────────────

export default function AvatarSvg({ config, size = 80 }: AvatarSvgProps) {
  const bgHex   = BG_HEX[config.bg]                              ?? BG_HEX.sky;
  const skinHex = SKIN_COLORS[config.skin]                       ?? SKIN_COLORS[0];
  const hairHex = HAIR_COLOR_OPTIONS.find(h => h.key === config.hair_color)?.hex ?? "#1A1A1A";

  // Ear/nose accent slightly darker than skin
  const accentHex =
    config.skin === 0 ? "#DDB090" :
    config.skin === 1 ? "#D4A882" :
    config.skin === 2 ? "#C4885C" :
    config.skin === 3 ? "#9A6030" :
                        "#6B3A20";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Background circle */}
      <circle cx="50" cy="50" r="50" fill={bgHex} />

      {/* Hair – back layer */}
      <HairBack style={config.hair_style} color={hairHex} />

      {/* Ears */}
      <ellipse cx="22" cy="54" rx="5"   ry="6"   fill={skinHex} />
      <ellipse cx="78" cy="54" rx="5"   ry="6"   fill={skinHex} />
      <ellipse cx="22" cy="54" rx="2.5" ry="3.5" fill={accentHex} opacity="0.45" />
      <ellipse cx="78" cy="54" rx="2.5" ry="3.5" fill={accentHex} opacity="0.45" />

      {/* Face */}
      <ellipse cx="50" cy="53" rx="27" ry="29" fill={skinHex} />

      {/* Eyebrows */}
      <path d="M 32,40 Q 38,37 43,40" stroke="#3C2010" strokeWidth="2"   fill="none" strokeLinecap="round" opacity="0.75" />
      <path d="M 57,40 Q 62,37 68,40" stroke="#3C2010" strokeWidth="2"   fill="none" strokeLinecap="round" opacity="0.75" />

      {/* Eyes */}
      <Eyes style={config.eyes} />

      {/* Nose (subtle) */}
      <path d="M 47,59 Q 50,63 53,59" stroke={accentHex} strokeWidth="1.5" fill="none" strokeLinecap="round" opacity="0.6" />

      {/* Mouth */}
      <Mouth style={config.mouth} />

      {/* Cheeks */}
      {config.cheeks && (
        <>
          <ellipse cx="32" cy="64" rx="8" ry="4.5" fill="#FF9B9B" opacity="0.45" />
          <ellipse cx="68" cy="64" rx="8" ry="4.5" fill="#FF9B9B" opacity="0.45" />
        </>
      )}

      {/* Hair – front layer */}
      <HairFront style={config.hair_style} color={hairHex} />
    </svg>
  );
}
