import type { NextConfig } from "next";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

const nextConfig: NextConfig = {
  // Dev only: allow opening the dev server via 127.0.0.1 as well as localhost.
  allowedDevOrigins: ["127.0.0.1"],
  images: {
    // Product images are served from the public `product-images` Storage bucket.
    remotePatterns: [
      supabaseUrl
        ? new URL(`${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/product-images/**`)
        : { protocol: "https", hostname: "**.supabase.co", pathname: "/storage/v1/object/public/product-images/**" },
    ],
  },
};

export default nextConfig;
