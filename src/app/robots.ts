import type { MetadataRoute } from "next";
import { buildRobots } from "@/lib/siteSeo";

export default function robots(): MetadataRoute.Robots {
  return buildRobots();
}
