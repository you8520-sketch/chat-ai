import type { Metadata } from "next";
import { isDemoEnv } from "@/lib/demo";
import { loginMetadata } from "@/lib/siteSeo";
import LoginClient from "./LoginClient";

export const metadata: Metadata = loginMetadata();

export default function LoginPage() {
  return <LoginClient showDemo={isDemoEnv()} />;
}
