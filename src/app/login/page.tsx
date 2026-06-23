import { isDemoEnv } from "@/lib/demo";
import LoginClient from "./LoginClient";

export default function LoginPage() {
  return <LoginClient showDemo={isDemoEnv()} />;
}
