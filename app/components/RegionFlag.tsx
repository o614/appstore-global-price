import Image from "next/image";

type RegionFlagProps = {
  code: string;
  name: string;
  size?: "compact" | "regular";
  decorative?: boolean;
};

const sizes = {
  compact: { width: 20, height: 14 },
  regular: { width: 24, height: 18 },
};

export function RegionFlag({ code, name, size = "compact", decorative = true }: RegionFlagProps) {
  const dimensions = sizes[size];

  return (
    <span className={`region-flag region-flag-${size}`} aria-hidden={decorative || undefined}>
      <Image
        src={`/flags/${code.toLowerCase()}.png`}
        alt={decorative ? "" : `${name}国旗`}
        width={dimensions.width}
        height={dimensions.height}
        sizes={`${dimensions.width}px`}
      />
    </span>
  );
}
