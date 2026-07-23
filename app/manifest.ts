import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "App Store 全球价格",
    short_name: "全球价格",
    description: "比较热门 App 与 Apple 订阅服务在 20 个地区的官方价格。",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f5f5f7",
    theme_color: "#f5f5f7",
    orientation: "portrait-primary",
    icons: [
      {
        src: "/icons/app-icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/app-icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
