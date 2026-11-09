import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const config: NextConfig = {
  poweredByHeader: false,
  // Enables forbidden() so admin routes return a real 403 to non-admins.
  experimental: { authInterrupts: true },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default config;
