import type { MetadataRoute } from "next";
import { getDb } from "@/lib/db";
import { buildSitemap } from "@/lib/siteSeo";

export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  return buildSitemap(getDb());
}
