import Image from "next/image";
import type { AppSnapshot } from "../lib/catalog";

export function AppArtwork({
  app,
  className,
  size,
  priority = false,
  alt = "",
}: {
  app: AppSnapshot;
  className: string;
  size: number;
  priority?: boolean;
  alt?: string;
}) {
  if (app.icon) {
    const serviceClass = app.priceSource === "apple-service"
      ? ` service-artwork-image${app.id === "apple-one" ? " apple-one-artwork" : ""}${app.id === "apple-icloud-plus" ? " icloud-artwork" : ""}`
      : "";
    return <Image src={app.icon} alt={alt} className={`${className}${serviceClass}`} width={size} height={size} priority={priority} />;
  }

  return (
    <span className={`${className} official-service-artwork`} aria-hidden="true">
      <small>Apple</small>
      <strong>官方服务</strong>
    </span>
  );
}
