export default function manifest() {
  return {
    name: "D6 Stock Tracker",
    short_name: "D6 Stock Tracker",
    start_url: "/stocks",
    display: "standalone",
    background_color: "#000000",
    theme_color: "#000000",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
      { src: "/apple-touch-icon.png", sizes: "180x180", type: "image/png", purpose: "any" }
    ],
  };
}
