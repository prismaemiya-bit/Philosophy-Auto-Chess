import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow account-less Cloudflare quick tunnels during supervised mobile QA.
  // This only affects the development server; production origins stay unchanged.
  allowedDevOrigins: ["*.trycloudflare.com"],
};

export default nextConfig;
